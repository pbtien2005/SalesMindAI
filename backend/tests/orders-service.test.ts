import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadHome, loadOrders } from '../src/followup/overview.js';
import { orders, payments, replyDrafts, tasks, tenants } from '../src/db/schema.js';
import { confirmDeposit, confirmOrder, rejectPayment } from '../src/orders/payments.js';
import { startOfVnDay } from '../src/util/vn-time.js';
import { addConversation, addMessage, seedBase, type Base } from './helpers/fixtures.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

const NOW = new Date('2026-11-13T03:10:00Z'); // Thứ Sáu 13/11 10:10 (+07:00)

async function order(base: Base, over: Partial<typeof orders.$inferInsert> = {}) {
  const [o] = await db
    .insert(orders)
    .values({ tenantId: base.tenantId, conversationId: base.conversationId, status: 'awaiting_deposit', sku: 'SF-021', productName: 'Sofa Milan xám', unitPriceVnd: 12_000_000, totalVnd: 12_000_000, depositRequiredVnd: 6_000_000, ...over })
    .returning();
  return o!;
}
async function payment(base: Base, amount: number | null, over: Partial<typeof payments.$inferInsert> = {}) {
  const m = await addMessage(db, base, { text: null, sentAt: NOW });
  const [p] = await db
    .insert(payments)
    .values({ tenantId: base.tenantId, conversationId: base.conversationId, messageId: m, readOk: amount !== null, amountVnd: amount, readModel: 'test', ...over })
    .returning();
  return p!;
}
const pay = (tenantId: string, paymentId: string, amountVnd?: number) => confirmDeposit(db, { tenantId, paymentId, by: 'Lan', amountVnd }, NOW);
const getOrder = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;

describe('confirmDeposit', () => {
  it('bill 6 triệu: cộng đúng một lần, đạt ngưỡng, sinh tin nháp deposit_received', async () => {
    const base = await seedBase(db);
    const o = await order(base);
    const p = await payment(base, 6_000_000);
    const r = await pay(base.tenantId, p.id);
    expect(r).toEqual({ orderId: o.id, depositPaidVnd: 6_000_000, depositReached: true });
    expect((await getOrder(o.id)).depositPaidVnd).toBe(6_000_000);
    const [pp] = await db.select().from(payments).where(eq(payments.id, p.id));
    expect(pp).toMatchObject({ status: 'confirmed', confirmedBy: 'Lan', amountEdited: false, orderId: o.id });
    expect(pp!.confirmedAt!.getTime()).toBe(NOW.getTime());
    const [d] = await db.select().from(replyDrafts).where(eq(replyDrafts.orderId, o.id));
    expect(d).toMatchObject({ kind: 'deposit_received', status: 'pending' });
    expect(d!.text).toContain('6.000.000 ₫');
  });

  it('hai lần đồng thời cùng một khoản: đúng một thành công, tiền cộng một lần', async () => {
    const base = await seedBase(db);
    const o = await order(base);
    const p = await payment(base, 6_000_000);
    const results = await Promise.allSettled([pay(base.tenantId, p.id), pay(base.tenantId, p.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: 'not_pending' });
    expect((await getOrder(o.id)).depositPaidVnd).toBe(6_000_000);
  });

  it('Sale sửa số tiền: đánh dấu đã sửa; ảnh không đọc được thì bắt buộc nhập tay', async () => {
    const base = await seedBase(db);
    const o = await order(base);
    const p = await payment(base, 6_000_000);
    await pay(base.tenantId, p.id, 5_900_000);
    expect((await db.select().from(payments).where(eq(payments.id, p.id)))[0]).toMatchObject({ amountVnd: 5_900_000, amountEdited: true });
    expect((await getOrder(o.id)).depositPaidVnd).toBe(5_900_000);

    const blank = await payment(base, null);
    await expect(pay(base.tenantId, blank.id)).rejects.toMatchObject({ code: 'invalid' });
    await pay(base.tenantId, blank.id, 100_000);
    expect((await getOrder(o.id)).depositPaidVnd).toBe(6_000_000);
  });

  it('chưa đủ cọc: sinh tin nháp top_up (nhắc chuyển nốt) và chưa đạt', async () => {
    const base = await seedBase(db);
    const o = await order(base);
    const r = await pay(base.tenantId, (await payment(base, 3_000_000)).id);
    expect(r.depositReached).toBe(false);
    const [d] = await db.select().from(replyDrafts).where(eq(replyDrafts.orderId, o.id));
    expect(d).toMatchObject({ kind: 'top_up' });
    expect(d!.text).toContain('3.000.000 ₫');
  });

  it('số tiền không hợp lệ, khoản không có đơn chờ cọc, khoản tenant khác', async () => {
    const base = await seedBase(db);
    const p = await payment(base, 6_000_000);
    await expect(pay(base.tenantId, p.id, -1)).rejects.toMatchObject({ code: 'invalid' });
    await expect(pay(base.tenantId, p.id, 1.5)).rejects.toMatchObject({ code: 'invalid' });
    await expect(pay(base.tenantId, p.id)).rejects.toMatchObject({ code: 'invalid' }); // chưa có đơn
    const other = await seedBase(db);
    await expect(pay(other.tenantId, p.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await db.select().from(payments).where(eq(payments.id, p.id)))[0]!.status).toBe('proposed');
  });
});

describe('rejectPayment', () => {
  it('bill 3 triệu bị bỏ qua: không cộng tiền, có tin nháp nhắc chuyển nốt; làm hai lần thì lần sau not_pending', async () => {
    const base = await seedBase(db);
    const o = await order(base);
    const p = await payment(base, 3_000_000);
    expect(await rejectPayment(db, { tenantId: base.tenantId, paymentId: p.id, by: 'Lan' }, NOW)).toEqual({ topUpDraft: true });
    expect((await getOrder(o.id)).depositPaidVnd).toBe(0);
    expect((await db.select().from(payments).where(eq(payments.id, p.id)))[0]!.status).toBe('rejected');
    const [d] = await db.select().from(replyDrafts).where(eq(replyDrafts.orderId, o.id));
    expect(d).toMatchObject({ kind: 'top_up' });
    await expect(rejectPayment(db, { tenantId: base.tenantId, paymentId: p.id, by: 'Lan' }, NOW)).rejects.toMatchObject({ code: 'not_pending' });
  });

  it('khoản không đọc được hoặc đã đủ ngưỡng thì không sinh tin nháp', async () => {
    const base = await seedBase(db);
    await order(base);
    expect(await rejectPayment(db, { tenantId: base.tenantId, paymentId: (await payment(base, null)).id, by: 'Lan' }, NOW)).toEqual({ topUpDraft: false });
    expect(await rejectPayment(db, { tenantId: base.tenantId, paymentId: (await payment(base, 6_000_000)).id, by: 'Lan' }, NOW)).toEqual({ topUpDraft: false });
  });
});

describe('confirmOrder', () => {
  const confirm = (tenantId: string, orderId: string, address = '12 Lê Lợi, Quận 1, TP.HCM') => confirmOrder(db, { tenantId, orderId, by: 'Lan', address }, NOW);

  it('đủ cọc và có địa chỉ: cấp DH-0001, đơn confirmed, đóng việc nhắc cọc', async () => {
    const base = await seedBase(db);
    const o = await order(base, { depositPaidVnd: 6_000_000 });
    await db.insert(tasks).values({ tenantId: base.tenantId, conversationId: base.conversationId, title: 'Nhắc khách cọc', dueAt: NOW, source: 'deposit_reminder' });
    expect(await confirm(base.tenantId, o.id)).toEqual({ code: 'DH-0001' });
    expect(await getOrder(o.id)).toMatchObject({ status: 'confirmed', code: 'DH-0001', address: '12 Lê Lợi, Quận 1, TP.HCM', confirmedBy: 'Lan' });
    expect((await db.select().from(tasks).where(eq(tasks.conversationId, base.conversationId)))[0]!.doneAt).not.toBeNull();
  });

  it('thiếu địa chỉ, địa chỉ quá ngắn hoặc chưa đủ cọc: đúng mã lỗi, không đổi gì', async () => {
    const base = await seedBase(db);
    const o = await order(base, { depositPaidVnd: 6_000_000 });
    for (const a of ['', '  ', 'abc', 'x'.repeat(201)]) await expect(confirm(base.tenantId, o.id, a)).rejects.toMatchObject({ code: 'address_required' });
    const short = await order(await addConversation(db, base, 'psid-2'), { depositPaidVnd: 5_999_999 });
    await expect(confirm(base.tenantId, short.id)).rejects.toMatchObject({ code: 'deposit_not_reached' });
    expect((await getOrder(o.id)).status).toBe('awaiting_deposit');
    expect((await db.select().from(tenants).where(eq(tenants.id, base.tenantId)))[0]!.nextOrderNo).toBe(1);
  });

  it('hai đơn liên tiếp, kể cả đồng thời, ra mã khác nhau và liền nhau', async () => {
    const base = await seedBase(db);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await order(await addConversation(db, base, `psid-${i + 10}`), { depositPaidVnd: 6_000_000 })).id);
    const codes = await Promise.all(ids.map((id) => confirm(base.tenantId, id)));
    expect(codes.map((c) => c.code).sort()).toEqual(['DH-0001', 'DH-0002', 'DH-0003', 'DH-0004']);
    expect((await db.select().from(tenants).where(eq(tenants.id, base.tenantId)))[0]!.nextOrderNo).toBe(5);
  });

  it('xác nhận hai lần cùng một đơn: lần sau not_pending và không tốn số mã; đơn tenant khác: not_found', async () => {
    const base = await seedBase(db);
    const o = await order(base, { depositPaidVnd: 6_000_000 });
    await confirm(base.tenantId, o.id);
    await expect(confirm(base.tenantId, o.id)).rejects.toMatchObject({ code: 'not_pending' });
    expect((await db.select().from(tenants).where(eq(tenants.id, base.tenantId)))[0]!.nextOrderNo).toBe(2);
    const other = await seedBase(db);
    await expect(confirm(other.tenantId, o.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('Trang chủ: tiền cọc hôm nay và đơn hàng', () => {
  it('depositToday tính theo ngày giờ Việt Nam: xác nhận 23:50, sang 00:10 hôm sau thì về 0 nhưng đơn vẫn còn', async () => {
    const base = await seedBase(db);
    const o = await order(base);
    const p = await payment(base, 6_000_000);
    const at = new Date('2026-11-13T16:50:00Z'); // 23:50 giờ VN ngày 13/11
    await confirmDeposit(db, { tenantId: base.tenantId, paymentId: p.id, by: 'Lan' }, at);
    expect((await loadHome(db, base.tenantId, at)).depositToday).toBe(6_000_000);
    expect((await loadHome(db, base.tenantId, new Date('2026-11-13T17:10:00Z'))).depositToday).toBe(0); // 00:10 ngày 14/11
    const list = await loadOrders(db, base.tenantId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: o.id, totalVnd: 12_000_000, depositPaidVnd: 6_000_000, remainingVnd: 6_000_000, status: 'awaiting_deposit' });
  });

  it('khoản bị bỏ qua không tính; chỉ tính của doanh nghiệp mình', async () => {
    const base = await seedBase(db);
    await order(base);
    await rejectPayment(db, { tenantId: base.tenantId, paymentId: (await payment(base, 3_000_000)).id, by: 'Lan' }, NOW);
    const other = await seedBase(db);
    await order(other);
    await confirmDeposit(db, { tenantId: other.tenantId, paymentId: (await payment(other, 6_000_000)).id, by: 'X' }, NOW);
    expect((await loadHome(db, base.tenantId, NOW)).depositToday).toBe(0);
    expect((await loadHome(db, other.tenantId, NOW)).depositToday).toBe(6_000_000);
    expect(await loadOrders(db, base.tenantId)).toHaveLength(1);
  });
});

describe('startOfVnDay', () => {
  it('00:00 giờ VN của ngày chứa thời điểm', () => {
    expect(startOfVnDay(new Date('2026-11-13T16:50:00Z')).toISOString()).toBe('2026-11-12T17:00:00.000Z');
    expect(startOfVnDay(new Date('2026-11-13T17:00:00Z')).toISOString()).toBe('2026-11-13T17:00:00.000Z');
    expect(startOfVnDay(new Date('2026-11-13T02:00:00Z')).toISOString()).toBe('2026-11-12T17:00:00.000Z');
  });
});

