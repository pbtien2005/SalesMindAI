import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import { createUser } from '../src/auth/users.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { setCustomerStatus } from '../src/customers/status.js';
import { auditLog, conversations, pages, tenants } from '../src/db/schema.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));
const PASSWORD = 'mat-khau-dai-123';
const log = { info: () => {}, warn: () => {} };
const NOW = new Date('2026-11-11T03:00:00Z');

const app = buildApp({}, {
  appSecret: 's',
  verifyToken: 'v',
  queue: { enqueue: async () => {} },
  api: { db, crypto, log, demoMode: false },
  auth: { db, mailer: new MemoryMailer(), signupOpen: false, publicBaseUrl: 'http://localhost:3000', rateLimit: { max: 10_000, timeWindowMs: 60_000 } },
});

beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

async function seed(name: string, role: 'owner' | 'manager' | 'sale' = 'sale') {
  const [t] = await db.insert(tenants).values({ name }).returning({ id: tenants.id });
  const tenantId = t!.id;
  const email = `${role}@${name.toLowerCase()}.vn`;
  const { userId } = await createUser(db, { email, password: PASSWORD, displayName: `Bạn ${name}`, tenantId, role, emailVerified: true }, new Date());
  const [p] = await db.insert(pages).values({ tenantId, fbPageId: `pg-${name}`, name: `Page ${name}`, tokenEnc: 'x' }).returning({ id: pages.id });
  const [c] = await db.insert(conversations).values({ tenantId, pageId: p!.id, psid: `psid-${name}`, lastMessageAt: NOW }).returning({ id: conversations.id });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-requested-with': 'salesmind', 'content-type': 'application/json' }, payload: { email, password: PASSWORD } });
  const cookie = String(([] as string[]).concat(res.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
  return { tenantId, userId, conversationId: c!.id, cookie };
}

const post = (cookie: string, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: { 'x-requested-with': 'salesmind', 'content-type': 'application/json', cookie }, payload: payload as object });

describe('setCustomerStatus', () => {
  it('khách mới có trạng thái "new", chưa ai đổi', async () => {
    const s = await seed('A');
    const [c] = await db.select().from(conversations).where(eq(conversations.id, s.conversationId));
    expect(c).toMatchObject({ customerStatus: 'new', customerStatusBy: null, customerStatusAt: null });
  });

  it('đổi trạng thái: lưu người đổi, lúc đổi và ghi nhật ký từ-sang (không có nội dung chat)', async () => {
    const s = await seed('A');
    const r = await setCustomerStatus(db, { tenantId: s.tenantId, conversationId: s.conversationId, status: 'quoted', by: 'Lan', userId: s.userId }, NOW);
    expect(r).toMatchObject({ changed: true, current: { status: 'quoted', by: 'Lan' } });
    const [c] = await db.select().from(conversations).where(eq(conversations.id, s.conversationId));
    expect(c).toMatchObject({ customerStatus: 'quoted', customerStatusBy: 'Lan' });
    expect(c!.customerStatusAt!.getTime()).toBe(NOW.getTime());
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'customer.status_changed'));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ tenantId: s.tenantId, userId: s.userId, target: s.conversationId, meta: { from: 'new', to: 'quoted' } });
  });

  it('đặt lại đúng trạng thái hiện tại: không đổi, không ghi nhật ký, giữ người và thời điểm cũ', async () => {
    const s = await seed('A');
    const input = { tenantId: s.tenantId, conversationId: s.conversationId, status: 'won' as const, userId: s.userId };
    await setCustomerStatus(db, { ...input, by: 'Lan' }, NOW);
    const later = new Date(NOW.getTime() + 3_600_000);
    const again = await setCustomerStatus(db, { ...input, by: 'Hà' }, later);
    expect(again).toMatchObject({ changed: false, current: { status: 'won', by: 'Lan' } });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'customer.status_changed'))).toHaveLength(1);
  });

  it('hội thoại của doanh nghiệp khác: trả null và không đổi gì', async () => {
    const a = await seed('A');
    const b = await seed('B');
    const r = await setCustomerStatus(db, { tenantId: a.tenantId, conversationId: b.conversationId, status: 'lost', by: 'x', userId: a.userId }, NOW);
    expect(r).toBeNull();
    const [c] = await db.select().from(conversations).where(eq(conversations.id, b.conversationId));
    expect(c!.customerStatus).toBe('new');
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'customer.status_changed'))).toHaveLength(0);
  });
});

describe('POST /api/conversations/:id/status', () => {
  it('sale đổi được; chi tiết hội thoại và hộp thư trả trạng thái mới kèm người đổi', async () => {
    const s = await seed('A', 'sale');
    const r = await post(s.cookie, `/api/conversations/${s.conversationId}/status`, { status: 'consulting' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'consulting', by: 'Bạn A', changed: true });

    const detail = await app.inject({ method: 'GET', url: `/api/conversations/${s.conversationId}`, headers: { 'x-requested-with': 'salesmind', cookie: s.cookie } });
    expect(detail.json().summary).toMatchObject({ customerStatus: 'consulting', customerStatusBy: 'Bạn A' });
    const inbox = await app.inject({ method: 'GET', url: '/api/inbox', headers: { 'x-requested-with': 'salesmind', cookie: s.cookie } });
    expect(inbox.json().conversations[0]).toMatchObject({ id: s.conversationId, customerStatus: 'consulting' });
  });

  it('trạng thái lạ hoặc thiếu: 400 và không đổi; id không phải UUID: 404; chưa đăng nhập: 401', async () => {
    const s = await seed('A');
    for (const body of [{ status: 'vip' }, {}, { status: 5 }]) {
      expect((await post(s.cookie, `/api/conversations/${s.conversationId}/status`, body)).statusCode).toBe(400);
    }
    expect((await post(s.cookie, '/api/conversations/khong-phai-uuid/status', { status: 'won' })).statusCode).toBe(404);
    const anon = await app.inject({ method: 'POST', url: `/api/conversations/${s.conversationId}/status`, headers: { 'x-requested-with': 'salesmind', 'content-type': 'application/json' }, payload: { status: 'won' } });
    expect(anon.statusCode).toBe(401);
    const [c] = await db.select().from(conversations).where(eq(conversations.id, s.conversationId));
    expect(c!.customerStatus).toBe('new');
  });
});
