import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resubscribePages } from '../src/auth/resubscribe.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { pages, tenants } from '../src/db/schema.js';
import { GraphApiError } from '../src/meta/graph-client.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));
const OLD = new Date('2026-01-01T00:00:00Z');

beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

async function seed(fbPageId: string, status: 'active' | 'token_invalid' = 'active', subscribedAt: Date | null = OLD) {
  const [t] = await db.insert(tenants).values({ name: 'A' }).returning();
  const [p] = await db
    .insert(pages)
    .values({ tenantId: t!.id, fbPageId, name: `Page ${fbPageId}`, tokenEnc: crypto.encrypt(`TOKEN_${fbPageId}`, fbPageId), status, subscribedAt })
    .returning();
  return p!;
}

const row = async (fbPageId: string) => (await db.select().from(pages).where(eq(pages.fbPageId, fbPageId)))[0]!;

function graphStub(behavior: (id: string, token: string) => void | Promise<void> = () => {}) {
  const calls: Array<{ id: string; token: string }> = [];
  return {
    calls,
    graph: {
      subscribePage: async (id: string, token: string) => {
        calls.push({ id, token });
        await behavior(id, token);
      },
    },
  };
}

describe('resubscribePages (đăng ký lại webhook sau khi danh sách field đổi)', () => {
  it('đăng ký lại cho mọi Page đang dùng được bằng Page token đã giải mã, và đặt lại subscribed_at', async () => {
    await seed('P1');
    await seed('P2');
    const { graph, calls } = graphStub();
    const out = await resubscribePages({ db, graph, crypto });
    expect(out.map((o) => [o.fbPageId, o.status]).sort()).toEqual([['P1', 'subscribed'], ['P2', 'subscribed']]);
    expect(calls.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'P1', token: 'TOKEN_P1' }, // token đúng của từng Page
      { id: 'P2', token: 'TOKEN_P2' },
    ]);
    expect((await row('P1')).subscribedAt!.getTime()).toBeGreaterThan(OLD.getTime());
  });

  it('bỏ qua Page có token_invalid (không gọi Meta bằng token hỏng)', async () => {
    await seed('GOOD');
    await seed('BAD', 'token_invalid');
    const { graph, calls } = graphStub();
    const out = await resubscribePages({ db, graph, crypto });
    expect(out.map((o) => o.fbPageId)).toEqual(['GOOD']);
    expect(calls.map((c) => c.id)).toEqual(['GOOD']);
  });

  it('chỉ một Page khi chỉ định ID; ID không tồn tại thì không có gì để làm', async () => {
    await seed('P1');
    await seed('P2');
    const { graph, calls } = graphStub();
    expect((await resubscribePages({ db, graph, crypto }, 'P2')).map((o) => o.fbPageId)).toEqual(['P2']);
    expect(calls.map((c) => c.id)).toEqual(['P2']);
    expect(await resubscribePages({ db, graph, crypto }, 'KHONG_CO')).toEqual([]);
  });

  it('Meta báo 190: đánh dấu token_invalid, giữ subscribed_at cũ; các Page khác vẫn được xử lý', async () => {
    await seed('P1');
    await seed('P2');
    const { graph } = graphStub((id) => {
      if (id === 'P1') throw new GraphApiError('hết hạn', 400, 190, null, 'OAuthException');
    });
    const out = await resubscribePages({ db, graph, crypto });
    expect(out.find((o) => o.fbPageId === 'P1')!.status).toBe('token_invalid');
    expect(out.find((o) => o.fbPageId === 'P2')!.status).toBe('subscribed');
    const p1 = await row('P1');
    expect(p1.status).toBe('token_invalid');
    expect(p1.subscribedAt!.getTime()).toBe(OLD.getTime());
  });

  it('lỗi khác của Meta (quyền, giới hạn tốc độ) hoặc lỗi bất ngờ: báo cho Page đó, giữ subscribed_at cũ, không dừng cả lượt', async () => {
    await seed('P1');
    await seed('P2');
    await seed('P3');
    const { graph } = graphStub((id) => {
      if (id === 'P1') throw new GraphApiError('quyền', 403, 200, null, 'OAuthException');
      if (id === 'P2') throw new TypeError('lỗi bất ngờ');
    });
    const out = await resubscribePages({ db, graph, crypto });
    const by = Object.fromEntries(out.map((o) => [o.fbPageId, o]));
    expect(by.P1).toMatchObject({ status: 'failed', graphCode: 200 });
    expect(by.P2).toMatchObject({ status: 'failed', graphCode: null });
    expect(by.P3).toMatchObject({ status: 'subscribed' });
    expect((await row('P1')).subscribedAt!.getTime()).toBe(OLD.getTime()); // không nói dối rằng đã đăng ký mới
    expect((await row('P1')).status).toBe('active');
  });

  it('không có Page nào: trả về danh sách rỗng', async () => {
    expect(await resubscribePages({ db, graph: graphStub().graph, crypto })).toEqual([]);
  });
});
