/**
 * Hành động của Sale lên đơn, tin nháp và khoản thanh toán. Mọi nơi cộng tiền hoặc cấp mã đơn chỉ đi qua file này.
 * AI chỉ tạo dòng `draft` / `proposed`; chuyển sang trạng thái thật luôn do Sale bấm.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { orders, payments, replyDrafts, tasks, tenants } from '../db/schema.js';
import { confirmText, figures, parseQuantity } from './draft.js';

export type OrderErrorCode = 'not_found' | 'not_pending' | 'not_draft' | 'invalid' | 'deposit_not_reached' | 'address_required';

export class OrderError extends Error {
  override readonly name = 'OrderError';
  constructor(
    readonly code: OrderErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const DEPOSIT_REMINDER = 'Nhắc khách cọc';
const MAX_TEXT = 1000;

export interface UpdatePatch {
  address?: string;
  quantity?: number;
  customerName?: string;
  phone?: string;
}

/** Sale sửa đơn nháp. Tính lại tổng và tiền cọc; soạn lại tin nháp xác nhận đang chờ theo số mới. */
export async function updateDraftOrder(db: Db, input: { tenantId: string; orderId: string; by: string; patch: UpdatePatch }, now: Date) {
  const { patch } = input;
  const clean = (s: string | undefined, max: number) => (s === undefined ? undefined : s.trim().slice(0, max));
  if (patch.quantity !== undefined && (!Number.isInteger(patch.quantity) || patch.quantity < 1 || patch.quantity > 1000)) throw new OrderError('invalid', 'Số lượng phải từ 1 đến 1000.');
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.tenantId, input.tenantId))).for('update');
    if (!o) throw new OrderError('not_found', 'Không có đơn này.');
    if (o.status !== 'draft') throw new OrderError('not_draft', 'Đơn đã gửi cho khách, không sửa được nữa.');
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, input.tenantId));
    const qty = patch.quantity ?? o.quantity;
    const f = figures(qty, o.unitPriceVnd, t!.depositPercent);
    const name = clean(patch.customerName, 200);
    const phone = clean(patch.phone, 30);
    const address = clean(patch.address, 200);
    const [u] = await tx
      .update(orders)
      .set({ ...f, ...(name !== undefined ? { customerName: name || null } : {}), ...(phone !== undefined ? { phone: phone || null } : {}), ...(address !== undefined ? { address: address || null } : {}), saleEditedAt: now })
      .where(eq(orders.id, o.id))
      .returning();
    await tx
      .update(replyDrafts)
      .set({ text: confirmText({ ...f, productName: o.productName, sku: o.sku }, t!.depositPercent, t!.paymentInstructions) })
      .where(and(eq(replyDrafts.orderId, o.id), eq(replyDrafts.kind, 'confirm_order'), eq(replyDrafts.status, 'pending')));
    return u!;
  });
}

/** Hàm gửi tin tiêm vào (demo: ghi giả lập; thật: Send API). Ném lỗi nếu không gửi được. */
export type SendReply = (conversationId: string, text: string, now: Date) => Promise<void>;

/**
 * Sale bấm "Gửi" trên tin nháp. Chiếm tin nháp trước (UPDATE ... WHERE status='pending') để bấm hai lần không gửi hai
 * lần; gửi thất bại thì trả tin nháp về `pending` và không đổi gì khác.
 */
export async function sendReplyDraft(
  deps: { db: Db; send: SendReply },
  input: { tenantId: string; replyDraftId: string; by: string; text?: string | undefined },
  now: Date,
): Promise<{ orderStatus: 'awaiting_deposit' | null; taskId: string | null }> {
  const { db } = deps;
  const [d] = await db.select().from(replyDrafts).where(and(eq(replyDrafts.id, input.replyDraftId), eq(replyDrafts.tenantId, input.tenantId)));
  if (!d) throw new OrderError('not_found', 'Không có tin nháp này.');
  const text = (input.text ?? d.text).trim();
  if (text === '' || text.length > MAX_TEXT) throw new OrderError('invalid', `Tin nhắn phải có từ 1 đến ${MAX_TEXT} ký tự.`);

  const claimed = await db
    .update(replyDrafts)
    .set({ status: 'sent', text, decidedBy: input.by, decidedAt: now })
    .where(and(eq(replyDrafts.id, d.id), eq(replyDrafts.status, 'pending')))
    .returning({ id: replyDrafts.id });
  if (claimed.length !== 1) throw new OrderError('not_pending', 'Tin nháp này đã được xử lý.');

  try {
    await deps.send(d.conversationId, text, now);
  } catch (e) {
    await db.update(replyDrafts).set({ status: 'pending', decidedBy: null, decidedAt: null }).where(eq(replyDrafts.id, d.id));
    throw e;
  }

  if (d.kind !== 'confirm_order') return { orderStatus: null, taskId: null };
  return db.transaction(async (tx) => {
    const moved = await tx
      .update(orders)
      .set({ status: 'awaiting_deposit', sentAt: now })
      .where(and(eq(orders.id, d.orderId), eq(orders.tenantId, d.tenantId), eq(orders.status, 'draft')))
      .returning({ id: orders.id });
    if (moved.length !== 1) return { orderStatus: null, taskId: null };
    const [t] = await tx
      .insert(tasks)
      .values({ tenantId: d.tenantId, conversationId: d.conversationId, title: DEPOSIT_REMINDER, dueAt: new Date(now.getTime() + 24 * 3_600_000), source: 'deposit_reminder' })
      .returning({ id: tasks.id });
    return { orderStatus: 'awaiting_deposit' as const, taskId: t!.id };
  });
}

export { parseQuantity };
