/**
 * Xác nhận khoản chuyển khoản và tạo đơn (cảnh 5). Mọi nơi cộng tiền hoặc cấp mã đơn chỉ đi qua đây (và `service.ts`).
 * AI chỉ ĐỌC số tiền từ ảnh bill (`payments.proposed`); Sale quyết định đã nhận tiền hay chưa.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { orders, payments, replyDrafts, tasks, tenants } from '../db/schema.js';
import { OrderError } from './service.js';

const MAX_AMOUNT = 10_000_000_000;
const money = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Một tin nháp đang chờ cho mỗi (đơn, loại): có rồi thì soạn lại nội dung, chưa có thì tạo. */
async function putDraft(tx: Tx, o: { tenantId: string; conversationId: string; orderId: string }, kind: 'top_up' | 'deposit_received', text: string) {
  const upd = await tx
    .update(replyDrafts)
    .set({ text })
    .where(and(eq(replyDrafts.orderId, o.orderId), eq(replyDrafts.kind, kind), eq(replyDrafts.status, 'pending')))
    .returning({ id: replyDrafts.id });
  if (upd.length === 0) await tx.insert(replyDrafts).values({ ...o, kind, text });
}

/** Đơn của khoản: đơn đã gắn, nếu chưa thì đơn đang chờ cọc của hội thoại. */
function orderOf(tenantId: string, p: { orderId: string | null; conversationId: string }) {
  return p.orderId
    ? and(eq(orders.id, p.orderId), eq(orders.tenantId, tenantId))
    : and(eq(orders.conversationId, p.conversationId), eq(orders.tenantId, tenantId), eq(orders.status, 'awaiting_deposit'));
}

/**
 * Sale xác nhận đã nhận khoản chuyển khoản. `amountVnd` (nếu có) là số Sale nhập: khác số AI đọc thì đánh dấu đã sửa;
 * ảnh không đọc được thì bắt buộc nhập tay. Tiền chỉ cộng qua một câu UPDATE có điều kiện trạng thái, trong cùng giao dịch.
 */
export async function confirmDeposit(
  db: Db,
  input: { tenantId: string; paymentId: string; by: string; amountVnd?: number | undefined },
  now: Date,
): Promise<{ orderId: string; depositPaidVnd: number; depositReached: boolean }> {
  if (input.amountVnd !== undefined && (!Number.isInteger(input.amountVnd) || input.amountVnd < 1 || input.amountVnd > MAX_AMOUNT)) throw new OrderError('invalid', 'Số tiền không hợp lệ.');
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(and(eq(payments.id, input.paymentId), eq(payments.tenantId, input.tenantId))).for('update');
    if (!p) throw new OrderError('not_found', 'Không có khoản thanh toán này.');
    if (p.status !== 'proposed') throw new OrderError('not_pending', 'Khoản này đã được xử lý.');
    const amount = input.amountVnd ?? p.amountVnd;
    if (amount === null) throw new OrderError('invalid', 'Không đọc được số tiền: hãy nhập số tiền hoặc bỏ qua.');

    const [o] = await tx.select().from(orders).where(orderOf(input.tenantId, p)).for('update');
    if (!o || o.status !== 'awaiting_deposit') throw new OrderError('invalid', 'Chưa có đơn đang chờ cọc cho khoản này.');

    const edited = p.amountVnd === null || amount !== p.amountVnd;
    const closed = await tx
      .update(payments)
      .set({ status: 'confirmed', amountVnd: amount, amountEdited: edited, orderId: o.id, confirmedBy: input.by, confirmedAt: now })
      .where(and(eq(payments.id, p.id), eq(payments.status, 'proposed')))
      .returning({ id: payments.id });
    if (closed.length !== 1) throw new OrderError('not_pending', 'Khoản này vừa được xử lý ở nơi khác.');

    const [paid] = await tx
      .update(orders)
      .set({ depositPaidVnd: sql`${orders.depositPaidVnd} + ${amount}` })
      .where(and(eq(orders.id, o.id), eq(orders.status, 'awaiting_deposit')))
      .returning({ paid: orders.depositPaidVnd });
    const depositPaidVnd = Number(paid!.paid);
    const depositReached = depositPaidVnd >= o.depositRequiredVnd;
    const ctx = { tenantId: input.tenantId, conversationId: o.conversationId, orderId: o.id };
    if (depositReached) {
      await putDraft(tx, ctx, 'deposit_received', `Dạ em đã nhận cọc ${money(depositPaidVnd)} của anh/chị. Anh/chị cho em xin địa chỉ nhận hàng để em lên đơn ạ.`);
    } else {
      await putDraft(tx, ctx, 'top_up', `Dạ em đã nhận ${money(amount)}. Còn thiếu ${money(o.depositRequiredVnd - depositPaidVnd)} để đủ cọc, anh/chị chuyển nốt giúp em ạ.`);
    }
    return { orderId: o.id, depositPaidVnd, depositReached };
  });
}

/** Sale bỏ qua một khoản (không phải bill hợp lệ hoặc chưa nhận tiền). Không cộng tiền. */
export async function rejectPayment(db: Db, input: { tenantId: string; paymentId: string; by: string }, now: Date): Promise<{ topUpDraft: boolean }> {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(and(eq(payments.id, input.paymentId), eq(payments.tenantId, input.tenantId))).for('update');
    if (!p) throw new OrderError('not_found', 'Không có khoản thanh toán này.');
    if (p.status !== 'proposed') throw new OrderError('not_pending', 'Khoản này đã được xử lý.');
    const closed = await tx
      .update(payments)
      .set({ status: 'rejected', confirmedBy: input.by, confirmedAt: now })
      .where(and(eq(payments.id, p.id), eq(payments.status, 'proposed')))
      .returning({ id: payments.id });
    if (closed.length !== 1) throw new OrderError('not_pending', 'Khoản này vừa được xử lý ở nơi khác.');
    // Bill đọc được nhưng chưa đạt ngưỡng: gợi ý nhắc khách chuyển nốt (Sale vẫn phải bấm Gửi).
    const [o] = await tx.select().from(orders).where(orderOf(input.tenantId, p));
    if (!o || o.status !== 'awaiting_deposit' || !p.readOk || p.amountVnd === null || p.amountVnd >= o.depositRequiredVnd) return { topUpDraft: false };
    await putDraft(
      tx,
      { tenantId: input.tenantId, conversationId: o.conversationId, orderId: o.id },
      'top_up',
      `Dạ khoản ${money(p.amountVnd)} chưa đủ cọc ${money(o.depositRequiredVnd)}. Anh/chị chuyển nốt ${money(o.depositRequiredVnd - o.depositPaidVnd)} giúp em để em giữ hàng ạ.`,
    );
    return { topUpDraft: true };
  });
}

/** Sale tạo đơn khi đã đủ cọc và có địa chỉ. Mã đơn cấp ở đây, nguyên tử theo tenant (DH-0001, DH-0002...). */
export async function confirmOrder(db: Db, input: { tenantId: string; orderId: string; by: string; address: string }, now: Date): Promise<{ code: string }> {
  const address = input.address.trim();
  if (address.length < 6 || address.length > 200) throw new OrderError('address_required', 'Địa chỉ nhận hàng phải có từ 6 đến 200 ký tự.');
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.tenantId, input.tenantId))).for('update');
    if (!o) throw new OrderError('not_found', 'Không có đơn này.');
    if (o.status !== 'awaiting_deposit') throw new OrderError('not_pending', 'Đơn này không ở trạng thái chờ cọc.');
    if (o.depositPaidVnd < o.depositRequiredVnd) throw new OrderError('deposit_not_reached', 'Chưa đủ tiền cọc.');
    // Khóa dòng tenant: hai đơn xác nhận đồng thời xếp hàng nên mã không trùng và không hụt số.
    const [t] = await tx
      .update(tenants)
      .set({ nextOrderNo: sql`${tenants.nextOrderNo} + 1` })
      .where(eq(tenants.id, input.tenantId))
      .returning({ next: tenants.nextOrderNo });
    const code = `DH-${String(t!.next - 1).padStart(4, '0')}`;
    await tx.update(orders).set({ status: 'confirmed', code, address, confirmedAt: now, confirmedBy: input.by }).where(eq(orders.id, o.id));
    await tx
      .update(tasks)
      .set({ doneAt: now })
      .where(and(eq(tasks.conversationId, o.conversationId), eq(tasks.source, 'deposit_reminder'), isNull(tasks.doneAt)));
    return { code };
  });
}
