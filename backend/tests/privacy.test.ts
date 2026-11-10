import { createHmac, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import { createUser } from '../src/auth/users.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { conversations, extractionRuns, messages, pages, proposals, tenants, profileFields, tasks, users } from '../src/db/schema.js';
import { parseSignedRequest } from '../src/privacy/routes.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const SECRET = 'app-secret-for-tests';
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));
const PASSWORD = 'mat-khau-dai-123';
const H = { 'x-requested-with': 'salesmind', 'content-type': 'application/json' };
const unsubscribe = vi.fn(async (_id: string, _t: string) => {});

const app = buildApp({}, {
  appSecret: SECRET,
  verifyToken: 'v',
  queue: { enqueue: async () => {} },
  api: { db, crypto, log: { info: () => {}, warn: () => {} }, demoMode: false, facebook: { facebookConfigured: true, graph: { unsubscribePage: unsubscribe } as never } },
  auth: { db, mailer: new MemoryMailer(), signupOpen: false, publicBaseUrl: 'http://localhost:3000', rateLimit: { max: 10_000, timeWindowMs: 60_000 } },
});

const sign = (payload: object, secret = SECRET, alg = 'HMAC-SHA256') => {
  const p = Buffer.from(JSON.stringify({ algorithm: alg, ...payload })).toString('base64url');
  return `${createHmac('sha256', secret).update(p).digest('base64url')}.${p}`;
};

beforeEach(async () => {
  await truncateAll(handle);
  unsubscribe.mockClear();
});
afterAll(async () => {
  await handle.close();
});

describe('parseSignedRequest', () => {
  it('đúng chữ ký thì trả payload; sai khóa, sai payload, sai thuật toán, sai định dạng thì null', () => {
    expect(parseSignedRequest(sign({ user_id: '42' }), SECRET)).toMatchObject({ user_id: '42' });
    expect(parseSignedRequest(sign({ user_id: '42' }, 'khoa-khac'), SECRET)).toBeNull();
    const ok = sign({ user_id: '42' });
    const [sig] = ok.split('.');
    const tampered = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '43' })).toString('base64url');
    expect(parseSignedRequest(`${sig}.${tampered}`, SECRET)).toBeNull();
    expect(parseSignedRequest(sign({ user_id: '42' }, SECRET, 'MD5'), SECRET)).toBeNull();
    for (const bad of ['', 'abc', 'a.b.c', '.', 'đ.ê', `${ok}.extra`]) expect(parseSignedRequest(bad, SECRET), bad).toBeNull();
  });
});

describe('trang công khai', () => {
  it('/privacy và /terms trả HTML tiếng Việt, không cần đăng nhập, nói rõ AI mặc định tắt', async () => {
    const p = await app.inject({ method: 'GET', url: '/privacy' });
    expect(p.statusCode).toBe(200);
    expect(p.headers['content-type']).toContain('text/html');
    expect(p.body).toContain('mặc định');
    expect(p.body).toContain('Xóa dữ liệu');
    expect((await app.inject({ method: 'GET', url: '/terms' })).statusCode).toBe(200);
  });
});

async function seedWithData(name: string, psid = `psid-${name}`) {
  const [t] = await db.insert(tenants).values({ name }).returning({ id: tenants.id });
  const tenantId = t!.id;
  const [p] = await db.insert(pages).values({ tenantId, fbPageId: `fb-${name}`, name: `Page ${name}`, tokenEnc: crypto.encrypt('EAAtoken', `fb-${name}`) }).returning({ id: pages.id });
  const at = new Date('2026-11-10T01:00:00Z');
  const [c] = await db.insert(conversations).values({ tenantId, pageId: p!.id, psid, lastMessageAt: at, lastUserInteractionAt: at }).returning({ id: conversations.id });
  const [m] = await db.insert(messages).values({ tenantId, pageId: p!.id, conversationId: c!.id, mid: `mid-${name}`, text: 'Nội dung nhạy cảm của khách', sentAt: at, source: 'webhook' }).returning({ id: messages.id });
  const [run] = await db.insert(extractionRuns).values({ tenantId, conversationId: c!.id, upToMessageId: m!.id, promptVersion: 'v1', model: 't', status: 'succeeded' }).returning({ id: extractionRuns.id });
  const [pr] = await db.insert(proposals).values({ tenantId, conversationId: c!.id, runId: run!.id, field: 'phone', value: { text: '0912345678' }, status: 'accepted' }).returning({ id: proposals.id });
  await db.insert(profileFields).values({ tenantId, conversationId: c!.id, field: 'phone', value: { text: '0912345678' }, proposalId: pr!.id });
  await db.insert(tasks).values({ tenantId, conversationId: c!.id, title: 'Gọi lại', dueAt: at });
  return { tenantId, conversationId: c!.id };
}

describe('callback xóa dữ liệu của Meta', () => {
  const post = (url: string, signed: unknown) => app.inject({ method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `signed_request=${encodeURIComponent(String(signed))}` });

  it('user_id trùng một PSID: xóa đúng hội thoại đó (và mọi thứ gắn với nó), giữ hội thoại của người khác, trả mã xác nhận và trang trạng thái', async () => {
    const a = await seedWithData('A', 'psid-nguoi-xoa');
    const b = await seedWithData('B');
    const r = await post('/meta/data-deletion', sign({ user_id: 'psid-nguoi-xoa' }));
    expect(r.statusCode).toBe(200);
    const { url, confirmation_code } = r.json();
    expect(url).toContain(`/meta/data-deletion/status?code=${confirmation_code}`);
    expect(await db.select().from(conversations).where(sql`id = ${a.conversationId}`)).toHaveLength(0);
    expect(await db.select().from(messages).where(sql`conversation_id = ${a.conversationId}`)).toHaveLength(0);
    expect(await db.select().from(proposals).where(sql`conversation_id = ${a.conversationId}`)).toHaveLength(0);
    expect(await db.select().from(conversations).where(sql`id = ${b.conversationId}`)).toHaveLength(1);
    const status = await app.inject({ method: 'GET', url: `/meta/data-deletion/status?code=${confirmation_code}` });
    expect(status.statusCode).toBe(200);
    expect(status.body).toContain('Đã xóa 1 hội thoại');
  });

  it('user_id không khớp dữ liệu nào: ghi nhận (received), không xóa gì; gọi hai lần không lỗi', async () => {
    const b = await seedWithData('B');
    const r1 = await post('/meta/data-deletion', sign({ user_id: 'khong-co' }));
    const r2 = await post('/meta/data-deletion', sign({ user_id: 'khong-co' }));
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.json().confirmation_code).not.toBe(r2.json().confirmation_code);
    expect(await db.select().from(conversations).where(sql`id = ${b.conversationId}`)).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: `/meta/data-deletion/status?code=${r1.json().confirmation_code}` })).body).toContain('đã nhận yêu cầu');
  });

  it('chữ ký sai hoặc thiếu user_id: 400 và không xóa gì; mã trạng thái lạ: 404', async () => {
    const a = await seedWithData('A', 'psid-a');
    expect((await post('/meta/data-deletion', sign({ user_id: 'psid-a' }, 'khoa-sai'))).statusCode).toBe(400);
    expect((await post('/meta/data-deletion', sign({}))).statusCode).toBe(400);
    expect((await post('/meta/data-deletion', 'rac')).statusCode).toBe(400);
    expect(await db.select().from(conversations).where(sql`id = ${a.conversationId}`)).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/meta/data-deletion/status?code=khongtontai123' })).statusCode).toBe(404);
  });

  it('deauthorize: chữ ký đúng 200, sai 400', async () => {
    expect((await post('/meta/deauthorize', sign({ user_id: '1' }))).statusCode).toBe(200);
    expect((await post('/meta/deauthorize', sign({ user_id: '1' }, 'sai'))).statusCode).toBe(400);
  });
});

async function login(tenantId: string, role: 'owner' | 'manager', pw = PASSWORD) {
  const email = `${role}-${tenantId.slice(-6)}@x.vn`;
  await createUser(db, { email, password: PASSWORD, displayName: role, tenantId, role, emailVerified: true }, new Date());
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, password: pw } });
  return String(([] as string[]).concat(res.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
}
const call = (cookie: string, method: 'GET' | 'POST', url: string, body?: unknown) =>
  app.inject({ method, url, headers: { 'x-requested-with': 'salesmind', cookie, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' ? { payload: (body ?? {}) as object } : {}) });

const TABLES = ['conversations', 'messages', 'proposals', 'profile_fields', 'tasks', 'extraction_runs', 'pages', 'users', 'memberships', 'tenants'];
const counts = async (tenantCol: 'tenant_id' | 'id', tenantId: string) =>
  Object.fromEntries(
    await Promise.all(
      TABLES.map(async (t) => {
        const col = t === 'tenants' ? 'id' : t === 'users' ? null : tenantCol === 'id' ? 'tenant_id' : 'tenant_id';
        if (col === null) return [t, (await db.execute(sql`SELECT count(*)::int AS n FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.tenant_id = ${tenantId}`)).rows[0]!.n];
        return [t, (await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.identifier(t)} WHERE ${sql.identifier(col)} = ${tenantId}`)).rows[0]!.n];
      }),
    ),
  );

describe('xuất và xóa dữ liệu doanh nghiệp', () => {
  it('xuất: chỉ owner; chỉ dữ liệu của mình; không có token, băm mật khẩu hay Page token', async () => {
    const a = await seedWithData('A');
    await seedWithData('B');
    const mgr = await login(a.tenantId, 'manager');
    expect((await call(mgr, 'GET', '/api/tenant/export')).statusCode).toBe(403);
    const owner = await login(a.tenantId, 'owner');
    const r = await call(owner, 'GET', '/api/tenant/export');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.body).toContain('Nội dung nhạy cảm của khách');
    expect(r.body).not.toMatch(/EAA|scrypt|token_enc|tokenEnc|password/i);
    expect(r.json().conversations).toHaveLength(1);
    expect(JSON.stringify(r.json())).not.toContain('Page B');
  });

  it('xóa: sai tên 422, sai mật khẩu 403, manager 403: không mất gì', async () => {
    const a = await seedWithData('A');
    const owner = await login(a.tenantId, 'owner');
    const mgr = await login(a.tenantId, 'manager');
    const before = await counts('tenant_id', a.tenantId);
    expect((await call(owner, 'POST', '/api/tenant/delete', { confirmName: 'Tên khác', password: PASSWORD })).json().error.code).toBe('name_mismatch');
    expect((await call(owner, 'POST', '/api/tenant/delete', { confirmName: 'A', password: 'sai-mat-khau-1' })).statusCode).toBe(403);
    expect((await call(mgr, 'POST', '/api/tenant/delete', { confirmName: 'A', password: PASSWORD })).statusCode).toBe(403);
    expect(await counts('tenant_id', a.tenantId)).toEqual(before);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('xóa đúng: gỡ webhook (kể cả khi Meta lỗi), xóa SẠCH dữ liệu và người dùng của doanh nghiệp, không đụng doanh nghiệp khác, cookie cũ vô hiệu', async () => {
    const a = await seedWithData('A');
    const b = await seedWithData('B');
    const owner = await login(a.tenantId, 'owner');
    await login(b.tenantId, 'owner');
    const bBefore = await counts('tenant_id', b.tenantId);
    unsubscribe.mockRejectedValueOnce(new Error('Meta 400'));
    const r = await call(owner, 'POST', '/api/tenant/delete', { confirmName: ' A ', password: PASSWORD });
    expect(r.statusCode).toBe(200);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe.mock.calls[0]![1]).toBe('EAAtoken');
    const after = await counts('tenant_id', a.tenantId);
    expect(Object.values(after).every((n) => n === 0)).toBe(true);
    expect(await counts('tenant_id', b.tenantId)).toEqual(bBefore);
    expect((await call(owner, 'GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await db.select().from(users)).every((u) => u.email.includes(b.tenantId.slice(-6)))).toBe(true);
  });
});
