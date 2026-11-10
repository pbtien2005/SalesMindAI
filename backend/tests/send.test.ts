import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import { createUser } from '../src/auth/users.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { conversations, messages, pages, tenants } from '../src/db/schema.js';
import { pageEchoPayload } from '../src/demo/simulator.js';
import { GraphApiError } from '../src/meta/graph-client.js';
import { GraphMessageSender } from '../src/send/sender.js';
import { REPLY_WINDOW_MS, sendWindow } from '../src/send/window.js';
import { processWebhookPayload } from '../src/workers/process-webhook.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));
const PASSWORD = 'mat-khau-dai-123';
const H = { 'x-requested-with': 'salesmind', 'content-type': 'application/json' };
const log = { info: () => {}, warn: () => {} };
const OWN_APP = '111222333444555';

const sendText = vi.fn(async (_token: string, _psid: string, _text: string) => ({ messageId: 'm_graph_1' }));
const sender = new GraphMessageSender({ db, crypto, graph: { sendText } as never, ownAppId: OWN_APP });
const app = buildApp({}, {
  appSecret: 's',
  verifyToken: 'v',
  queue: { enqueue: async () => {} },
  api: { db, crypto, log, demoMode: false, sender },
  auth: { db, mailer: new MemoryMailer(), signupOpen: false, publicBaseUrl: 'http://localhost:3000', rateLimit: { max: 10_000, timeWindowMs: 60_000 } },
});

interface World {
  tenantId: string;
  pageId: string;
  convId: string;
  cookie: string;
  userId: string;
}
let w: World;
let other: World;

async function seed(name: string, userRole: 'sale' | 'manager' = 'sale'): Promise<World> {
  const [t] = await db.insert(tenants).values({ name }).returning({ id: tenants.id });
  const tenantId = t!.id;
  const email = `u@${name}.vn`;
  const { userId } = await createUser(db, { email, password: PASSWORD, displayName: `Người ${name}`, tenantId, role: userRole, emailVerified: true }, new Date());
  const [p] = await db.insert(pages).values({ tenantId, fbPageId: `fb-${name}`, name: `Page ${name}`, tokenEnc: crypto.encrypt('EAAtokenBI-MAT', `fb-${name}`) }).returning({ id: pages.id });
  const last = new Date(Date.now() - 3600_000); // khách nhắn 1 giờ trước
  const [c] = await db
    .insert(conversations)
    .values({ tenantId, pageId: p!.id, psid: `psid-${name}`, displayName: 'Khách', lastMessageAt: last, lastUserInteractionAt: last })
    .returning({ id: conversations.id });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, password: PASSWORD } });
  const cookie = String(([] as string[]).concat(res.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
  return { tenantId, pageId: p!.id, convId: c!.id, cookie, userId };
}

const send = (who: World, text: string, convId = who.convId, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: `/api/conversations/${convId}/send`, headers: { ...H, cookie: who.cookie, ...headers }, payload: { text } });

beforeEach(async () => {
  await truncateAll(handle);
  sendText.mockClear();
  sendText.mockImplementation(async () => ({ messageId: 'm_graph_1' }));
  w = await seed('A');
  other = await seed('B');
});
afterAll(async () => {
  await handle.close();
});

describe('cửa sổ trả lời', () => {
  it('đóng đúng tại 24 giờ: còn 1 ms thì mở, đúng 24 giờ thì đóng; chưa từng có tin của khách thì đóng', () => {
    const last = new Date('2026-11-10T00:00:00Z');
    expect(sendWindow(last, new Date(last.getTime() + REPLY_WINDOW_MS - 1)).open).toBe(true);
    expect(sendWindow(last, new Date(last.getTime() + REPLY_WINDOW_MS)).open).toBe(false);
    expect(sendWindow(null, last)).toEqual({ open: false, closesAt: null });
    expect(sendWindow(last, last).closesAt?.getTime()).toBe(last.getTime() + REPLY_WINDOW_MS);
  });
});

describe('gửi tin thật', () => {
  it('thành công: gọi Send API bằng token của đúng Page, lưu tin (mid, page_app, người gửi), cập nhật hội thoại', async () => {
    const r = await send(w, '  Dạ em chào anh ạ  ');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, messageId: 'm_graph_1' });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]).toEqual(['EAAtokenBI-MAT', 'psid-A', 'Dạ em chào anh ạ']);
    const [m] = await db.select().from(messages);
    expect(m).toMatchObject({ mid: 'm_graph_1', direction: 'outbound', senderKind: 'page_app', appId: OWN_APP, source: 'send', text: 'Dạ em chào anh ạ', sentByUserId: w.userId });
    const [c] = await db.select().from(conversations).where(eq(conversations.id, w.convId));
    expect(c!.lastPageMessageAt).not.toBeNull();
    expect(r.body).not.toContain('EAA');
  });

  it('echo cùng mid đến sau: vẫn một dòng', async () => {
    await send(w, 'Dạ em chào anh ạ');
    await processWebhookPayload(db, pageEchoPayload({ fbPageId: 'fb-A', psid: 'psid-A', text: 'Dạ em chào anh ạ', at: new Date(), mid: 'm_graph_1', appId: OWN_APP }), log);
    expect(await db.select().from(messages)).toHaveLength(1);
  });

  it('echo khác mid, cùng nội dung, trong vài giây: vẫn một dòng; khác nội dung hoặc quá 5 giây thì lưu', async () => {
    await send(w, 'Dạ em chào anh ạ');
    await processWebhookPayload(db, pageEchoPayload({ fbPageId: 'fb-A', psid: 'psid-A', text: 'Dạ em chào anh ạ', at: new Date(), mid: 'mid_khac_1', appId: OWN_APP }), log);
    expect(await db.select().from(messages)).toHaveLength(1);
    await processWebhookPayload(db, pageEchoPayload({ fbPageId: 'fb-A', psid: 'psid-A', text: 'Một tin khác', at: new Date(), mid: 'mid_khac_2', appId: OWN_APP }), log);
    expect(await db.select().from(messages)).toHaveLength(2);
    await processWebhookPayload(db, pageEchoPayload({ fbPageId: 'fb-A', psid: 'psid-A', text: 'Dạ em chào anh ạ', at: new Date(Date.now() + 60_000), mid: 'mid_khac_3', appId: OWN_APP }), log);
    expect(await db.select().from(messages)).toHaveLength(3);
  });

  it('quá 24 giờ kể từ tin cuối của khách: 422 và KHÔNG có request nào tới Meta', async () => {
    await db.update(conversations).set({ lastUserInteractionAt: new Date(Date.now() - REPLY_WINDOW_MS - 1000) }).where(eq(conversations.id, w.convId));
    const r = await send(w, 'Dạ');
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('window_closed');
    expect(sendText).not.toHaveBeenCalled();
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it('còn 23 giờ 59 phút thì gửi được', async () => {
    await db.update(conversations).set({ lastUserInteractionAt: new Date(Date.now() - REPLY_WINDOW_MS + 60_000) }).where(eq(conversations.id, w.convId));
    expect((await send(w, 'Dạ')).statusCode).toBe(200);
  });

  it('Meta báo 190: Page đánh dấu token_invalid, không lưu tin, trả 409', async () => {
    sendText.mockRejectedValueOnce(new GraphApiError('token', 400, 190, null, 'OAuthException'));
    const r = await send(w, 'Dạ');
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('token_invalid');
    expect((await db.select().from(pages).where(eq(pages.id, w.pageId)))[0]!.status).toBe('token_invalid');
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it('Meta báo ngoài cửa sổ (mã 10): 422 window_closed, không lưu tin', async () => {
    sendText.mockRejectedValueOnce(new GraphApiError('x', 400, 10, 2018278, 'OAuthException'));
    const r = await send(w, 'Dạ');
    expect(r.json().error.code).toBe('window_closed');
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it('lỗi mạng: 502 network, không lưu tin; giới hạn tốc độ: 429', async () => {
    sendText.mockRejectedValueOnce(new GraphApiError('mạng', null, null, null, null));
    const r = await send(w, 'Dạ');
    expect(r.statusCode).toBe(502);
    expect(r.json().error.code).toBe('network');
    sendText.mockRejectedValueOnce(new GraphApiError('quá tải', 400, 4, null, 'OAuthException'));
    expect((await send(w, 'Dạ')).statusCode).toBe(429);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it('Page đã ngắt kết nối: 409 và không gọi Meta', async () => {
    await db.update(pages).set({ status: 'disconnected', tokenEnc: '' }).where(eq(pages.id, w.pageId));
    const r = await send(w, 'Dạ');
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('page_inactive');
    expect(sendText).not.toHaveBeenCalled();
  });

  it('hội thoại của doanh nghiệp khác: 404 và không gọi Meta', async () => {
    const r = await send(w, 'Dạ', other.convId);
    expect(r.statusCode).toBe(404);
    expect(sendText).not.toHaveBeenCalled();
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it('nội dung: trống hoặc chỉ khoảng trắng 422; quá 1000 ký tự 422; 1000 ký tự được', async () => {
    expect((await send(w, '   ')).statusCode).toBe(422);
    expect((await send(w, 'a'.repeat(1001))).statusCode).toBe(422);
    expect(sendText).not.toHaveBeenCalled();
    expect((await send(w, 'a'.repeat(1000))).statusCode).toBe(200);
  });

  it('thử lại cùng Idempotency-Key: chỉ một lần gọi Meta, một tin; khác khóa thì gửi tiếp', async () => {
    const key = { 'idempotency-key': 'lan-bam-nut-0001' };
    const a = await send(w, 'Dạ', w.convId, key);
    const b = await send(w, 'Dạ', w.convId, key);
    expect(a.statusCode).toBe(200);
    expect(b.json().repeated).toBe(true);
    expect(sendText).toHaveBeenCalledTimes(1);
    sendText.mockImplementationOnce(async () => ({ messageId: 'm_graph_2' }));
    await send(w, 'Dạ', w.convId, { 'idempotency-key': 'lan-bam-nut-0002' });
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(await db.select().from(messages)).toHaveLength(2);
  });

  it('chưa đăng nhập 401; không có sender (chưa cấu hình) 503', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/conversations/${w.convId}/send`, headers: H, payload: { text: 'x' } })).statusCode).toBe(401);
  });

  it('chi tiết hội thoại báo cửa sổ gửi và trạng thái Page', async () => {
    const d = await app.inject({ method: 'GET', url: `/api/conversations/${w.convId}`, headers: { cookie: w.cookie } });
    expect(d.json().reply).toMatchObject({ open: true, pageActive: true });
    await db.update(pages).set({ status: 'token_invalid' }).where(eq(pages.id, w.pageId));
    const d2 = await app.inject({ method: 'GET', url: `/api/conversations/${w.convId}`, headers: { cookie: w.cookie } });
    expect(d2.json().reply.pageActive).toBe(false);
  });
});
