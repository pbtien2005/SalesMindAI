import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OfflineBillReader } from '../src/bills/offline-bill-reader.js';
import { readBill, readPendingBills, type ReadBillDeps } from '../src/bills/read.js';
import { aiUsage, messages, orders, payments, tenants } from '../src/db/schema.js';
import { evaluateDeposit } from '../src/orders/deposit.js';
import { addMessage, seedBase, type Base } from './helpers/fixtures.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

const NOW = new Date('2026-11-13T03:09:00Z');
const assetDir = fileURLToPath(new URL('../demo-assets', import.meta.url));
const log = { info: () => {}, warn: () => {} };
const deps = (over: Partial<ReadBillDeps> = {}): ReadBillDeps => ({ db, reader: new OfflineBillReader(), assetDir, demoMode: true, log, ...over });

async function setup(opts: { aiEnabled?: boolean; withOrder?: boolean } = {}) {
  const base = await seedBase(db, { aiEnabled: opts.aiEnabled ?? true });
  if (opts.withOrder !== false) {
    await db.insert(orders).values({ tenantId: base.tenantId, conversationId: base.conversationId, status: 'awaiting_deposit', sku: 'SF-021', productName: 'Sofa Milan xám', unitPriceVnd: 12_000_000, totalVnd: 12_000_000, depositRequiredVnd: 6_000_000 });
  }
  return base;
}
async function image(base: Base, file: string, direction: 'inbound' | 'outbound' = 'inbound') {
  const id = await addMessage(db, base, { text: null, direction, sentAt: NOW });
  await db.update(messages).set({ attachments: [{ type: 'image', payload: { url: `/api/demo/assets/${file}` } }] }).where(eq(messages.id, id));
  return id;
}
const rows = (base: Base) => db.select().from(payments).where(eq(payments.conversationId, base.conversationId));

describe('evaluateDeposit', () => {
  it('ngưỡng: đúng 50% là đạt, 49,99% là chưa đạt', () => {
    expect(evaluateDeposit(6_000_000, 12_000_000, 50)).toEqual({ ratioPercent: 50, verdict: 'ok' });
    expect(evaluateDeposit(3_000_000, 12_000_000, 50)).toEqual({ ratioPercent: 25, verdict: 'below' });
    expect(evaluateDeposit(5_999_999, 12_000_000, 50).verdict).toBe('below');
    expect(evaluateDeposit(5_999_999, 12_000_000, 50).ratioPercent).toBeCloseTo(50, 0);
    expect(evaluateDeposit(12_000_000, 12_000_000, 50).verdict).toBe('ok');
  });
  it('tổng đơn không dương thì ném lỗi', () => {
    expect(() => evaluateDeposit(1, 0, 50)).toThrow();
    expect(() => evaluateDeposit(1, -5, 50)).toThrow();
  });
});

describe('readBill', () => {
  it('bill 6 triệu: khoản proposed, số tiền đúng, gắn đơn đang chờ cọc, bộ đọc mô phỏng được ghi rõ', async () => {
    const base = await setup();
    const id = await image(base, 'bill-6000000.png');
    expect(await readBill(deps(), id, NOW)).toEqual({ status: 'created' });
    const [p] = await rows(base);
    expect(p).toMatchObject({ status: 'proposed', readOk: true, amountVnd: 6_000_000, transferNote: 'Minh coc SF-021', readModel: 'offline-lookup' });
    const [o] = await db.select().from(orders).where(eq(orders.conversationId, base.conversationId));
    expect(p!.orderId).toBe(o!.id);
    expect(o!.depositPaidVnd).toBe(0); // đọc bill KHÔNG cộng tiền
  });

  it('bill 3 triệu đọc được; ảnh sofa không đọc được và không có số tiền', async () => {
    const base = await setup();
    await readBill(deps(), await image(base, 'bill-3000000.png'), NOW);
    await readBill(deps(), await image(base, 'sofa.png'), new Date(NOW.getTime() + 1000));
    const ps = (await rows(base)).sort((a, b) => (a.readOk === b.readOk ? 0 : a.readOk ? -1 : 1));
    expect(ps.find((p) => p.readOk)).toMatchObject({ amountVnd: 3_000_000 });
    expect(ps.find((p) => !p.readOk)).toMatchObject({ readOk: false, amountVnd: null, transferNote: null, bbox: null });
  });

  it('đọc hai lần cùng một tin chỉ ra một khoản', async () => {
    const base = await setup();
    const id = await image(base, 'bill-6000000.png');
    expect((await readBill(deps(), id, NOW)).status).toBe('created');
    expect(await readBill(deps(), id, NOW)).toEqual({ status: 'skipped', reason: 'already_done' });
    expect(await rows(base)).toHaveLength(1);
    expect(await readPendingBills(deps(), base.conversationId, NOW)).toBe(0);
  });

  it('chạy đồng thời hai lần cũng chỉ một dòng', async () => {
    const base = await setup();
    const id = await image(base, 'bill-6000000.png');
    await Promise.all([readBill(deps(), id, NOW), readBill(deps(), id, NOW)]);
    expect(await rows(base)).toHaveLength(1);
  });

  it('ảnh trong tin của Page (echo) và tenant tắt AI thì bỏ qua', async () => {
    const base = await setup();
    expect(await readBill(deps(), await image(base, 'bill-6000000.png', 'outbound'), NOW)).toEqual({ status: 'skipped', reason: 'not_customer' });
    const off = await setup({ aiEnabled: false });
    expect(await readBill(deps(), await image(off, 'bill-6000000.png'), NOW)).toEqual({ status: 'skipped', reason: 'ai_disabled' });
    expect(await rows(off)).toHaveLength(0);
  });

  it('URL ảnh demo không dùng được khi không bật DEMO_MODE; ảnh ngoài danh sách bị từ chối', async () => {
    const base = await setup();
    const id = await image(base, 'bill-6000000.png');
    expect(await readBill(deps({ demoMode: false }), id, NOW)).toEqual({ status: 'skipped', reason: 'image_unavailable' });
    const evil = await addMessage(db, base, { text: null, sentAt: NOW });
    await db.update(messages).set({ attachments: [{ type: 'image', payload: { url: '/api/demo/assets/../../.env' } }] }).where(eq(messages.id, evil));
    expect(await readBill(deps(), evil, NOW)).toEqual({ status: 'skipped', reason: 'image_unavailable' });
    expect(await rows(base)).toHaveLength(0);
  });

  it('ảnh thật: chỉ tải URL của Facebook; URL lạ không bao giờ được gọi', async () => {
    const base = await setup();
    const fetched: string[] = [];
    const fetchImage = async (url: string) => {
      fetched.push(url);
      return null;
    };
    const ok = await addMessage(db, base, { text: null, sentAt: NOW });
    await db.update(messages).set({ attachments: [{ type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/a.png' } }] }).where(eq(messages.id, ok));
    await readBill(deps({ fetchImage }), ok, NOW);
    expect(fetched).toEqual(['https://scontent.xx.fbcdn.net/a.png']);
  });

  it('hết hạn mức AI trong ngày thì bỏ qua và không ghi khoản', async () => {
    const base = await setup();
    await db.update(tenants).set({ aiDailyCap: 0 }).where(eq(tenants.id, base.tenantId));
    const id = await image(base, 'bill-6000000.png');
    expect(await readBill(deps({ budget: { defaultCap: 500 } }), id, NOW)).toEqual({ status: 'skipped', reason: 'budget_exhausted' });
    expect(await rows(base)).toHaveLength(0);
    await db.update(tenants).set({ aiDailyCap: 5 }).where(eq(tenants.id, base.tenantId));
    expect((await readBill(deps({ budget: { defaultCap: 500 } }), id, NOW)).status).toBe('created');
    const [u] = await db.select().from(aiUsage).where(eq(aiUsage.tenantId, base.tenantId));
    expect(u!.calls).toBe(1);
  });

  it('chưa có đơn đang chờ cọc: khoản vẫn được ghi, order_id rỗng', async () => {
    const base = await setup({ withOrder: false });
    await readBill(deps(), await image(base, 'bill-6000000.png'), NOW);
    expect((await rows(base))[0]).toMatchObject({ orderId: null, readOk: true });
  });

  it('lỗi tạm thời của bộ đọc được ném ra để retry và không ghi gì', async () => {
    const base = await setup();
    const id = await image(base, 'bill-6000000.png');
    const reader = { model: 'x', read: async () => { throw new Error('429'); } };
    await expect(readBill(deps({ reader }), id, NOW)).rejects.toThrow('429');
    expect(await rows(base)).toHaveLength(0);
  });
});
