import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import { createUser } from '../src/auth/users.js';
import { conversations, pages, tenants } from '../src/db/schema.js';
import { loadHome } from '../src/followup/overview.js';
import { loadInboxPage } from '../src/followup/inbox.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const N = 2500;
const NOW = new Date('2026-11-11T03:00:00Z');
const PASSWORD = 'mat-khau-dai-123';
const H = { 'x-requested-with': 'salesmind', 'content-type': 'application/json' };

let tenantId: string;
let pageA: string;
let pageB: string;
let otherPage: string;
let cookie: string;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  await truncateAll(handle);
  const [t] = await db.insert(tenants).values({ name: 'Lớn' }).returning({ id: tenants.id });
  const [o] = await db.insert(tenants).values({ name: 'Khác' }).returning({ id: tenants.id });
  tenantId = t!.id;
  const mk = async (tid: string, fb: string, name: string) => (await db.insert(pages).values({ tenantId: tid, fbPageId: fb, name, tokenEnc: 'x' }).returning({ id: pages.id }))[0]!.id;
  pageA = await mk(tenantId, 'pa', 'Page A');
  pageB = await mk(tenantId, 'pb', 'Page B');
  otherPage = await mk(o!.id, 'po', 'Page Khác');
  // 2.500 hội thoại, hai Page xen kẽ, mỗi hội thoại một tin khách và một tin Page; thời điểm đều nhau theo phút.
  await db.execute(sql`
    INSERT INTO conversations (tenant_id, page_id, psid, display_name, last_message_at, last_user_interaction_at, last_page_message_at)
    SELECT ${tenantId}::uuid, CASE WHEN i % 2 = 0 THEN ${pageA}::uuid ELSE ${pageB}::uuid END, 'psid-' || i, 'Khách ' || i,
           ${NOW}::timestamptz - (i || ' minutes')::interval, ${NOW}::timestamptz - (i || ' minutes')::interval - interval '5 minutes', ${NOW}::timestamptz - (i || ' minutes')::interval
    FROM generate_series(1, ${N}) AS i`);
  await db.execute(sql`
    INSERT INTO messages (tenant_id, page_id, conversation_id, mid, direction, sender_kind, text, sent_at, source)
    SELECT c.tenant_id, c.page_id, c.id, 'in-' || c.psid, 'inbound'::message_direction, 'customer'::sender_kind, 'Cho mình hỏi sofa', c.last_user_interaction_at, 'webhook'::message_source FROM conversations c WHERE c.tenant_id = ${tenantId}::uuid
    UNION ALL
    SELECT c.tenant_id, c.page_id, c.id, 'out-' || c.psid, 'outbound'::message_direction, 'page_inbox'::sender_kind, 'Dạ còn ạ', c.last_page_message_at, 'webhook'::message_source FROM conversations c WHERE c.tenant_id = ${tenantId}::uuid`);
  await createUser(db, { email: 'm@lon.vn', password: PASSWORD, displayName: 'M', tenantId, role: 'manager', emailVerified: true }, NOW);
  app = buildApp({}, {
    appSecret: 's',
    verifyToken: 'v',
    queue: { enqueue: async () => {} },
    api: { db, crypto: undefined as never, log: { info: () => {}, warn: () => {} }, demoMode: false },
    auth: { db, mailer: new MemoryMailer(), signupOpen: false, publicBaseUrl: 'http://localhost:3000', rateLimit: { max: 10_000, timeWindowMs: 60_000 } },
  });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'm@lon.vn', password: PASSWORD } });
  cookie = String(([] as string[]).concat(res.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
}, 120_000);
afterAll(async () => {
  await handle.close();
});

async function walk(pageId?: string, between?: () => Promise<void>) {
  const seen: string[] = [];
  let cursor: string | undefined;
  let pagesCount = 0;
  do {
    const r = await loadInboxPage(db, tenantId, NOW, { limit: 100, cursor, pageId });
    seen.push(...r.conversations.map((c) => c.id));
    cursor = r.nextCursor ?? undefined;
    pagesCount += 1;
    if (pagesCount === 3 && between) await between();
  } while (cursor);
  return { seen, pagesCount };
}

describe('hộp thư 2.500 hội thoại, hai Page', () => {
  it('lật hết các trang: đủ 2.500 dòng, không trùng, đúng thứ tự mới nhất trước', async () => {
    const { seen, pagesCount } = await walk();
    expect(seen).toHaveLength(N);
    expect(new Set(seen).size).toBe(N);
    expect(pagesCount).toBe(25);
    const first = await loadInboxPage(db, tenantId, NOW, { limit: 3 });
    expect(first.conversations.map((c) => c.displayName)).toEqual(['Khách 1', 'Khách 2', 'Khách 3']);
  });

  it('có tin mới chen vào giữa lúc đang lật trang: không dòng nào bị trùng', async () => {
    const { seen } = await walk(undefined, async () => {
      await db.execute(sql`UPDATE conversations SET last_message_at = ${NOW}::timestamptz + interval '1 hour' WHERE tenant_id = ${tenantId}::uuid AND psid IN ('psid-1000', 'psid-2000')`);
    });
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(N - 2);
  });

  it('lọc theo Page: chỉ hội thoại của Page đó, kèm tên Page', async () => {
    const { seen } = await walk(pageA);
    expect(seen).toHaveLength(N / 2);
    const r = await loadInboxPage(db, tenantId, NOW, { limit: 5, pageId: pageB });
    expect(r.conversations.every((c) => c.pageId === pageB && c.pageName === 'Page B')).toBe(true);
  });

  it('hội thoại chưa có tin nằm cuối và vẫn phân trang đúng', async () => {
    await db.insert(conversations).values({ tenantId, pageId: pageA, psid: 'rong-1' });
    await db.insert(conversations).values({ tenantId, pageId: pageA, psid: 'rong-2' });
    const { seen } = await walk();
    expect(seen).toHaveLength(N + 2);
    expect(new Set(seen).size).toBe(N + 2);
    await db.execute(sql`DELETE FROM conversations WHERE psid LIKE 'rong-%'`);
  });

  it('API: limit mặc định 50, nextCursor có; pageId của doanh nghiệp khác 404; con trỏ hỏng 400; limit quá lớn 400', async () => {
    const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
    const r = await get('/api/inbox');
    expect(r.statusCode).toBe(200);
    expect(r.json().conversations).toHaveLength(50);
    expect(r.json().nextCursor).toBeTruthy();
    const next = await get(`/api/inbox?cursor=${encodeURIComponent(r.json().nextCursor)}`);
    expect(next.json().conversations[0].id).not.toBe(r.json().conversations[0].id);
    expect((await get(`/api/inbox?pageId=${otherPage}`)).statusCode).toBe(404);
    expect((await get('/api/inbox?cursor=hong')).statusCode).toBe(400);
    expect((await get('/api/inbox?limit=1000')).statusCode).toBe(400);
  });

  it('Trang chủ trên 2.500 hội thoại: đúng kết quả và dưới 3 giây', async () => {
    const t0 = performance.now();
    const home = await loadHome(db, tenantId, NOW);
    const ms = performance.now() - t0;
    expect(home.p1).toEqual([]); // không có tín hiệu mua
    expect(home.overdue).toEqual([]);
    expect(ms).toBeLessThan(3000);
  });

  it('chi tiết một hội thoại không phải nạp cả doanh nghiệp (dưới 500 ms)', async () => {
    const [c] = await db.select({ id: conversations.id }).from(conversations).limit(1);
    const t0 = performance.now();
    const r = await app.inject({ method: 'GET', url: `/api/conversations/${c!.id}`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
