import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import { createUser } from '../src/auth/users.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { conversations, messages, pages, tenants } from '../src/db/schema.js';
import { customerPayload } from '../src/demo/simulator.js';
import { processWebhookPayload } from '../src/workers/process-webhook.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));
const PASSWORD = 'mat-khau-dai-123';
const H = { 'x-requested-with': 'salesmind', 'content-type': 'application/json' };
const log = { info: () => {}, warn: () => {} };

interface FakePage {
  id: string;
  name: string;
  accessToken: string;
}
let fbPages: FakePage[] = [];
const unsubscribe = vi.fn(async (_id: string, _token: string) => {});
const enqueue = vi.fn(async () => true);
const graph = {
  loginUrl: ({ state }: { state: string }) => `https://facebook.example/dialog?state=${state}`,
  exchangeCode: async () => 'short-token',
  exchangeLongLived: async () => 'long-token',
  listPages: async () => fbPages,
  subscribePage: async () => {},
  unsubscribePage: unsubscribe,
};

function makeApp(facebookConfigured = true) {
  return buildApp({}, {
    appSecret: 's',
    verifyToken: 'v',
    queue: { enqueue: async () => {} },
    oauth: { db, graph: graph as never, crypto, publicBaseUrl: 'http://localhost:3000' },
    api: { db, crypto, log, demoMode: false, facebook: { facebookConfigured, graph: graph as never, backfill: { enqueuePage: enqueue } } },
    auth: { db, mailer: new MemoryMailer(), signupOpen: false, publicBaseUrl: 'http://localhost:3000', rateLimit: { max: 10_000, timeWindowMs: 60_000 } },
  });
}

let app: ReturnType<typeof makeApp>;
beforeEach(async () => {
  await truncateAll(handle);
  fbPages = [
    { id: 'fb-1', name: 'Nội thất Một', accessToken: 'EAAsecretTOKEN1' },
    { id: 'fb-2', name: 'Nội thất Hai', accessToken: 'EAAsecretTOKEN2' },
  ];
  unsubscribe.mockClear();
  enqueue.mockClear();
  app = makeApp();
});
afterAll(async () => {
  await handle.close();
});

async function seed(name: string, role: 'owner' | 'manager' | 'sale', verified = true) {
  const [t] = await db.insert(tenants).values({ name }).returning({ id: tenants.id });
  const email = `${role}@${name.toLowerCase()}.vn`;
  const { userId } = await createUser(db, { email, password: PASSWORD, displayName: `${role} ${name}`, tenantId: t!.id, role, emailVerified: verified }, new Date());
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, password: PASSWORD } });
  const cookie = String(([] as string[]).concat(res.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
  return { tenantId: t!.id, userId, cookie };
}
type Who = { cookie: string };
const call = (who: Who, method: 'GET' | 'POST', url: string) =>
  app.inject({ method, url, headers: { 'x-requested-with': 'salesmind', cookie: who.cookie, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' ? { payload: {} } : {}) });

/** Đi hết luồng OAuth như trình duyệt: mở liên kết, rồi Facebook gọi callback. */
async function connectVia(who: Who) {
  const r = await call(who, 'POST', '/api/pages/connect-url');
  expect(r.statusCode).toBe(200);
  const url = new URL(r.json().url);
  const start = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
  expect(start.statusCode).toBe(302);
  const nonce = /sm_oauth=([^;]+)/.exec(String(start.headers['set-cookie']))![1]!;
  const state = new URL(String(start.headers.location)).searchParams.get('state')!;
  return app.inject({ method: 'GET', url: `/auth/facebook/callback?code=abc&state=${state}`, headers: { cookie: `sm_oauth=${nonce}` } });
}

describe('kết nối Page trong giao diện', () => {
  it('quyền: sale 403; chưa xác minh email vẫn kết nối được; app Meta chưa cấu hình 503', async () => {
    const sale = await seed('A', 'sale');
    expect((await call(sale, 'POST', '/api/pages/connect-url')).statusCode).toBe(403);
    expect((await call(sale, 'GET', '/api/pages')).statusCode).toBe(403);
    const unverified = await seed('B', 'manager', false);
    const r = await call(unverified, 'POST', '/api/pages/connect-url');
    expect(r.statusCode).toBe(200);
    app = makeApp(false);
    const ok = await seed('C', 'manager');
    expect((await call(ok, 'POST', '/api/pages/connect-url')).json().error.code).toBe('facebook_not_configured');
  });

  it('một lần đăng nhập Facebook kết nối được nhiều Page; chuyển hướng về giao diện; JSON không lộ token', async () => {
    const mgr = await seed('A', 'manager');
    const cb = await connectVia(mgr);
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('http://localhost:3000/?connected=2&skipped=0&failed=0');
    const list = await call(mgr, 'GET', '/api/pages');
    const j = list.json();
    expect(j.pages.map((p: { name: string }) => p.name)).toEqual(['Nội thất Một', 'Nội thất Hai']);
    expect(j.pages[0]).toMatchObject({ status: 'active', webhookSubscribed: true, conversations: 0, connectedBy: 'manager A' });
    expect(list.body).not.toMatch(/EAA|token|secret/i);
    expect((await db.select().from(pages))[0]!.connectedByUserId).toBe(mgr.userId);
  });

  it('Page đã thuộc doanh nghiệp khác: vào skipped, Page vẫn của chủ cũ', async () => {
    const a = await seed('A', 'manager');
    const b = await seed('B', 'manager');
    await connectVia(a);
    fbPages = [fbPages[0]!];
    const cb = await connectVia(b);
    expect(cb.headers.location).toBe('http://localhost:3000/?connected=0&skipped=1&failed=0');
    expect((await db.select().from(pages).where(eq(pages.fbPageId, 'fb-1')))[0]!.tenantId).toBe(a.tenantId);
    expect((await call(b, 'GET', '/api/pages')).json().pages).toHaveLength(0);
  });

  it('liên kết do CLI (không có người dùng) vẫn trả trang HTML như cũ', async () => {
    const mgr = await seed('A', 'manager');
    const { createOAuthState } = await import('../src/auth/oauth-state.js');
    const state = await createOAuthState(db, mgr.tenantId);
    const start = await app.inject({ method: 'GET', url: `/auth/facebook/start?state=${state}` });
    const nonce = /sm_oauth=([^;]+)/.exec(String(start.headers['set-cookie']))![1]!;
    const cb = await app.inject({ method: 'GET', url: `/auth/facebook/callback?code=abc&state=${state}`, headers: { cookie: `sm_oauth=${nonce}` } });
    expect(cb.statusCode).toBe(200);
    expect(cb.headers['content-type']).toContain('text/html');
  });
});

describe('ngắt kết nối và tin đến sau đó', () => {
  it('ngắt: gọi Meta một lần, xóa token dù Meta lỗi, giữ lịch sử, tin mới từ Page đó bị bỏ có đếm và không retry', async () => {
    const mgr = await seed('A', 'owner');
    await connectVia(mgr);
    const [p] = await db.select().from(pages).where(eq(pages.fbPageId, 'fb-1'));
    // Có sẵn một tin từ trước khi ngắt.
    await processWebhookPayload(db, customerPayload({ fbPageId: 'fb-1', psid: 'psid-1', text: 'tin cũ', at: new Date() }), log);
    expect(await db.select().from(messages)).toHaveLength(1);

    unsubscribe.mockRejectedValueOnce(new Error('Meta 400'));
    const r = await call(mgr, 'POST', `/api/pages/${p!.id}/disconnect`);
    expect(r.statusCode).toBe(200);
    expect(r.json().metaUnsubscribed).toBe(false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe.mock.calls[0]![1]).toBe('EAAsecretTOKEN1');
    const [after] = await db.select().from(pages).where(eq(pages.id, p!.id));
    expect(after).toMatchObject({ status: 'disconnected', tokenEnc: '', subscribedAt: null });
    expect(await db.select().from(messages)).toHaveLength(1);

    const stats = await processWebhookPayload(db, customerPayload({ fbPageId: 'fb-1', psid: 'psid-1', text: 'tin mới', at: new Date() }), log);
    expect(stats.disconnected).toBe(1);
    expect(stats.stored).toBe(0);
    expect(await db.select().from(messages)).toHaveLength(1);

    // Ngắt lần hai không gọi Meta nữa.
    await call(mgr, 'POST', `/api/pages/${p!.id}/disconnect`);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    const list = (await call(mgr, 'GET', '/api/pages')).json().pages;
    expect(list.find((x: { fbPageId: string }) => x.fbPageId === 'fb-1')).toMatchObject({ status: 'disconnected', webhookSubscribed: false, conversations: 1 });
  });

  it('kết nối lại đúng Page: về active, tin cũ còn nguyên, nhận tin lại', async () => {
    const mgr = await seed('A', 'owner');
    await connectVia(mgr);
    const [p] = await db.select().from(pages).where(eq(pages.fbPageId, 'fb-1'));
    await processWebhookPayload(db, customerPayload({ fbPageId: 'fb-1', psid: 'psid-1', text: 'tin cũ', at: new Date() }), log);
    await call(mgr, 'POST', `/api/pages/${p!.id}/disconnect`);
    await connectVia(mgr);
    const [again] = await db.select().from(pages).where(eq(pages.id, p!.id));
    expect(again!.status).toBe('active');
    expect(again!.tokenEnc).not.toBe('');
    expect(crypto.decrypt(again!.tokenEnc, 'fb-1')).toBe('EAAsecretTOKEN1');
    expect(await db.select().from(conversations).where(eq(conversations.pageId, p!.id))).toHaveLength(1);
    const stats = await processWebhookPayload(db, customerPayload({ fbPageId: 'fb-1', psid: 'psid-1', text: 'tin sau khi nối lại', at: new Date(Date.now() + 1000) }), log);
    expect(stats.stored).toBe(1);
  });

  it('lấy lại tin cũ: Page đang dùng thì xếp việc; Page đã ngắt thì 409', async () => {
    const mgr = await seed('A', 'owner');
    await connectVia(mgr);
    const [p] = await db.select().from(pages).where(eq(pages.fbPageId, 'fb-1'));
    expect((await call(mgr, 'POST', `/api/pages/${p!.id}/backfill`)).json()).toEqual({ queued: true });
    expect(enqueue).toHaveBeenCalledWith({ pageId: p!.id });
    await call(mgr, 'POST', `/api/pages/${p!.id}/disconnect`);
    expect((await call(mgr, 'POST', `/api/pages/${p!.id}/backfill`)).statusCode).toBe(409);
  });
});
