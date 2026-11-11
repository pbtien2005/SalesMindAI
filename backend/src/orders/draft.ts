/**
 * Dựng đơn nháp và tin nháp xác nhận từ hồ sơ khách. AI chỉ điền NHÁP: mọi dòng ở đây là `draft`, Sale phải kiểm tra
 * và bấm gửi. Tin nháp soạn theo mẫu cố định (tất định, test được), không do mô hình viết.
 */
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { messages, orders, products, profileFields, proposals, replyDrafts, tenants } from '../db/schema.js';
import type { Evidence } from '../extraction/types.js';

export const formatVnd = (n: number): string => `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;

/** Lấy số nguyên từ chuỗi tiền như "12.000.000 ₫" (bỏ mọi ký tự không phải số). Null nếu không có số. */
export function parseVnd(text: string): number | null {
  const digits = text.replace(/\D/g, '');
  if (digits === '' || digits.length > 12) return null;
  return Number(digits);
}

/** Số lượng từ chuỗi như "1 bộ"; mặc định 1; giới hạn 1..1000. */
export function parseQuantity(text: string | undefined): number {
  const m = /\d+/.exec(text ?? '');
  const n = m ? Number(m[0]) : 1;
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 1000) : 1;
}

export interface OrderFigures {
  quantity: number;
  unitPriceVnd: number;
  totalVnd: number;
  depositRequiredVnd: number;
}

export function figures(quantity: number, unitPriceVnd: number, depositPercent: number): OrderFigures {
  const totalVnd = quantity * unitPriceVnd;
  return { quantity, unitPriceVnd, totalVnd, depositRequiredVnd: Math.ceil((totalVnd * depositPercent) / 100) };
}

export function confirmText(o: { quantity: number; productName: string; sku: string; totalVnd: number; depositRequiredVnd: number }, percent: number, instructions: string | null): string {
  const base = `Dạ em xác nhận đơn: ${o.quantity} bộ ${o.productName} (${o.sku}), ${formatVnd(o.totalVnd)}. Anh/chị vui lòng cọc ${percent}% = ${formatVnd(o.depositRequiredVnd)} để em giữ hàng ạ.`;
  return instructions && instructions.trim() !== '' ? `${base} Thông tin chuyển khoản: ${instructions.trim()}` : base;
}

const LIVE = ['pending', 'accepted', 'edited'] as const;

/**
 * Dựng đơn nháp khi khách vừa chốt (tín hiệu `buy_intent` có căn cứ ở tin khách MỚI NHẤT) và đã có mã hàng hợp lệ.
 * Không dựng nếu hội thoại đã có đơn (kể cả đơn đã xác nhận) hoặc không có mã hàng trong bảng sản phẩm.
 */
export async function buildOrderDraft(db: Db, tenantId: string, conversationId: string): Promise<{ orderId: string; replyDraftId: string } | null> {
  const [last] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.tenantId, tenantId), eq(messages.direction, 'inbound')))
    .orderBy(desc(messages.sentAt), desc(messages.id))
    .limit(1);
  if (!last) return null;

  const rows = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.tenantId, tenantId), eq(proposals.conversationId, conversationId), inArray(proposals.status, [...LIVE])))
    .orderBy(desc(proposals.createdAt));
  const latestValue = (field: string): string | undefined => {
    const r = rows.find((p) => p.field === field);
    return (r?.value as { text?: string } | undefined)?.text;
  };
  const buy = rows.find((p) => p.field === 'message_purpose' && (p.value as { text?: string }).text === 'buy_intent' && (p.evidence as Evidence[])[0]?.messageId === last.id);
  if (!buy) return null;

  const sku = latestValue('sku');
  if (!sku) return null;
  const [product] = await db.select().from(products).where(and(eq(products.tenantId, tenantId), eq(products.sku, sku)));
  if (!product) return null;

  const [existing] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.conversationId, conversationId), ne(orders.status, 'cancelled'))).limit(1);
  if (existing) return null;

  const approved = new Map((await db.select({ field: profileFields.field, value: profileFields.value }).from(profileFields).where(eq(profileFields.conversationId, conversationId))).map((f) => [f.field, (f.value as { text?: string }).text]));
  const pick = (field: 'customer_name' | 'phone' | 'quantity') => approved.get(field) ?? latestValue(field);

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) return null;
  const quoted = parseVnd(latestValue('unit_price') ?? '');
  const flags = quoted !== null && quoted !== product.priceVnd ? ['price_mismatch'] : [];
  const f = figures(parseQuantity(pick('quantity')), product.priceVnd, tenant.depositPercent);

  try {
    return await db.transaction(async (tx) => {
      const [o] = await tx
        .insert(orders)
        .values({
          tenantId,
          conversationId,
          customerName: pick('customer_name') ?? null,
          phone: pick('phone') ?? null,
          address: null,
          sku: product.sku,
          productName: product.name,
          ...f,
          flags,
        })
        .returning({ id: orders.id });
      const [d] = await tx
        .insert(replyDrafts)
        .values({ tenantId, conversationId, orderId: o!.id, kind: 'confirm_order', text: confirmText({ ...f, productName: product.name, sku: product.sku }, tenant.depositPercent, tenant.paymentInstructions) })
        .returning({ id: replyDrafts.id });
      return { orderId: o!.id, replyDraftId: d!.id };
    });
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') return null; // job khác vừa dựng đơn
    throw e;
  }
}
