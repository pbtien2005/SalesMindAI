/**
 * Trạng thái khách (thẻ khách). Chỉ Sale đặt tay: không có job, cron hay AI nào tự đổi trạng thái
 * ("AI đề xuất, con người quyết định"). Mọi lần đổi ghi vào `audit_log`: ai đổi, từ đâu sang đâu (không có nội dung chat).
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { auditLog, conversations } from '../db/schema.js';

export const CUSTOMER_STATUSES = ['new', 'consulting', 'quoted', 'won', 'lost'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export interface CustomerStatusView {
  status: CustomerStatus;
  by: string | null;
  at: Date | null;
}

/**
 * Đổi trạng thái của một hội thoại thuộc `tenantId`. Trả null nếu hội thoại không thuộc tenant (người gọi trả 404).
 * Đặt lại đúng trạng thái hiện tại thì không đổi gì, không ghi nhật ký và giữ nguyên người, thời điểm đổi gần nhất.
 */
export async function setCustomerStatus(
  db: Db,
  input: { tenantId: string; conversationId: string; status: CustomerStatus; by: string; userId: string | null },
  now: Date,
): Promise<{ changed: boolean; current: CustomerStatusView } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: conversations.customerStatus, by: conversations.customerStatusBy, at: conversations.customerStatusAt })
      .from(conversations)
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.tenantId, input.tenantId)))
      .for('update');
    if (!row) return null;
    if (row.status === input.status) return { changed: false, current: row };

    await tx
      .update(conversations)
      .set({ customerStatus: input.status, customerStatusBy: input.by, customerStatusAt: now })
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.tenantId, input.tenantId)));
    await tx.insert(auditLog).values({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'customer.status_changed',
      target: input.conversationId,
      meta: { from: row.status, to: input.status },
    });
    return { changed: true, current: { status: input.status, by: input.by, at: now } };
  });
}
