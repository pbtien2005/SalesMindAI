import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { orders, payments, products, tenants } from '../src/db/schema.js';
import { addMessage, seedBase } from './helpers/fixtures.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';
import { eq } from 'drizzle-orm';

const handle = openTestDb();
const { db } = handle;
beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

const order = (base: { tenantId: string; conversationId: string }, over: Partial<typeof orders.$inferInsert> = {}) => ({
  tenantId: base.tenantId,
  conversationId: base.conversationId,
  sku: 'SF-021',
  productName: 'Sofa Milan xám',
  unitPriceVnd: 12_000_000,
  totalVnd: 12_000_000,
  depositRequiredVnd: 6_000_000,
  ...over,
});

describe('bảng đơn hàng (G3)', () => {
  it('mặc định tenant: cọc 50%, mã đơn kế tiếp là 1', async () => {
    const base = await seedBase(db);
    const [t] = await db.select().from(tenants).where(eq(tenants.id, base.tenantId));
    expect(t).toMatchObject({ depositPercent: 50, nextOrderNo: 1, paymentInstructions: null });
  });

  it('mỗi hội thoại chỉ một đơn mở; đơn đã xác nhận không chặn đơn mới', async () => {
    const base = await seedBase(db);
    await db.insert(orders).values(order(base));
    await expect(db.insert(orders).values(order(base))).rejects.toMatchObject({ cause: { code: '23505' } });
    await expect(db.insert(orders).values(order(base, { status: 'awaiting_deposit' }))).rejects.toMatchObject({ cause: { code: '23505' } });
    await db.update(orders).set({ status: 'confirmed', code: 'DH-0001' }).where(eq(orders.conversationId, base.conversationId));
    await db.insert(orders).values(order(base)); // đơn mới được phép
    await db.update(orders).set({ status: 'cancelled' }).where(eq(orders.status, 'draft'));
    await db.insert(orders).values(order(base));
  });

  it('(tenant, code) là duy nhất', async () => {
    const a = await seedBase(db);
    await db.insert(orders).values(order(a, { status: 'confirmed', code: 'DH-0001' }));
    const [c2] = [await seedBase(db)];
    await db.insert(orders).values(order({ ...c2, tenantId: c2.tenantId }, { status: 'confirmed', code: 'DH-0001' })); // tenant khác: được
    const b = { ...a, conversationId: (await seedBase(db)).conversationId };
    await expect(db.insert(orders).values(order(b, { status: 'confirmed', code: 'DH-0001' }))).rejects.toBeTruthy();
  });

  it('khóa ngoại ghép chặn đơn trỏ hội thoại của tenant khác', async () => {
    const a = await seedBase(db);
    const b = await seedBase(db);
    await expect(db.insert(orders).values(order({ tenantId: a.tenantId, conversationId: b.conversationId }))).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('mỗi tin chỉ một khoản thanh toán; khoản không thể trỏ đơn hay tin của tenant khác', async () => {
    const a = await seedBase(db);
    const b = await seedBase(db);
    const m = await addMessage(db, a, { text: null, sentAt: new Date('2026-11-13T03:00:00Z') });
    const pay = { tenantId: a.tenantId, conversationId: a.conversationId, messageId: m, readOk: true, amountVnd: 6_000_000, readModel: 'test' };
    await db.insert(payments).values(pay);
    await expect(db.insert(payments).values(pay)).rejects.toMatchObject({ cause: { code: '23505' } });
    const mb = await addMessage(db, b, { text: null, sentAt: new Date('2026-11-13T03:00:00Z') });
    await expect(db.insert(payments).values({ ...pay, messageId: mb })).rejects.toMatchObject({ cause: { code: '23503' } });
    const [ob] = await db.insert(orders).values(order(b)).returning({ id: orders.id });
    const m2 = await addMessage(db, a, { text: null, sentAt: new Date('2026-11-13T03:01:00Z') });
    await expect(db.insert(payments).values({ ...pay, messageId: m2, orderId: ob!.id })).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('sản phẩm: (tenant, sku) duy nhất', async () => {
    const a = await seedBase(db);
    await db.insert(products).values({ tenantId: a.tenantId, sku: 'SF-021', name: 'A', priceVnd: 1 });
    await expect(db.insert(products).values({ tenantId: a.tenantId, sku: 'SF-021', name: 'B', priceVnd: 2 })).rejects.toBeTruthy();
  });
});
