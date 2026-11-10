import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import { createUser } from '../src/auth/users.js';
import { sessions, tenants, users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const PASSWORD = 'mat-khau-dai-123';
const H = { 'x-requested-with': 'salesmind', 'content-type': 'application/json' };

let clock = new Date('2026-11-10T03:00:00Z');
let mailer: MemoryMailer;

function makeApp(signupOpen = false) {
  mailer = new MemoryMailer();
  return buildApp({}, {
    appSecret: 's',
    verifyToken: 'v',
    queue: { enqueue: async () => {} },
    auth: { db, mailer, signupOpen, publicBaseUrl: 'http://localhost:3000', now: () => clock, rateLimit: { max: 1000, timeWindowMs: 60_000 } },
  });
}

let app: ReturnType<typeof makeApp>;
let tenantId: string;
beforeEach(async () => {
  await truncateAll(handle);
  clock = new Date('2026-11-10T03:00:00Z');
  app = makeApp();
  const [t] = await db.insert(tenants).values({ name: 'Shop' }).returning({ id: tenants.id });
  tenantId = t!.id;
  await createUser(db, { email: 'lan@shop.vn', password: PASSWORD, displayName: 'Lan', tenantId, role: 'sale' }, clock);
});
afterAll(async () => {
  await handle.close();
});

const post = (url: string, body: unknown, cookie?: string, headers = H) =>
  app.inject({ method: 'POST', url, payload: body as object, headers: { ...headers, ...(cookie ? { cookie } : {}) } });
const login = async (email = 'lan@shop.vn', password = PASSWORD) => post('/api/auth/login', { email, password });
const cookieOf = (res: { headers: Record<string, unknown> }) => String(([] as string[]).concat(res.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;

describe('đăng nhập', () => {
  it('đúng: đặt cookie HttpOnly SameSite=Lax, không có token trong body', async () => {
    const res = await login();
    expect(res.statusCode).toBe(200);
    const raw = String(([] as string[]).concat(res.headers['set-cookie'] as string | string[])[0]);
    expect(raw).toMatch(/^sm_session=/);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(res.body).not.toContain(raw.split(';')[0]!.split('=')[1]!);
  });

  it('email lạ và mật khẩu sai trả đúng cùng một mã và cùng một body', async () => {
    const a = await login('khong-co@shop.vn', PASSWORD);
    const b = await login('lan@shop.vn', 'sai-mat-khau-123');
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.body).toBe(b.body);
    expect(a.headers['set-cookie']).toBeUndefined();
  });

  it('thân sai dạng cũng chỉ 401 chung', async () => {
    const res = await post('/api/auth/login', { email: 5 });
    expect(res.statusCode).toBe(401);
  });

  it('sai 5 lần thì khóa 15 phút: lần đúng trong thời gian khóa vẫn 401, sau đó vào được', async () => {
    for (let i = 0; i < 5; i++) expect((await login('lan@shop.vn', 'sai-mat-khau-123')).statusCode).toBe(401);
    const locked = await login();
    expect(locked.statusCode).toBe(401);
    expect(locked.body).toBe((await login('khong-co@shop.vn', 'x')).body);
    clock = new Date(clock.getTime() + 15 * 60_000 - 1000);
    expect((await login()).statusCode).toBe(401);
    clock = new Date(clock.getTime() + 2000);
    expect((await login()).statusCode).toBe(200);
  });

  it('đăng nhập đúng xóa bộ đếm sai', async () => {
    for (let i = 0; i < 4; i++) await login('lan@shop.vn', 'sai-mat-khau-123');
    expect((await login()).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) await login('lan@shop.vn', 'sai-mat-khau-123');
    expect((await login()).statusCode).toBe(200);
  });

  it('người dùng bị vô hiệu không vào được', async () => {
    await db.update(users).set({ status: 'disabled' });
    expect((await login()).statusCode).toBe(401);
  });
});

describe('me, đăng xuất, CSRF', () => {
  it('me không cookie thì 401; có cookie thì đúng người; đăng xuất thì cookie hết dùng', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    const cookie = cookieOf(await login());
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ email: 'lan@shop.vn', displayName: 'Lan', role: 'sale', tenantId, emailVerified: false, demoTenant: false });
    expect((await post('/api/auth/logout', {}, cookie)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('POST thiếu x-requested-with thì 403', async () => {
    const res = await post('/api/auth/login', { email: 'lan@shop.vn', password: PASSWORD }, undefined, { 'content-type': 'application/json' } as never);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf');
  });

  it('Origin khác Host thì 403; cùng Host thì qua', async () => {
    const bad = await post('/api/auth/login', { email: 'lan@shop.vn', password: PASSWORD }, undefined, { ...H, origin: 'https://evil.example', host: 'localhost:3000' } as never);
    expect(bad.statusCode).toBe(403);
    const ok = await post('/api/auth/login', { email: 'lan@shop.vn', password: PASSWORD }, undefined, { ...H, origin: 'http://localhost:3000', host: 'localhost:3000' } as never);
    expect(ok.statusCode).toBe(200);
  });
});

describe('quên và đặt lại mật khẩu', () => {
  const tokenFrom = (text: string) => /reset=([A-Za-z0-9_-]{43})/.exec(text)![1]!;

  it('email lạ vẫn 202 và không gửi thư; email có thật gửi một thư', async () => {
    expect((await post('/api/auth/forgot', { email: 'khong-co@shop.vn' })).statusCode).toBe(202);
    expect(mailer.sent).toHaveLength(0);
    expect((await post('/api/auth/forgot', { email: 'lan@shop.vn' })).statusCode).toBe(202);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe('lan@shop.vn');
  });

  it('đặt lại: dùng được một lần, mọi phiên cũ vô hiệu, mật khẩu mới dùng được', async () => {
    const cookie = cookieOf(await login());
    await post('/api/auth/forgot', { email: 'lan@shop.vn' });
    const token = tokenFrom(mailer.sent[0]!.text);
    expect((await post('/api/auth/reset', { token, password: 'mat-khau-moi-456' })).statusCode).toBe(200);
    expect((await post('/api/auth/reset', { token, password: 'mat-khau-moi-789' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(401);
    expect((await login('lan@shop.vn', 'mat-khau-moi-456')).statusCode).toBe(200);
  });

  it('mật khẩu mới quá yếu thì 422 và chưa tiêu thụ token', async () => {
    await post('/api/auth/forgot', { email: 'lan@shop.vn' });
    const token = tokenFrom(mailer.sent[0]!.text);
    expect((await post('/api/auth/reset', { token, password: 'ngan' })).statusCode).toBe(422);
    expect((await post('/api/auth/reset', { token, password: 'mat-khau-moi-456' })).statusCode).toBe(200);
  });

  it('token hết hạn sau 1 giờ', async () => {
    await post('/api/auth/forgot', { email: 'lan@shop.vn' });
    const token = tokenFrom(mailer.sent[0]!.text);
    clock = new Date(clock.getTime() + 3_600_000);
    expect((await post('/api/auth/reset', { token, password: 'mat-khau-moi-456' })).statusCode).toBe(400);
  });
});

describe('đổi mật khẩu', () => {
  it('cần mật khẩu hiện tại; đổi xong phiên khác bị thu hồi, phiên hiện tại giữ', async () => {
    const c1 = cookieOf(await login());
    const c2 = cookieOf(await login());
    expect((await post('/api/auth/change-password', { currentPassword: 'sai-mat-khau-123', newPassword: 'mat-khau-moi-456' }, c1)).statusCode).toBe(403);
    expect((await post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'mat-khau-moi-456' }, c1)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: c1 } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: c2 } })).statusCode).toBe(401);
  });
});

describe('đăng ký tự do', () => {
  it('đang đóng thì 404', async () => {
    expect((await post('/api/auth/signup', { email: 'a@b.vn', password: PASSWORD, displayName: 'A', businessName: 'B' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/auth/config' })).json()).toEqual({ signupOpen: false, demoLogin: false });
  });

  it('mở: tạo tenant và owner, gửi thư xác minh, xác minh được; email đã có vẫn 202 và không tạo thêm', async () => {
    app = makeApp(true);
    const body = { email: 'chu@moi.vn', password: PASSWORD, displayName: 'Chủ', businessName: 'Cửa hàng Mới' };
    expect((await post('/api/auth/signup', body)).statusCode).toBe(202);
    expect(mailer.sent).toHaveLength(1);
    const token = /verify=([A-Za-z0-9_-]{43})/.exec(mailer.sent[0]!.text)![1]!;
    const cookie = cookieOf(await login('chu@moi.vn'));
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json().user).toMatchObject({ role: 'owner', emailVerified: false, demoTenant: false });
    expect((await post('/api/auth/verify-email', { token })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json().user.emailVerified).toBe(true);
    expect((await post('/api/auth/verify-email', { token })).statusCode).toBe(400);

    const tenantsBefore = (await db.select().from(tenants)).length;
    expect((await post('/api/auth/signup', body)).statusCode).toBe(202);
    expect((await db.select().from(tenants)).length).toBe(tenantsBefore);
  });

  it('mật khẩu yếu thì 422', async () => {
    app = makeApp(true);
    const res = await post('/api/auth/signup', { email: 'x@y.vn', password: 'ngan', displayName: 'A', businessName: 'B' });
    expect(res.statusCode).toBe(422);
  });
});

describe('phiên trong DB', () => {
  it('đăng xuất xóa dòng phiên', async () => {
    const cookie = cookieOf(await login());
    expect(await db.select().from(sessions)).toHaveLength(1);
    await post('/api/auth/logout', {}, cookie);
    expect(await db.select().from(sessions).where(eq(sessions.userId, (await db.select().from(users))[0]!.id))).toHaveLength(0);
  });
});
