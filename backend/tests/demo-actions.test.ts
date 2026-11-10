import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { parseDemoClockArgs, parseDemoSendArgs, UsageError } from '../src/cli/args.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { conversations, messages } from '../src/db/schema.js';
import { ensurePersonaConversation, SimError, simulateCustomerMessage, simulatePageMessage } from '../src/demo/actions.js';
import { DEMO_PAGE_INBOX_APP_ID, resetDemo, vn } from '../src/demo/seed.js';
import { PERSONAS, type WebhookPoster } from '../src/demo/simulator.js';
import { processWebhookPayload } from '../src/workers/process-webhook.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));
const SECRET = 'demo-secret';
const log = { info: () => {}, warn: () => {} };
beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

/** Giống server thật: POST có ký vào /webhook, job vào hàng đợi, rồi worker xử lý (ở đây gọi trực tiếp). */
async function setup() {
  const ctx = await resetDemo({ db, crypto, log, realNow: new Date('2026-11-10T05:00:00Z') });
  const queued: Array<{ payload: unknown }> = [];
  const app = buildApp({}, { appSecret: SECRET, verifyToken: 'v', queue: { enqueue: async (d) => void queued.push(d as { payload: unknown }) } });
  const poster: WebhookPoster = {
    async post(raw, signature) {
      const res = await app.inject({ method: 'POST', url: '/webhook', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw });
      return { status: res.statusCode };
    },
  };
  const drain = async () => {
    while (queued.length > 0) await processWebhookPayload(db, queued.shift()!.payload, log, { sender: { ownAppId: 'own', pageInboxAppIds: [DEMO_PAGE_INBOX_APP_ID] } });
  };
  return { ctx, sim: { db, poster, appSecret: SECRET, ctx }, drain, close: () => app.close() };
}

describe('simulateCustomerMessage / simulatePageMessage', () => {
  it('khách mới: tạo hội thoại có tên hiển thị, lưu tin đến đúng giờ đồng hồ demo', async () => {
    const { sim, drain, close } = await setup();
    const at = vn(2026, 11, 12, 9, 5);
    const r = await simulateCustomerMessage(sim, { persona: 'minh' }, 'Chào shop, anh đang tìm sofa phòng khách tầm 15 triệu', at);
    await drain();
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, r.conversationId));
    expect(conv).toMatchObject({ psid: PERSONAS.minh!.psid, displayName: 'Facebook: anh Minh' });
    expect(conv!.lastUserInteractionAt?.toISOString()).toBe(at.toISOString());
    const [m] = await db.select().from(messages).where(eq(messages.conversationId, r.conversationId));
    expect(m).toMatchObject({ direction: 'inbound', senderKind: 'customer', source: 'webhook' });
    expect(m!.sentAt.toISOString()).toBe(at.toISOString());
    await close();
  });

  it('tin của Lan là echo từ Page Inbox, không làm mới tương tác của khách', async () => {
    const { sim, drain, close } = await setup();
    const t1 = vn(2026, 11, 12, 9, 5);
    const t2 = vn(2026, 11, 12, 9, 8);
    const { conversationId } = await simulateCustomerMessage(sim, { persona: 'minh' }, 'Chào shop', t1);
    await drain();
    await simulatePageMessage(sim, conversationId, 'Dạ em chào anh ạ', t2);
    await drain();
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conv!.lastUserInteractionAt?.toISOString()).toBe(t1.toISOString());
    expect(conv!.lastPageMessageAt?.toISOString()).toBe(t2.toISOString());
    const out = (await db.select().from(messages).where(eq(messages.conversationId, conversationId))).find((m) => m.direction === 'outbound');
    expect(out).toMatchObject({ senderKind: 'page_inbox', appId: DEMO_PAGE_INBOX_APP_ID, text: 'Dạ em chào anh ạ' });
    await close();
  });

  it('khách nền có sẵn dùng lại đúng hội thoại, không tạo trùng', async () => {
    const { ctx, sim, drain, close } = await setup();
    const id1 = await ensurePersonaConversation(db, ctx, PERSONAS.thu!);
    const r = await simulateCustomerMessage(sim, { persona: 'thu' }, 'Chị chuyển khoản rồi nhé', vn(2026, 11, 12, 9, 5));
    await drain();
    expect(r.conversationId).toBe(id1);
    expect(await db.select().from(conversations).where(eq(conversations.psid, PERSONAS.thu!.psid))).toHaveLength(1);
    await close();
  });

  it('đầu vào sai: persona lạ, tin trống hoặc quá dài, hội thoại không có hay của tenant khác', async () => {
    const { sim, close } = await setup();
    const now = vn(2026, 11, 12, 9, 5);
    await expect(simulateCustomerMessage(sim, { persona: 'khong-co' }, 'xin chào', now)).rejects.toBeInstanceOf(SimError);
    await expect(simulateCustomerMessage(sim, { persona: 'minh' }, '   ', now)).rejects.toBeInstanceOf(SimError);
    await expect(simulateCustomerMessage(sim, { persona: 'minh' }, 'x'.repeat(2001), now)).rejects.toBeInstanceOf(SimError);
    await expect(simulatePageMessage(sim, '00000000-0000-7000-8000-000000000000', 'xin chào', now)).rejects.toBeInstanceOf(SimError);
    await close();
  });

  it('sai APP_SECRET thì webhook từ chối và không có gì được lưu', async () => {
    const { sim, drain, close } = await setup();
    await expect(simulateCustomerMessage({ ...sim, appSecret: 'sai' }, { persona: 'minh' }, 'xin chào', vn(2026, 11, 12, 9, 5))).rejects.toThrow(/403/);
    await drain();
    expect(await db.select().from(messages).where(eq(messages.text, 'xin chào'))).toHaveLength(0);
    await close();
  });
});

describe('tham số CLI demo', () => {
  it('demo:send', () => {
    expect(parseDemoSendArgs(['minh', 'Chào', 'shop'])).toEqual({ persona: 'minh', text: 'Chào shop', asPage: false });
    expect(parseDemoSendArgs(['minh', 'Dạ em chào anh', '--page'])).toEqual({ persona: 'minh', text: 'Dạ em chào anh', asPage: true });
    expect(() => parseDemoSendArgs(['minh'])).toThrow(UsageError);
    expect(() => parseDemoSendArgs([])).toThrow(UsageError);
  });
  it('demo:clock', () => {
    expect(parseDemoClockArgs([])).toEqual({});
    expect(parseDemoClockArgs(['--advance', '90'])).toEqual({ advanceMinutes: 90 });
    expect(parseDemoClockArgs(['--to', '2026-11-13T09:30:00+07:00'])).toEqual({ to: '2026-11-13T09:30:00+07:00' });
    for (const bad of [['--advance', '0'], ['--advance', 'abc'], ['--to', '2026-11-13'], ['--advance', '5', '--to', '2026-11-13T09:30:00Z'], ['x']]) {
      expect(() => parseDemoClockArgs(bad), bad.join(' ')).toThrow(UsageError);
    }
  });
});
