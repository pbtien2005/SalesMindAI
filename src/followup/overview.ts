/**
 * Mô hình đọc cho Inbox và Trang chủ: mọi thứ (bám, P1, quá hạn, lịch nhắc, số liệu AI) TÍNH KHI ĐỌC từ dữ liệu
 * trong DB và `now`. Không lưu số đếm nào, nên tua đồng hồ chỉ cần đổi `now`.
 *
 * Quy mô: nạp toàn bộ hội thoại của một tenant vào bộ nhớ. Đủ cho demo (vài chục hội thoại); khi lên số lượng
 * lớn phải chuyển sang truy vấn có phân trang.
 */
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, followupState, proposals, tasks } from '../db/schema.js';
import { LIGHT_FIELDS, NEEDS_CLARIFICATION, P1_PURPOSES, REVIEW_FIELDS, type Evidence, type ProposalValue } from '../extraction/types.js';
import { followupStatus, type FollowupStatus } from './followup.js';

/** Khách chưa được trả lời quá ngần này phút (kèm tín hiệu mua hoặc thanh toán) thì là P1. */
export const P1_WAIT_MINUTES = 15;

export interface ConversationSummary {
  id: string;
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
}

const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));

export function fallbackName(psid: string): string {
  return `Khách ${psid.slice(-4)}`;
}

export async function loadConversationSummaries(db: Db, tenantId: string, now: Date): Promise<ConversationSummary[]> {
  const convs = await db.select().from(conversations).where(eq(conversations.tenantId, tenantId));
  if (convs.length === 0) return [];
  const ids = convs.map((c) => c.id);

  const stops = await db.select().from(followupState).where(eq(followupState.tenantId, tenantId));
  const stoppedAt = new Map(stops.map((s) => [s.conversationId, s.stoppedAt]));

  // Tin cuối (mọi chiều) và tin khách cuối có chữ của từng hội thoại.
  const lastAny = await db.execute<{ conversation_id: string; text: string }>(sql`
    SELECT DISTINCT ON (conversation_id) conversation_id, text FROM messages
    WHERE tenant_id = ${tenantId} AND text IS NOT NULL AND text <> ''
    ORDER BY conversation_id, sent_at DESC, id DESC`);
  const lastInbound = await db.execute<{ conversation_id: string; id: string }>(sql`
    SELECT DISTINCT ON (conversation_id) conversation_id, id FROM messages
    WHERE tenant_id = ${tenantId} AND direction = 'inbound' AND text IS NOT NULL AND text <> ''
    ORDER BY conversation_id, sent_at DESC, id DESC`);
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
  for (const s of signalRows) {
    const evidenceMsg = (s.evidence as Evidence[] | null)?.[0]?.messageId;
    if (!evidenceMsg || evidenceMsg !== lastInboundId.get(s.conversationId)) continue;
    const v = (s.value as ProposalValue).text;
    if ((s.field === 'message_purpose' && P1_PURPOSES.includes(v)) || (s.field === 'intent' && v === 'ready_to_buy')) hasBuySignal.add(s.conversationId);
  }

  return convs
    .map((c): ConversationSummary => {
      const times = { lastPageMessageAt: c.lastPageMessageAt, lastUserInteractionAt: c.lastUserInteractionAt };
      const customerWaiting = c.lastUserInteractionAt !== null && (c.lastPageMessageAt === null || c.lastUserInteractionAt > c.lastPageMessageAt);
      const pageWaiting = !customerWaiting && c.lastPageMessageAt !== null;
      const waitingOn = customerWaiting ? 'page' : pageWaiting ? 'customer' : null;
      const waitingSince = customerWaiting ? c.lastUserInteractionAt : pageWaiting ? c.lastPageMessageAt : null;
      const waitingMinutes = waitingSince ? minutesBetween(waitingSince, now) : null;
      return {
        id: c.id,
        displayName: c.displayName ?? fallbackName(c.psid),
        lastMessageAt: c.lastMessageAt,
        lastMessageText: textByConv.get(c.id) ?? null,
        waitingOn,
        waitingMinutes,
        followup: followupStatus(times, stoppedAt.get(c.id) ?? null, now),
        isP1: waitingOn === 'page' && (waitingMinutes ?? 0) > P1_WAIT_MINUTES && hasBuySignal.has(c.id),
        isNew: customerWaiting && c.lastPageMessageAt === null,
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
  /** Hạn của việc (với `followup` là null). */
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
      .filter((s) => !s.followup.stopped && s.followup.count >= 1)
      .sort((a, b) => b.followup.count - a.followup.count)
      .map((s): Reminder => ({ kind: 'followup', conversationId: s.id, displayName: s.displayName, title: `Bám ${s.followup.count}/${s.followup.max}`, dueAt: null })),
    ...open
      .filter((t) => t.dueAt >= now)
      .map((t): Reminder => ({ kind: 'upcoming', conversationId: t.conversationId, displayName: name(t.conversationId), title: t.title, dueAt: t.dueAt })),
  ];

  const rows = await db
    .select({ field: proposals.field, status: proposals.status, flags: proposals.flags })
    .from(proposals)
    .where(and(eq(proposals.tenantId, tenantId), ne(proposals.status, 'superseded')));
  const stoppedCount = (await db.select({ id: followupState.conversationId }).from(followupState).where(eq(followupState.tenantId, tenantId))).length;
  const ai: AiStats = {
    autoFilled: rows.filter((r) => LIGHT_FIELDS.includes(r.field) && r.status !== 'dismissed').length,
    saleEdited: rows.filter((r) => r.status === 'edited').length,
    askedDate: rows.filter((r) => r.field === 'timeline' && r.flags.includes(NEEDS_CLARIFICATION)).length,
    approved: rows.filter((r) => REVIEW_FIELDS.includes(r.field) && (r.status === 'accepted' || r.status === 'edited')).length + stoppedCount,
  };

  return {
    now,
    p1: summaries.filter((s) => s.isP1),
    overdue,
    reminders,
    suggestStop: summaries.filter((s) => s.followup.suggestStop),
    ai,
  };
}
