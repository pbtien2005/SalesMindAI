/**
 * Mô hình đọc cho API demo: chi tiết một hội thoại (tin, thẻ khách, Hộp đề xuất, việc) và lịch sử quyết định.
 * Câu gốc đi kèm offset (`start`, `end`, tính theo đơn vị UTF-16 của văn bản tin) để giao diện tô đoạn khớp.
 */
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, followupState, messages, profileFields, proposals, tasks } from '../db/schema.js';
import { LIGHT_FIELDS, REVIEW_FIELDS, SIGNAL_FIELDS, type Evidence, type ProposalValue } from '../extraction/types.js';
import { loadConversationSummaries, type ConversationSummary } from '../followup/overview.js';

const MAX_MESSAGES = 300;

export interface MessageView {
  id: string;
  direction: 'inbound' | 'outbound';
  senderKind: string;
  text: string | null;
  hasAttachment: boolean;
  sentAt: Date;
}

export interface ProposalView {
  id: string;
  field: string;
  value: ProposalValue;
  evidence: Evidence[];
  flags: string[];
  createdAt: Date;
}

export interface ApprovedView {
  field: string;
  value: ProposalValue & { chosenAt?: string };
  version: number;
  updatedAt: Date;
  decidedBy: string | null;
  /** `accepted` hoặc `edited` (Sale đã sửa vì AI điền sai). */
  status: string | null;
}

export type BoxItem =
  | ({ kind: 'proposal' } & ProposalView)
  | { kind: 'stop_followup'; reason: string; count: number; max: number };

export interface ConversationDetail {
  summary: ConversationSummary;
  messages: MessageView[];
  /** Dữ liệu đã duyệt (nhãn "Đã duyệt bởi ..."). */
  approved: ApprovedView[];
  /** Trường nhẹ AI tự điền, chưa duyệt (nhãn "AI điền, chưa duyệt"). */
  autoFill: ProposalView[];
  /** Hộp đề xuất: những mục cần Sale duyệt. */
  box: BoxItem[];
  tasks: Array<{ id: string; title: string; dueAt: Date; source: string }>;
}

const asView = (p: typeof proposals.$inferSelect): ProposalView => ({
  id: p.id,
  field: p.field,
  value: p.value as ProposalValue,
  evidence: (p.evidence as Evidence[]) ?? [],
  flags: p.flags,
  createdAt: p.createdAt,
});

export async function loadConversationDetail(db: Db, tenantId: string, conversationId: string, now: Date): Promise<ConversationDetail | null> {
  const [conv] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));
  if (!conv) return null;

  const summary = (await loadConversationSummaries(db, tenantId, now)).find((s) => s.id === conversationId);
  if (!summary) return null;

  const rows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      senderKind: messages.senderKind,
      text: messages.text,
      attachments: messages.attachments,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.sentAt), desc(messages.id))
    .limit(MAX_MESSAGES);
  const msgs: MessageView[] = rows
    .reverse()
    .map((m) => ({ id: m.id, direction: m.direction, senderKind: m.senderKind, text: m.text, hasAttachment: m.attachments !== null, sentAt: m.sentAt }));

  const pending = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.conversationId, conversationId), eq(proposals.status, 'pending')))
    .orderBy(asc(proposals.createdAt));

  const approvedRows = await db
    .select({
      field: profileFields.field,
      value: profileFields.value,
      version: profileFields.version,
      updatedAt: profileFields.updatedAt,
      decidedBy: proposals.decidedBy,
      status: proposals.status,
    })
    .from(profileFields)
    .leftJoin(proposals, eq(proposals.id, profileFields.proposalId))
    .where(eq(profileFields.conversationId, conversationId));

  const box: BoxItem[] = pending
    .filter((p) => REVIEW_FIELDS.includes(p.field))
    .map((p) => ({ kind: 'proposal' as const, ...asView(p) }));
  if (summary.followup.suggestStop) {
    box.push({ kind: 'stop_followup', reason: `${summary.followup.count}/${summary.followup.max} lượt bám, khách không phản hồi`, count: summary.followup.count, max: summary.followup.max });
  }

  const open = await db
    .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, source: tasks.source })
    .from(tasks)
    .where(and(eq(tasks.conversationId, conversationId), isNull(tasks.doneAt)))
    .orderBy(asc(tasks.dueAt));

  return {
    summary,
    messages: msgs,
    approved: approvedRows.map((r) => ({
      field: r.field,
      value: r.value as ApprovedView['value'],
      version: r.version,
      updatedAt: r.updatedAt,
      decidedBy: r.decidedBy,
      status: r.status,
    })),
    autoFill: pending.filter((p) => LIGHT_FIELDS.includes(p.field)).map(asView),
    box,
    tasks: open,
  };
}

export interface HistoryEntry {
  kind: 'proposal' | 'stop_followup';
  field: string | null;
  /** Giá trị AI đề xuất. */
  proposedValue: ProposalValue | null;
  /** Giá trị cuối sau quyết định của Sale (có thể khác khi sửa). */
  decidedValue: unknown;
  status: string;
  decidedBy: string | null;
  /** Lúc quyết định (hoặc lúc AI đề xuất nếu chưa quyết định). */
  at: Date;
  evidence: Evidence[];
}

/** Lịch sử "AI đề xuất gì, ai duyệt, lúc nào" của một hội thoại. Không gồm tín hiệu nội bộ và đề xuất bị thay. */
export async function loadHistory(db: Db, tenantId: string, conversationId: string): Promise<HistoryEntry[]> {
  const rows = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.tenantId, tenantId), eq(proposals.conversationId, conversationId), ne(proposals.status, 'superseded')))
    .orderBy(asc(proposals.createdAt));
  const out: HistoryEntry[] = rows
    .filter((p) => !SIGNAL_FIELDS.includes(p.field))
    .map((p) => ({
      kind: 'proposal' as const,
      field: p.field,
      proposedValue: p.value as ProposalValue,
      decidedValue: p.decidedValue,
      status: p.status,
      decidedBy: p.decidedBy,
      at: p.decidedAt ?? p.createdAt,
      evidence: (p.evidence as Evidence[]) ?? [],
    }));
  const [stop] = await db.select().from(followupState).where(and(eq(followupState.tenantId, tenantId), eq(followupState.conversationId, conversationId)));
  if (stop) {
    out.push({ kind: 'stop_followup', field: null, proposedValue: null, decidedValue: null, status: 'accepted', decidedBy: stop.stoppedBy, at: stop.stoppedAt, evidence: [] });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}
