/**
 * Cách ly giữa các doanh nghiệp. Test TỰ LIỆT KÊ mọi route `/api/*` có tham số và thử bằng id của tenant khác:
 * thêm route mới mà chưa khai báo ca kiểm ở `CASES` thì test ĐỎ, buộc người thêm phải nghĩ tới cách ly.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import { createUser } from '../src/auth/users.js';
import { createInvite } from '../src/auth/invites.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { conversations, extractionRuns, messages, pages, proposals, tasks, tenants } from '../src/db/schema.js';
import { advanceClock } from '../src/demo/clock.js';
import { resetDemo } from '../src/demo/seed.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));
const log = { info: () => {}, warn: () => {} };
const PASSWORD = 'mat-khau-dai-123';
const H = { 'x-requested-with': 'salesmind', 'content-type': 'application/json' };

const registered: Array<{ method: string; url: string }> = [];
const app = buildApp({}, {
  appSecret: 's',
  verifyToken: 'v',
  queue: { enqueue: async () => {} },
  api: { db, crypto, log, demoMode: true },
  auth: { db, mailer: new MemoryMailer(), signupOpen: false, demoMode: true, publicBaseUrl: 'http://localhost:3000', rateLimit: { max: 10_000, timeWindowMs: 60_000 } },
});
app.addHook('onRoute', (r) => {
  for (const m of ([] as string[]).concat(r.method as string | string[])) registered.push({ method: m, url: r.url });
});

interface Tenant {
  tenantId: string;
  conversationId: string;
  proposalId: string;
  userId: string;
  inviteId: string;
  pageId: string;
  cookie: string;
  name: string;
}

async function seedTenant(name: string, email: string): Promise<Tenant> {
  const [t] = await db.insert(tenants).values({ name, aiExtractionEnabled: true }).returning({ id: tenants.id });
  const tenantId = t!.id;
  const { userId } = await createUser(db, { email, password: PASSWORD, displayName: `Người của ${name}`, tenantId, role: 'manager', emailVerified: true }, new Date());
  const inv = await createInvite(db, { tenantId, userId, role: 'manager' }, { role: 'sale' }, new Date());
  const [p] = await db.insert(pages).values({ tenantId, fbPageId: `page-${name}`, name: `Page ${name}`, tokenEnc: 'x' }).returning({ id: pages.id });
  const at = new Date('2026-11-09T01:00:00Z');
  const [c] = await db
    .insert(conversations)
    .values({ tenantId, pageId: p!.id, psid: `psid-${name}`, displayName: `Khách của ${name}`, lastMessageAt: at, lastUserInteractionAt: at })
    .returning({ id: conversations.id });
  const [m] = await db
    .insert(messages)
    .values({ tenantId, pageId: p!.id, conversationId: c!.id, mid: `mid-${name}`, text: 'Cho mình hỏi sofa tầm 15 triệu', sentAt: at, source: 'webhook' })
    .returning({ id: messages.id });
  const [run] = await db
    .insert(extractionRuns)
    .values({ tenantId, conversationId: c!.id, upToMessageId: m!.id, promptVersion: 'v1', model: 'test', status: 'succeeded' })
    .returning({ id: extractionRuns.id });
  const [pr] = await db
    .insert(proposals)
    .values({ tenantId, conversationId: c!.id, runId: run!.id, field: 'phone', value: { text: '0912345678' }, evidence: [] })
    .returning({ id: proposals.id });
  await db.insert(tasks).values({ tenantId, conversationId: c!.id, title: `Việc của ${name}`, dueAt: new Date('2026-11-01T00:00:00Z') });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, password: PASSWORD } });
  const cookie = String(([] as string[]).concat(login.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
  return { tenantId, conversationId: c!.id, proposalId: pr!.id, userId, inviteId: inv.id, pageId: p!.id, cookie, name };
}

let A: Tenant;
let B: Tenant;
beforeAll(async () => {
  await app.ready();
});
beforeEach(async () => {
  await truncateAll(handle);
  A = await seedTenant('A', 'a@a.vn');
  B = await seedTenant('B', 'b@b.vn');
});
afterAll(async () => {
  await app.close();
  await handle.close();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const as = (t: Tenant, method: Method, url: string, body?: unknown) => {
  const hasBody = method === 'POST' || method === 'PATCH';
  return app.inject({ method, url, headers: { 'x-requested-with': 'salesmind', cookie: t.cookie, ...(hasBody ? { 'content-type': 'application/json' } : {}) }, ...(hasBody ? { payload: (body ?? {}) as object } : {}) });
};

/** Mỗi route có tham số `:id` phải có một ca: id của tenant B dùng bởi người của A. */
const CASES: Record<string, (b: Tenant) => { method: Method; url: string; body?: unknown }> = {
  'GET /api/conversations/:id': (b) => ({ method: 'GET', url: `/api/conversations/${b.conversationId}` }),
  'GET /api/conversations/:id/history': (b) => ({ method: 'GET', url: `/api/conversations/${b.conversationId}/history` }),
  'POST /api/conversations/:id/stop-followup': (b) => ({ method: 'POST', url: `/api/conversations/${b.conversationId}/stop-followup` }),
  'POST /api/team/invites/:id/revoke': (b) => ({ method: 'POST', url: `/api/team/invites/${b.inviteId}/revoke` }),
  'PATCH /api/team/members/:userId': (b) => ({ method: 'PATCH', url: `/api/team/members/${b.userId}`, body: { role: 'sale' } }),
  'DELETE /api/team/members/:userId': (b) => ({ method: 'DELETE', url: `/api/team/members/${b.userId}` }),
  'POST /api/pages/:id/disconnect': (b) => ({ method: 'POST', url: `/api/pages/${b.pageId}/disconnect` }),
  'POST /api/pages/:id/backfill': (b) => ({ method: 'POST', url: `/api/pages/${b.pageId}/backfill` }),
  'POST /api/proposals/:id/decide': (b) => ({ method: 'POST', url: `/api/proposals/${b.proposalId}/decide`, body: { action: 'dismiss' } }),
};

const TABLES = ['conversations', 'messages', 'proposals', 'profile_fields', 'tasks', 'followup_state', 'extraction_runs', 'users', 'memberships', 'tenants', 'invitations'];
async function snapshot() {
  const out: Record<string, unknown> = {};
  for (const t of TABLES) out[t] = (await db.execute(sql.raw(`SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x::text), '')) AS h FROM "${t}" x`))).rows[0];
  return out;
}

describe('cách ly dữ liệu giữa hai doanh nghiệp', () => {
  it('mọi route /api có tham số đều có ca kiểm trong CASES (route mới mà thiếu ca thì test đỏ)', () => {
    const withParams = registered.filter((r) => r.url.startsWith('/api/') && r.url.includes(':') && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method)).map((r) => `${r.method} ${r.url}`);
    expect(withParams.length).toBeGreaterThan(0);
    const missing = withParams.filter((k) => !(k in CASES));
    expect(missing, `Thiếu ca cách ly cho: ${missing.join(', ')}`).toEqual([]);
    const stale = Object.keys(CASES).filter((k) => !withParams.includes(k));
    expect(stale, `Ca kiểm cho route không còn tồn tại: ${stale.join(', ')}`).toEqual([]);
  });

  for (const [key, build] of Object.entries(CASES)) {
    it(`${key}: id của doanh nghiệp khác → 404 và không đổi dòng dữ liệu nào`, async () => {
      const before = await snapshot();
      const c = build(B);
      const res = await as(A, c.method, c.url, c.body);
      expect(res.statusCode).toBe(404);
      expect(JSON.stringify(res.json())).not.toContain('Khách của B');
      expect(await snapshot()).toEqual(before);
      // Đối chứng: chính chủ gọi được (không phải 404 chung chung vì route hỏng).
      const own = build(A);
      const ok = await as(A, own.method, own.url, own.body);
      expect([200, 409, 503]).toContain(ok.statusCode);
      if (key.startsWith('DELETE') || key.includes('/disconnect')) return; // chính chủ tự gỡ mình là owner/manager cuối: không kiểm tiếp
    });
  }

  it('Inbox, Trang chủ, quá hạn chỉ có dữ liệu của chính doanh nghiệp', async () => {
    for (const url of ['/api/inbox', '/api/home', '/api/overdue']) {
      const body = (await as(A, 'GET', url)).body;
      expect(body, url).toContain('Khách của A');
      expect(body, url).not.toContain('Khách của B');
      expect(body, url).not.toContain('Việc của B');
    }
  });

  it('id không phải UUID cũng 404, không phải 400 (không phân biệt "sai dạng" với "của người khác")', async () => {
    expect((await as(A, 'GET', '/api/conversations/khong-phai-uuid')).statusCode).toBe(404);
    expect((await as(A, 'POST', '/api/proposals/khong-phai-uuid/decide', { action: 'accept' })).statusCode).toBe(404);
  });

  it('route demo: người ngoài tenant demo bị 403 và không đụng gì', async () => {
    await resetDemo({ db, crypto, log });
    const before = await snapshot();
    for (const [url, body] of [
      ['/api/clock/advance', { minutes: 60 }],
      ['/api/demo/reset', {}],
      ['/api/demo/customer-message', { conversationId: B.conversationId, text: 'xin chào' }],
      ['/api/demo/page-message', { conversationId: B.conversationId, text: 'xin chào' }],
    ] as const) {
      const r = await as(A, 'POST', url, body);
      expect(r.statusCode, url).toBe(403);
      expect(r.json().error.code).toBe('not_demo_tenant');
    }
    expect(await snapshot()).toEqual(before);
  });

  it('người dùng tenant demo gửi giả lập vào hội thoại của tenant khác → 404', async () => {
    await resetDemo({ db, crypto, log });
    const login = await app.inject({ method: 'POST', url: '/api/auth/demo-login', headers: H, payload: { as: 'lan' } });
    const cookie = String(([] as string[]).concat(login.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
    const demo = { ...A, cookie };
    const before = await snapshot();
    for (const url of ['/api/demo/customer-message', '/api/demo/page-message']) {
      expect((await as(demo, 'POST', url, { conversationId: B.conversationId, text: 'xin chào' })).statusCode, url).toBe(404);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('đồng hồ demo chỉ ảnh hưởng tenant demo; tenant thường luôn dùng giờ thật', async () => {
    await resetDemo({ db, crypto, log });
    await advanceClock(db, 60 * 24 * 5);
    const real = Date.now();
    const a = new Date((await as(A, 'GET', '/api/now')).json().now).getTime();
    expect(Math.abs(a - real)).toBeLessThan(10_000);
    const login = await app.inject({ method: 'POST', url: '/api/auth/demo-login', headers: H, payload: { as: 'ha' } });
    const cookie = String(([] as string[]).concat(login.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
    const d = new Date((await as({ ...A, cookie }, 'GET', '/api/now')).json().now).getTime();
    expect(d - real).toBeGreaterThan(4 * 86_400_000);
  });

  it('demo-login không cấp phiên cho tài khoản thường', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/demo-login', headers: H, payload: { as: 'lan' } });
    // Chưa có dữ liệu demo: 409 và không có cookie.
    expect(r.statusCode).toBe(409);
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('demo:reset giữ nguyên phiên đăng nhập của Lan và chị Hà', async () => {
    await resetDemo({ db, crypto, log });
    const login = await app.inject({ method: 'POST', url: '/api/auth/demo-login', headers: H, payload: { as: 'lan' } });
    const cookie = String(([] as string[]).concat(login.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
    await resetDemo({ db, crypto, log });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ displayName: 'Lan', role: 'sale' });
  });
});
