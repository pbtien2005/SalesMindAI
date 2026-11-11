/**
 * Mô hình đọc cho Inbox và Trang chủ: mọi thứ (bám, P1, quá hạn, lịch nhắc, số liệu AI) TÍNH KHI ĐỌC từ dữ liệu
 * trong DB và `now`. Không lưu số đếm nào, nên tua đồng hồ chỉ cần đổi `now`.
 *
 * Quy mô: nạp toàn bộ hội thoại của một tenant vào bộ nhớ. Đủ cho demo (vài chục hội thoại); khi lên số lượng
 * lớn phải chuyển sang truy vấn có phân trang.
 */
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, followupState, orders, pages, payments, profileFields, proposals, replyDrafts, tasks } from '../db/schema.js';
import { startOfVnDay } from '../util/vn-time.js';
import { LIGHT_FIELDS, NEEDS_CLARIFICATION, P1_PURPOSES, REVIEW_FIELDS, type Evidence, type ProposalValue } from '../extraction/types.js';
import { followupStatus, type FollowupStatus } from './followup.js';

/** Khách chưa được trả lời quá ngần này phút (kèm tín hiệu mua hoặc thanh toán) thì là P1. */
export const P1_WAIT_MINUTES = 15;

export interface ConversationSummary {
  id: string;
  pageId: string;
  pageName: string;
  displayName: string;
  lastMessageAt: Date | null;
  lastMessageText: string | null;
  /** Ai đang chờ ai: `page` = khách đang chờ Page trả lời; `customer` = Page đã nhắn, chờ khách. */
  waitingOn: 'page' | 'customer' | null;
  waitingMinutes: number | null;
  followup: FollowupStatus;
  isP1: boolean;
  /** Khách nhắn nhưng Page chưa từng trả lời. */
  isNew: boolean;
  /** `tracking`: có mốc hẹn đã duyệt còn ở tương lai; `new`: chưa có SĐT đã duyệt và chưa bám; còn lại `chasing`. */
  stage: 'new' | 'chasing' | 'tracking';
  nextContact: { at: Date; reason: string } | null;
  /** Câu gốc báo khách chốt mua (đề xuất `message_purpose = buy_intent` có căn cứ ở tin khách mới nhất). */
  closeSignal: { text: string; messageId: string } | null;
}

const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));

export function fallbackName(psid: string): string {
  return `Khách ${psid.slice(-4)}`;
}

export async function loadConversationSummaries(db: Db, tenantId: string, now: Date): Promise<ConversationSummary[]> {
  const convs = await db.select().from(conversations).where(eq(conversations.tenantId, tenantId));
  return summarize(db, tenantId, now, convs);
}

export type ConversationRow = typeof conversations.$inferSelect;

export const loadSummariesFor = (db: Db, tenantId: string, now: Date, convs: ConversationRow[]) => summarize(db, tenantId, now, convs);

/** Tính tóm tắt cho đúng các hội thoại được đưa vào (mọi truy vấn phụ giới hạn theo các id này). */
async function summarize(db: Db, tenantId: string, now: Date, convs: ConversationRow[]): Promise<ConversationSummary[]> {
  if (convs.length === 0) return [];
  const ids = convs.map((c) => c.id);
  const idList = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const pageNames = new Map((await db.select({ id: pages.id, name: pages.name }).from(pages).where(eq(pages.tenantId, tenantId))).map((p) => [p.id, p.name]));

  const stops = await db.select().from(followupState).where(and(eq(followupState.tenantId, tenantId), inArray(followupState.conversationId, ids)));
  const stoppedAt = new Map(stops.map((s) => [s.conversationId, s.stoppedAt]));

  // Tin cuối (mọi chiều) và tin khách cuối có chữ của từng hội thoại.
  const lastAny = await db.execute<{ conversation_id: string; text: string }>(sql`
    SELECT DISTINCT ON (conversation_id) conversation_id, text FROM messages
    WHERE tenant_id = ${tenantId} AND conversation_id IN (${idList}) AND text IS NOT NULL AND text <> ''
    ORDER BY conversation_id, sent_at DESC, id DESC`);
  const lastInbound = await db.execute<{ conversation_id: string; id: string }>(sql`
    SELECT DISTINCT ON (conversation_id) conversation_id, id FROM messages
    WHERE tenant_id = ${tenantId} AND conversation_id IN (${idList}) AND direction = 'inbound' AND text IS NOT NULL AND text <> ''
    ORDER BY conversation_id, sent_at DESC, id DESC`);
  // Giờ các tin Page gửi SAU lần khách hành động cuối: nền để tính số lần bám thật (xem followup.ts).
  const pageRows = await db.execute<{ conversation_id: string; sent_at: Date | string }>(sql`
    SELECT m.conversation_id, m.sent_at FROM messages m
    JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = m.tenant_id
    WHERE m.tenant_id = ${tenantId} AND m.conversation_id IN (${idList}) AND m.direction = 'outbound'
      AND (c.last_user_interaction_at IS NULL OR m.sent_at > c.last_user_interaction_at)
    ORDER BY m.conversation_id, m.sent_at`);
  const pageAfterUser = new Map<string, Date[]>();
  for (const r of pageRows.rows) {
    const list = pageAfterUser.get(r.conversation_id) ?? [];
    list.push(new Date(r.sent_at));
    pageAfterUser.set(r.conversation_id, list);
  }
  const textByConv = new Map(lastAny.rows.map((r) => [r.conversation_id, r.text]));
  const lastInboundId = new Map(lastInbound.rows.map((r) => [r.conversation_id, r.id]));

  // Tín hiệu mua: chỉ tính khi căn cứ của nó nằm ở tin khách MỚI NHẤT (tín hiệu cũ không được ở lại mãi).
  const signalRows = await db
    .select({ conversationId: proposals.conversationId, field: proposals.field, value: proposals.value, evidence: proposals.evidence })
    .from(proposals)
    .where(
      and(
        eq(proposals.tenantId, tenantId),
        inArray(proposals.conversationId, ids),
        inArray(proposals.field, ['message_purpose', 'intent']),
        inArray(proposals.status, ['pending', 'accepted', 'edited']),
      ),
    );
  const hasBuySignal = new Set<string>();
  const closeSignals = new Map<string, { text: string; messageId: string }>();
  for (const s of signalRows) {
    const evidenceMsg = (s.evidence as Evidence[] | null)?.[0]?.messageId;
    if (!evidenceMsg || evidenceMsg !== lastInboundId.get(s.conversationId)) continue;
    const v = (s.value as ProposalValue).text;
    const ev = (s.evidence as Evidence[])[0]!;
    if (s.field === 'message_purpose' && v === 'buy_intent') closeSignals.set(s.conversationId, { text: ev.text, messageId: ev.messageId });
    if ((s.field === 'message_purpose' && P1_PURPOSES.includes(v)) || (s.field === 'intent' && v === 'ready_to_buy')) hasBuySignal.add(s.conversationId);
  }

  // Giai đoạn khách: dựa trên dữ liệu ĐÃ DUYỆT (mốc hẹn và SĐT).
  const fieldRows = await db
    .select({ conversationId: profileFields.conversationId, field: profileFields.field, value: profileFields.value })
    .from(profileFields)
    .where(and(eq(profileFields.tenantId, tenantId), inArray(profileFields.conversationId, ids), inArray(profileFields.field, ['timeline', 'phone'])));
  const apptAt = new Map<string, Date>();
  const hasPhone = new Set<string>();
  for (const f of fieldRows) {
    if (f.field === 'phone') hasPhone.add(f.conversationId);
    const chosen = (f.value as { chosenAt?: string }).chosenAt;
    if (f.field === 'timeline' && chosen) {
      const d = new Date(chosen);
      if (!Number.isNaN(d.getTime()) && d.getTime() >= now.getTime()) apptAt.set(f.conversationId, d);
    }
  }

  return convs
    .map((c): ConversationSummary => {
      const followup = followupStatus({ lastUserInteractionAt: c.lastUserInteractionAt, pageMessagesAfterUser: pageAfterUser.get(c.id) ?? [] }, stoppedAt.get(c.id) ?? null, now);
      const customerWaiting = c.lastUserInteractionAt !== null && (c.lastPageMessageAt === null || c.lastUserInteractionAt > c.lastPageMessageAt);
      const pageWaiting = !customerWaiting && c.lastPageMessageAt !== null;
      const waitingOn = customerWaiting ? 'page' : pageWaiting ? 'customer' : null;
      const waitingSince = customerWaiting ? c.lastUserInteractionAt : pageWaiting ? c.lastPageMessageAt : null;
      const waitingMinutes = waitingSince ? minutesBetween(waitingSince, now) : null;
      return {
        id: c.id,
        pageId: c.pageId,
        pageName: pageNames.get(c.pageId) ?? "",
        displayName: c.displayName ?? fallbackName(c.psid),
        lastMessageAt: c.lastMessageAt,
        lastMessageText: textByConv.get(c.id) ?? null,
        waitingOn,
        waitingMinutes,
        followup,
        isP1: waitingOn === 'page' && (waitingMinutes ?? 0) > P1_WAIT_MINUTES && hasBuySignal.has(c.id),
        isNew: customerWaiting && c.lastPageMessageAt === null,
        stage: apptAt.has(c.id) ? 'tracking' : !hasPhone.has(c.id) && followup.count === 0 && !followup.due ? 'new' : 'chasing',
        closeSignal: closeSignals.get(c.id) ?? null,
        nextContact: apptAt.has(c.id) ? { at: apptAt.get(c.id)!, reason: 'Ngày hẹn đã xác nhận (ưu tiên 1)' } : null,
      };
    })
    .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
}

export type ReminderKind = 'overdue' | 'followup' | 'upcoming';

export interface Reminder {
  kind: ReminderKind;
  conversationId: string;
  displayName: string;
  title: string;
  /** Hạn của việc. Với `followup`: lúc đến hạn bám lần tiếp theo (null khi không có gì để bám). */
  dueAt: Date | null;
}

export interface OverdueTask {
  taskId: string;
  conversationId: string;
  displayName: string;
  title: string;
  dueAt: Date;
}

export interface AiStats {
  /** Số trường nhẹ AI tự điền (chưa bị bỏ hay thay thế). */
  autoFilled: number;
  /** Số lần Sale phải sửa vì AI điền sai. */
  saleEdited: number;
  /** Số mốc thời gian AI không tự suy ra ngày mà hỏi lại Sale. */
  askedDate: number;
  /** Số đề xuất cần duyệt mà Sale đã duyệt (kể cả sửa), cộng số lần xác nhận ngừng bám. */
  approved: number;
}

export interface HomeData {
  now: Date;
  p1: ConversationSummary[];
  overdue: OverdueTask[];
  reminders: Reminder[];
  /** Hội thoại đủ 5/5 bám, chờ Sale xác nhận ngừng. */
  suggestStop: ConversationSummary[];
  ai: AiStats;
  /** Tổng khoản cọc Sale đã xác nhận trong ngày hôm nay (giờ Việt Nam). */
  depositToday: number;
}

export async function loadHome(db: Db, tenantId: string, now: Date): Promise<HomeData> {
  const summaries = await loadConversationSummaries(db, tenantId, now);
  const byId = new Map(summaries.map((s) => [s.id, s]));
  const name = (id: string) => byId.get(id)?.displayName ?? 'Khách';

  const open = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), isNull(tasks.doneAt)))
    .orderBy(tasks.dueAt);
  const overdue: OverdueTask[] = open
    .filter((t) => t.dueAt < now)
    .map((t) => ({ taskId: t.id, conversationId: t.conversationId, displayName: name(t.conversationId), title: t.title, dueAt: t.dueAt }));

  const reminders: Reminder[] = [
    ...overdue.map((t): Reminder => ({ kind: 'overdue', conversationId: t.conversationId, displayName: t.displayName, title: t.title, dueAt: t.dueAt })),
    ...summaries
      // Việc cần làm trước: đã đến hạn bám lần tiếp theo (hạn cũ nhất trước), rồi các khách đang được bám (nhiều lần trước).
      .filter((s) => !s.followup.stopped && (s.followup.due || s.followup.count >= 1))
      .sort((a, b) => Number(b.followup.due) - Number(a.followup.due) || (a.followup.dueAt?.getTime() ?? 0) - (b.followup.dueAt?.getTime() ?? 0) || b.followup.count - a.followup.count)
      .map(
        (s): Reminder => ({
          kind: 'followup',
          conversationId: s.id,
          displayName: s.displayName,
          title: s.followup.due ? `Đến hạn bám lần ${s.followup.count + 1}/${s.followup.max}` : `Bám ${s.followup.count}/${s.followup.max}`,
          dueAt: s.followup.dueAt,
        }),
      ),
    ...open
      .filter((t) => t.dueAt >= now)
      .map((t): Reminder => ({ kind: 'upcoming', conversationId: t.conversationId, displayName: name(t.conversationId), title: t.title, dueAt: t.dueAt })),
  ];

  const rows = await db
    .select({ field: proposals.field, status: proposals.status, flags: proposals.flags })
    .from(proposals)
    .where(and(eq(proposals.tenantId, tenantId), ne(proposals.status, 'superseded')));
  const count = async (q: Promise<unknown[]>) => (await q).length;
  const sentDrafts = await count(db.select({ id: replyDrafts.id }).from(replyDrafts).where(and(eq(replyDrafts.tenantId, tenantId), eq(replyDrafts.status, 'sent'))));
  const confirmedPayments = await count(db.select({ id: payments.id }).from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.status, 'confirmed'))));
  const confirmedOrders = await count(db.select({ id: orders.id }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.status, 'confirmed'))));
  const dayStart = startOfVnDay(now);
  const [dep] = await db
    .select({ total: sql<string>`coalesce(sum(${payments.amountVnd}), 0)` })
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.status, 'confirmed'), sql`${payments.confirmedAt} >= ${dayStart} and ${payments.confirmedAt} < ${new Date(dayStart.getTime() + 24 * 3_600_000)}`));
  const stoppedCount = (await db.select({ id: followupState.conversationId }).from(followupState).where(eq(followupState.tenantId, tenantId))).length;
  const ai: AiStats = {
    autoFilled: rows.filter((r) => LIGHT_FIELDS.includes(r.field) && r.status !== 'dismissed').length,
    saleEdited: rows.filter((r) => r.status === 'edited').length,
    askedDate: rows.filter((r) => r.field === 'timeline' && r.flags.includes(NEEDS_CLARIFICATION)).length,
    approved: rows.filter((r) => REVIEW_FIELDS.includes(r.field) && (r.status === 'accepted' || r.status === 'edited')).length + stoppedCount + sentDrafts + confirmedPayments + confirmedOrders,
  };

  return {
    now,
    p1: summaries.filter((s) => s.isP1),
    overdue,
    reminders,
    suggestStop: summaries.filter((s) => s.followup.suggestStop),
    ai,
    depositToday: Number(dep?.total ?? 0),
  };
}

export interface OrderRow {
  id: string;
  conversationId: string;
  code: string | null;
  status: 'draft' | 'awaiting_deposit' | 'confirmed' | 'cancelled';
  customerName: string;
  productName: string;
  sku: string;
  quantity: number;
  totalVnd: number;
  depositPaidVnd: number;
  remainingVnd: number;
  createdAt: Date;
}

/** Danh sách đơn của doanh nghiệp (mới nhất trước), cho màn Đơn hàng. */
export async function loadOrders(db: Db, tenantId: string): Promise<OrderRow[]> {
  const rows = await db
    .select({ o: orders, display: conversations.displayName, psid: conversations.psid })
    .from(orders)
    .innerJoin(conversations, eq(conversations.id, orders.conversationId))
    .where(eq(orders.tenantId, tenantId))
    .orderBy(sql`${orders.createdAt} desc`)
    .limit(500);
  return rows.map(({ o, display, psid }) => ({
    id: o.id,
    conversationId: o.conversationId,
    code: o.code,
    status: o.status,
    customerName: o.customerName ?? display ?? fallbackName(psid),
    productName: o.productName,
    sku: o.sku,
    quantity: o.quantity,
    totalVnd: o.totalVnd,
    depositPaidVnd: o.depositPaidVnd,
    remainingVnd: Math.max(0, o.totalVnd - o.depositPaidVnd),
    createdAt: o.createdAt,
  }));
}
