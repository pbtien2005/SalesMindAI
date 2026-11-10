import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { INVITE_TTL_MS } from '../src/auth/invites.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import { createUser } from '../src/auth/users.js';
import { auditLog, invitations, tenants, users } from '../src/db/schema.js';
import type { MemberRole } from '../src/db/schema.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const PASSWORD = 'mat-khau-dai-123';
const H = { 'x-requested-with': 'salesmind', 'content-type': 'application/json' };
let clock = new Date('2026-11-10T03:00:00Z');
let mailer: MemoryMailer;
let app: ReturnType<typeof buildApp>;
let tenantId: string;

function makeApp() {
  mailer = new MemoryMailer();
  return buildApp({}, {
    appSecret: 's',
    verifyToken: 'v',
    queue: { enqueue: async () => {} },
    api: { db, crypto: undefined as never, log: { info: () => {}, warn: () => {} }, demoMode: false },
    auth: { db, mailer, signupOpen: false, publicBaseUrl: 'http://localhost:3000', now: () => clock, rateLimit: { max: 10_000, timeWindowMs: 60_000 } },
  });
}

beforeEach(async () => {
  await truncateAll(handle);
  clock = new Date('2026-11-10T03:00:00Z');
  app = makeApp();
  const [t] = await db.insert(tenants).values({ name: 'Shop' }).returning({ id: tenants.id });
  tenantId = t!.id;
});
afterAll(async () => {
  await handle.close();
});

async function member(email: string, role: MemberRole, tid = tenantId) {
  const { userId } = await createUser(db, { email, password: PASSWORD, displayName: email.split('@')[0]!, tenantId: tid, role, emailVerified: true }, clock);
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, password: PASSWORD } });
  const cookie = String(([] as string[]).concat(res.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
  return { userId, cookie };
}
const call = (who: { cookie: string }, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) =>
  app.inject({ method, url, headers: { 'x-requested-with': 'salesmind', cookie: who.cookie, ...(method === 'POST' || method === 'PATCH' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' || method === 'PATCH' ? { payload: (body ?? {}) as object } : {}) });
const tokenOf = (link: string) => /invite=([A-Za-z0-9_-]{43})/.exec(link)![1]!;

describe('lời mời', () => {
  it('manager mời sale: liên kết dùng một lần, người nhận tự đặt mật khẩu và vào đúng doanh nghiệp, đúng vai trò', async () => {
    const boss = await member('boss@shop.vn', 'manager');
    const r = await call(boss, 'POST', '/api/team/invites', { role: 'sale' });
    expect(r.statusCode).toBe(201);
    const token = tokenOf(r.json().link);
    // Token không nằm trong DB.
    expect(JSON.stringify(await db.select().from(invitations))).not.toContain(token);

    const info = await app.inject({ method: 'POST', url: '/api/auth/invite-info', headers: H, payload: { token } });
    expect(info.json()).toEqual({ tenantName: 'Shop', role: 'sale', email: null });

    const acc = await app.inject({ method: 'POST', url: '/api/auth/accept-invite', headers: H, payload: { token, displayName: 'Hùng', password: PASSWORD, email: 'hung@shop.vn' } });
    expect(acc.statusCode).toBe(201);
    const cookie = String(([] as string[]).concat(acc.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().user).toMatchObject({ email: 'hung@shop.vn', displayName: 'Hùng', role: 'sale', tenantId, emailVerified: true });

    // Dùng lần hai: lỗi.
    const again = await app.inject({ method: 'POST', url: '/api/auth/accept-invite', headers: H, payload: { token, displayName: 'Khác', password: PASSWORD, email: 'khac@shop.vn' } });
    expect(again.statusCode).toBe(400);
  });

  it('hai người dùng cùng một liên kết đồng thời: chỉ một người thành công', async () => {
    const boss = await member('boss@shop.vn', 'manager');
    const token = tokenOf((await call(boss, 'POST', '/api/team/invites', { role: 'sale' })).json().link);
    const results = await Promise.all(
      ['a', 'b', 'c'].map((n) => app.inject({ method: 'POST', url: '/api/auth/accept-invite', headers: H, payload: { token, displayName: n, password: PASSWORD, email: `${n}@shop.vn` } })),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
  });

  it('hết hạn đúng biên 7 ngày', async () => {
    const boss = await member('boss@shop.vn', 'manager');
    const token = tokenOf((await call(boss, 'POST', '/api/team/invites', { role: 'sale' })).json().link);
    clock = new Date(clock.getTime() + INVITE_TTL_MS - 1);
    expect((await app.inject({ method: 'POST', url: '/api/auth/invite-info', headers: H, payload: { token } })).statusCode).toBe(200);
    clock = new Date(clock.getTime() + 1);
    expect((await app.inject({ method: 'POST', url: '/api/auth/invite-info', headers: H, payload: { token } })).statusCode).toBe(400);
  });

  it('lời mời gắn email: gửi thư; email khác bị từ chối; không gửi được thư vẫn tạo được lời mời', async () => {
    const boss = await member('boss@shop.vn', 'owner');
    const r = await call(boss, 'POST', '/api/team/invites', { role: 'sale', email: 'Nam@Shop.vn' });
    expect(r.json().emailed).toBe(true);
    expect(mailer.sent[0]!.to).toBe('Nam@Shop.vn');
    const token = tokenOf(r.json().link);
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/accept-invite', headers: H, payload: { token, displayName: 'X', password: PASSWORD, email: 'khac@shop.vn' } });
    expect(wrong.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/accept-invite', headers: H, payload: { token, displayName: 'Nam', password: PASSWORD } });
    expect(ok.statusCode).toBe(201);
    expect((await db.select().from(users).where(eq(users.email, 'nam@shop.vn'))).length).toBe(1);
    mailer.send = async () => {
      throw new Error('smtp down');
    };
    const r2 = await call(boss, 'POST', '/api/team/invites', { role: 'sale', email: 'b@shop.vn' });
    expect(r2.statusCode).toBe(201);
    expect(r2.json().emailed).toBe(false);
  });

  it('email đã có tài khoản (kể cả doanh nghiệp khác): 409 và lời mời còn dùng được', async () => {
    const [t2] = await db.insert(tenants).values({ name: 'Khác' }).returning({ id: tenants.id });
    await createUser(db, { email: 'chung@x.vn', password: PASSWORD, displayName: 'C', tenantId: t2!.id, role: 'sale' }, clock);
    const boss = await member('boss@shop.vn', 'manager');
    const token = tokenOf((await call(boss, 'POST', '/api/team/invites', { role: 'sale' })).json().link);
    const bad = await app.inject({ method: 'POST', url: '/api/auth/accept-invite', headers: H, payload: { token, displayName: 'C', password: PASSWORD, email: 'chung@x.vn' } });
    expect(bad.statusCode).toBe(409);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/accept-invite', headers: H, payload: { token, displayName: 'C', password: PASSWORD, email: 'moi@shop.vn' } });
    expect(ok.statusCode).toBe(201);
  });

  it('thu hồi lời mời thì không dùng được nữa', async () => {
    const boss = await member('boss@shop.vn', 'manager');
    const r = await call(boss, 'POST', '/api/team/invites', { role: 'sale' });
    const token = tokenOf(r.json().link);
    expect((await call(boss, 'POST', `/api/team/invites/${r.json().id}/revoke`)).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/invite-info', headers: H, payload: { token } })).statusCode).toBe(400);
    expect((await call(boss, 'POST', `/api/team/invites/${r.json().id}/revoke`)).statusCode).toBe(404);
  });
});

describe('quyền', () => {
  it('sale không vào được route đội (403)', async () => {
    const sale = await member('sale@shop.vn', 'sale');
    for (const [m, u] of [['GET', '/api/team'], ['POST', '/api/team/invites']] as const) expect((await call(sale, m, u, { role: 'sale' })).statusCode, u).toBe(403);
  });

  it('manager không mời, không cấp, không đổi, không gỡ owner', async () => {
    const owner = await member('owner@shop.vn', 'owner');
    const mgr = await member('mgr@shop.vn', 'manager');
    expect((await call(mgr, 'POST', '/api/team/invites', { role: 'owner' })).statusCode).toBe(403);
    expect((await call(mgr, 'PATCH', `/api/team/members/${owner.userId}`, { role: 'sale' })).statusCode).toBe(403);
    expect((await call(mgr, 'DELETE', `/api/team/members/${owner.userId}`)).statusCode).toBe(403);
    expect((await call(owner, 'POST', '/api/team/invites', { role: 'owner' })).statusCode).toBe(201);
  });

  it('hạ hoặc gỡ owner cuối cùng: 409 last_owner; có owner thứ hai thì được', async () => {
    const owner = await member('owner@shop.vn', 'owner');
    expect((await call(owner, 'PATCH', `/api/team/members/${owner.userId}`, { role: 'manager' })).json().error.code).toBe('last_owner');
    expect((await call(owner, 'DELETE', `/api/team/members/${owner.userId}`)).json().error.code).toBe('last_owner');
    const second = await member('o2@shop.vn', 'owner');
    expect((await call(owner, 'PATCH', `/api/team/members/${second.userId}`, { role: 'sale' })).statusCode).toBe(200);
  });

  it('hai owner cùng tự gỡ nhau đồng thời: vẫn còn đúng một owner', async () => {
    const a = await member('a@shop.vn', 'owner');
    const b = await member('b@shop.vn', 'owner');
    await Promise.all([call(a, 'DELETE', `/api/team/members/${b.userId}`), call(b, 'DELETE', `/api/team/members/${a.userId}`)]);
    const left = await db.select().from(users);
    expect(left).toHaveLength(1);
  });
});

describe('gỡ thành viên và đổi vai trò', () => {
  it('gỡ thành viên: cookie cũ của người đó vô hiệu ngay', async () => {
    const boss = await member('boss@shop.vn', 'manager');
    const sale = await member('sale@shop.vn', 'sale');
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sale.cookie } })).statusCode).toBe(200);
    expect((await call(boss, 'DELETE', `/api/team/members/${sale.userId}`)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sale.cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'sale@shop.vn', password: PASSWORD } })).statusCode).toBe(401);
  });

  it('đổi vai trò thu hồi phiên; người của doanh nghiệp khác thì 404', async () => {
    const boss = await member('boss@shop.vn', 'manager');
    const sale = await member('sale@shop.vn', 'sale');
    expect((await call(boss, 'PATCH', `/api/team/members/${sale.userId}`, { role: 'manager' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sale.cookie } })).statusCode).toBe(401);
    const [t2] = await db.insert(tenants).values({ name: 'Khác' }).returning({ id: tenants.id });
    const other = await member('o@khac.vn', 'sale', t2!.id);
    expect((await call(boss, 'PATCH', `/api/team/members/${other.userId}`, { role: 'sale' })).statusCode).toBe(404);
    expect((await call(boss, 'DELETE', `/api/team/members/${other.userId}`)).statusCode).toBe(404);
    expect((await db.select().from(users).where(eq(users.id, other.userId))).length).toBe(1);
  });

  it('danh sách đội và nhật ký không chứa token hay mật khẩu', async () => {
    const boss = await member('boss@shop.vn', 'manager');
    const r = await call(boss, 'POST', '/api/team/invites', { role: 'sale' });
    const list = await call(boss, 'GET', '/api/team');
    expect(list.json().members).toHaveLength(1);
    expect(list.json().invites).toHaveLength(1);
    expect(list.body).not.toContain(tokenOf(r.json().link));
    expect(JSON.stringify(await db.select().from(auditLog))).not.toMatch(/scrypt|token/i);
  });
});
