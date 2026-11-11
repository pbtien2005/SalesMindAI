/** Xóa và xuất dữ liệu. Mọi xóa đi theo thứ tự khóa ngoại và nằm trong một giao dịch. */
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, messages, orders, pages, payments, profileFields, proposals, tasks, tenants, users, memberships } from '../db/schema.js';

/** Xóa các hội thoại (và mọi thứ gắn với chúng). Trả số hội thoại đã xóa. */
export async function deleteConversations(db: Db, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return db.transaction(async (tx) => {
    const idList = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
    // proposals trỏ extraction_runs; profile_fields trỏ proposals: xóa theo thứ tự ngược.
    for (const table of ['reply_drafts', 'payments', 'orders', 'profile_fields', 'proposals', 'extraction_runs', 'tasks', 'followup_state', 'messages']) {
      await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE conversation_id IN (${idList})`);
    }
    await tx.delete(conversations).where(inArray(conversations.id, ids));
    return ids.length;
  });
}

/**
 * Xóa TOÀN BỘ dữ liệu một doanh nghiệp: hội thoại, Page (token), lời mời, người dùng và phiên của họ, nhật ký, mức dùng AI.
 * Không hoàn tác được. Người gọi phải đã gỡ webhook ở Meta (nếu còn Page đang hoạt động).
 */
export async function deleteTenant(db: Db, tenantId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const memberIds = (await tx.select({ id: memberships.userId }).from(memberships).where(eq(memberships.tenantId, tenantId))).map((m) => m.id);
    for (const table of ['reply_drafts', 'payments', 'orders', 'products', 'profile_fields', 'proposals', 'extraction_runs', 'tasks', 'followup_state', 'messages', 'conversations', 'page_policy_events', 'oauth_states', 'invitations', 'audit_log', 'ai_usage', 'pages']) {
      await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`);
    }
    if (memberIds.length > 0) await tx.delete(users).where(inArray(users.id, memberIds)); // phiên, token, thành viên xóa theo (CASCADE)
    await tx.delete(tenants).where(eq(tenants.id, tenantId));
  });
}

/** Xuất dữ liệu doanh nghiệp (không có token, băm mật khẩu hay Page token). */
export async function exportTenant(db: Db, tenantId: string) {
  const [t] = await db.select({ id: tenants.id, name: tenants.name, createdAt: tenants.createdAt }).from(tenants).where(eq(tenants.id, tenantId));
  return {
    exportedAt: new Date().toISOString(),
    tenant: t ?? null,
    pages: await db.select({ id: pages.id, fbPageId: pages.fbPageId, name: pages.name, status: pages.status }).from(pages).where(eq(pages.tenantId, tenantId)),
    members: await db
      .select({ email: users.email, displayName: users.displayName, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, tenantId)),
    conversations: await db.select({ id: conversations.id, pageId: conversations.pageId, psid: conversations.psid, displayName: conversations.displayName, lastMessageAt: conversations.lastMessageAt }).from(conversations).where(eq(conversations.tenantId, tenantId)),
    messages: await db
      .select({ id: messages.id, conversationId: messages.conversationId, direction: messages.direction, text: messages.text, sentAt: messages.sentAt })
      .from(messages)
      .where(eq(messages.tenantId, tenantId)),
    profileFields: await db.select({ conversationId: profileFields.conversationId, field: profileFields.field, value: profileFields.value }).from(profileFields).where(eq(profileFields.tenantId, tenantId)),
    proposals: await db.select({ id: proposals.id, conversationId: proposals.conversationId, field: proposals.field, value: proposals.value, status: proposals.status, decidedBy: proposals.decidedBy }).from(proposals).where(eq(proposals.tenantId, tenantId)),
    orders: await db.select({ code: orders.code, status: orders.status, conversationId: orders.conversationId, sku: orders.sku, quantity: orders.quantity, totalVnd: orders.totalVnd, depositPaidVnd: orders.depositPaidVnd }).from(orders).where(eq(orders.tenantId, tenantId)),
    payments: await db.select({ conversationId: payments.conversationId, status: payments.status, amountVnd: payments.amountVnd, confirmedBy: payments.confirmedBy }).from(payments).where(eq(payments.tenantId, tenantId)),
    tasks: await db.select({ conversationId: tasks.conversationId, title: tasks.title, dueAt: tasks.dueAt, doneAt: tasks.doneAt }).from(tasks).where(eq(tasks.tenantId, tenantId)),
  };
}
