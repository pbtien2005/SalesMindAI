import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { checkAndReserve, recordUsage, usageToday, vnDay } from '../src/ai/budget.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import { createUser } from '../src/auth/users.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { aiUsage, conversations, extractionRuns, messages, pages, tenants } from '../src/db/schema.js';
import { runExtraction } from '../src/extraction/run.js';
import type { Extractor } from '../src/extraction/types.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const log = { info: () => {}, warn: () => {} };
const T = new Date('2026-11-11T05:00:00Z'); // 12:00 giờ Việt Nam
const PASSWORD = 'mat-khau-dai-123';
const H = { 'x-requested-with': 'salesmind', 'content-type': 'application/json' };

beforeEach(async () => {
  await truncateAll(handle);
});
afterAll(async () => {
  await handle.close();
});

const mkTenant = async (name: string, aiEnabled = true, cap: number | null = null) =>
  (await db.insert(tenants).values({ name, aiExtractionEnabled: aiEnabled, aiEnabledAt: new Date('2020-01-01'), aiDailyCap: cap }).returning({ id: tenants.id }))[0]!.id;

describe('vnDay', () => {
  it('đổi ngày đúng lúc nửa đêm giờ Việt Nam (17:00 UTC)', () => {
    expect(vnDay(new Date('2026-11-11T16:59:59Z'))).toBe('2026-11-11');
    expect(vnDay(new Date('2026-11-11T17:00:00Z'))).toBe('2026-11-12');
  });
});

describe('checkAndReserve', () => {
  it('20 lời gọi đồng thời với hạn mức 5: đúng 5 lời gọi được giữ chỗ', async () => {
    const t = await mkTenant('A');
    const r = await Promise.all(Array.from({ length: 20 }, () => checkAndReserve(db, t, T, 5)));
    expect(r.filter((x) => x.allowed)).toHaveLength(5);
    expect((await usageToday(db, t, T)).calls).toBe(5);
  });

  it('doanh nghiệp A hết hạn mức không ảnh hưởng B; sang ngày mới thì làm mới', async () => {
    const a = await mkTenant('A');
    const b = await mkTenant('B');
    for (let i = 0; i < 3; i++) await checkAndReserve(db, a, T, 3);
    expect((await checkAndReserve(db, a, T, 3)).allowed).toBe(false);
    expect((await checkAndReserve(db, b, T, 3)).allowed).toBe(true);
    const next = new Date('2026-11-11T17:00:01Z'); // 00:00:01 hôm sau, giờ VN
    expect((await checkAndReserve(db, a, next, 3)).allowed).toBe(true);
  });

  it('hạn mức 0 thì không cho; recordUsage cộng dồn token và không đổi số lời gọi', async () => {
    const t = await mkTenant('A');
    expect((await checkAndReserve(db, t, T, 0)).allowed).toBe(false);
    await checkAndReserve(db, t, T, 10);
    await recordUsage(db, t, { inputTokens: 100, outputTokens: 20 }, T);
    await recordUsage(db, t, { inputTokens: 50, outputTokens: 5 }, T);
    expect(await usageToday(db, t, T)).toEqual({ calls: 1, inputTokens: 150, outputTokens: 25 });
  });
});

async function seedConversation(tenantId: string, psid: string) {
  let [p] = await db.select({ id: pages.id }).from(pages).where(eq(pages.tenantId, tenantId));
  if (!p) [p] = await db.insert(pages).values({ tenantId, fbPageId: `fb-${tenantId}`, name: 'P', tokenEnc: 'x' }).returning({ id: pages.id });
  const at = new Date('2026-11-10T01:00:00Z');
  const [c] = await db.insert(conversations).values({ tenantId, pageId: p!.id, psid, lastMessageAt: at, lastUserInteractionAt: at }).returning({ id: conversations.id });
  await db.insert(messages).values({ tenantId, pageId: p!.id, conversationId: c!.id, mid: `mid-${psid}`, text: 'Mình cần mua sofa', sentAt: at, source: 'webhook' });
  return c!.id;
}

describe('runExtraction với hạn mức', () => {
  const ok: Extractor & { calls: number } = {
    model: 'fake',
    calls: 0,
    async extract() {
      this.calls += 1;
      return { kind: 'ok', candidates: [], usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0 } };
    },
  };

  it('hết hạn mức: bỏ qua (không gọi mô hình, không ghi run), doanh nghiệp khác vẫn chạy', async () => {
    ok.calls = 0;
    const a = await mkTenant('A', true, 2);
    const b = await mkTenant('B', true, 2);
    const deps = { db, extractor: ok, log, contextMessages: 30, budget: { defaultCap: 500, now: () => T } };
    const ca = [await seedConversation(a, 'a1'), await seedConversation(a, 'a2'), await seedConversation(a, 'a3')];
    const cb = await seedConversation(b, 'b1');
    expect((await runExtraction(deps, ca[0]!)).status).toBe('succeeded');
    expect((await runExtraction(deps, ca[1]!)).status).toBe('succeeded');
    expect(await runExtraction(deps, ca[2]!)).toEqual({ status: 'skipped', reason: 'budget_exhausted' });
    expect(ok.calls).toBe(2);
    expect((await db.select().from(extractionRuns).where(eq(extractionRuns.conversationId, ca[2]!)))).toHaveLength(0);
    expect((await runExtraction(deps, cb)).status).toBe('succeeded');
    expect(await usageToday(db, a, T)).toMatchObject({ calls: 2, inputTokens: 20, outputTokens: 4 });
  });

  it('sang ngày mới thì chạy lại được việc đã bị bỏ qua', async () => {
    const a = await mkTenant('A', true, 1);
    const c1 = await seedConversation(a, 'a1');
    const c2 = await seedConversation(a, 'a2');
    const day1 = { db, extractor: ok, log, contextMessages: 30, budget: { defaultCap: 500, now: () => T } };
    await runExtraction(day1, c1);
    expect((await runExtraction(day1, c2)).status).toBe('skipped');
    const day2 = { ...day1, budget: { defaultCap: 500, now: () => new Date('2026-11-11T17:00:01Z') } };
    expect((await runExtraction(day2, c2)).status).toBe('succeeded');
  });

  it('mô hình ném lỗi tạm thời: trả lại lượt đã giữ (không mất hạn mức vì lỗi mạng)', async () => {
    const a = await mkTenant('A', true, 5);
    const c = await seedConversation(a, 'a1');
    const boom: Extractor = { model: 'fake', extract: async () => { throw new Error('mạng'); } };
    await expect(runExtraction({ db, extractor: boom, log, contextMessages: 30, budget: { defaultCap: 500, now: () => T } }, c)).rejects.toThrow('mạng');
    expect((await usageToday(db, a, T)).calls).toBe(0);
  });

  it('tắt AI: tin vẫn có nhưng không trích và không tốn hạn mức', async () => {
    const a = await mkTenant('A', false, 5);
    const c = await seedConversation(a, 'a1');
    ok.calls = 0;
    expect(await runExtraction({ db, extractor: ok, log, contextMessages: 30, budget: { defaultCap: 500, now: () => T } }, c)).toEqual({ status: 'skipped', reason: 'ai_disabled' });
    expect(ok.calls).toBe(0);
    expect(await db.select().from(aiUsage)).toHaveLength(0);
  });
});

describe('API AI', () => {
  const crypto = createTokenCrypto(randomBytes(32).toString('base64'));
  const app = buildApp({}, {
    appSecret: 's',
    verifyToken: 'v',
    queue: { enqueue: async () => {} },
    api: { db, crypto, log, demoMode: false, ai: { mode: 'live', defaultCap: 500 } },
    auth: { db, mailer: new MemoryMailer(), signupOpen: false, publicBaseUrl: 'http://localhost:3000', rateLimit: { max: 10_000, timeWindowMs: 60_000 } },
  });
  async function who(role: 'owner' | 'manager' | 'sale', tenantId?: string) {
    const tid = tenantId ?? (await mkTenant(`T-${role}`, false));
    const email = `${role}-${tid.slice(-6)}@x.vn`;
    const { userId } = await createUser(db, { email, password: PASSWORD, displayName: role, tenantId: tid, role, emailVerified: true }, new Date());
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, password: PASSWORD } });
    return { tenantId: tid, userId, cookie: String(([] as string[]).concat(res.headers['set-cookie'] as string | string[])[0]).split(';')[0]! };
  }
  const call = (u: { cookie: string }, method: 'GET' | 'POST', url: string, body?: unknown) =>
    app.inject({ method, url, headers: { ...H, cookie: u.cookie }, ...(method === 'POST' ? { payload: (body ?? {}) as object } : {}) });

  it('chỉ owner bật và tắt; manager xem được mức dùng; sale không vào được', async () => {
    const owner = await who('owner');
    const mgr = await who('manager', owner.tenantId);
    const sale = await who('sale', owner.tenantId);
    expect((await call(mgr, 'POST', '/api/ai/enable', { acknowledgeLegal: true })).statusCode).toBe(403);
    expect((await call(sale, 'POST', '/api/ai/disable')).statusCode).toBe(403);
    expect((await call(sale, 'GET', '/api/ai')).statusCode).toBe(403);
    expect((await call(mgr, 'GET', '/api/ai')).statusCode).toBe(200);
  });

  it('bật cần xác nhận pháp lý: thiếu thì 422 và vẫn tắt; đủ thì ghi người và thời điểm đồng ý; tắt lại được', async () => {
    const owner = await who('owner');
    const no = await call(owner, 'POST', '/api/ai/enable', {});
    expect(no.statusCode).toBe(422);
    expect(no.json().error.code).toBe('consent_required');
    expect((await call(owner, 'GET', '/api/ai')).json().enabled).toBe(false);
    expect((await call(owner, 'POST', '/api/ai/enable', { acknowledgeLegal: false })).statusCode).toBe(422);
    expect((await call(owner, 'POST', '/api/ai/enable', { acknowledgeLegal: true })).statusCode).toBe(200);
    const [t] = await db.select().from(tenants).where(eq(tenants.id, owner.tenantId));
    expect(t).toMatchObject({ aiExtractionEnabled: true, aiConsentBy: owner.userId });
    expect(t!.aiConsentAt).not.toBeNull();
    const st = (await call(owner, 'GET', '/api/ai')).json();
    expect(st).toMatchObject({ enabled: true, mode: 'live', cap: 500, today: { calls: 0 } });
    expect((await call(owner, 'POST', '/api/ai/disable')).json()).toEqual({ enabled: false });
  });

  it('bật AI của doanh nghiệp này không bật AI của doanh nghiệp khác', async () => {
    const a = await who('owner');
    const b = await who('owner');
    await call(a, 'POST', '/api/ai/enable', { acknowledgeLegal: true });
    expect((await call(b, 'GET', '/api/ai')).json().enabled).toBe(false);
  });
});
