/**
 * Mô hình đọc cho API demo: chi tiết một hội thoại (tin, thẻ khách, Hộp đề xuất, việc) và lịch sử quyết định.
 * Câu gốc đi kèm offset (`start`, `end`, tính theo đơn vị UTF-16 của văn bản tin) để giao diện tô đoạn khớp.
 */
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, followupState, orders, pages, messages, payments, profileFields, proposals, replyDrafts, tasks, tenants } from '../db/schema.js';
import { evaluateDeposit } from '../orders/deposit.js';
import { OFFLINE_BILL_MODEL } from '../bills/offline-bill-reader.js';
import { LIGHT_FIELDS, ORDER_FIELDS, REVIEW_FIELDS, SIGNAL_FIELDS, type Evidence, type ProposalValue } from '../extraction/types.js';
import { sendWindow } from '../send/window.js';
import { toAttachmentViews, type AttachmentView } from '../meta/attachments.js';
import { loadSummariesFor, type ConversationSummary } from '../followup/overview.js';

const MAX_MESSAGES = 300;

export interface MessageView {
  id: string;
  direction: 'inbound' | 'outbound';
  senderKind: string;
  text: string | null;
  hasAttachment: boolean;
  attachments: AttachmentView[];
  sentAt: Date;
}

export interface OrderView {
  id: string;
  code: string | null;
  status: 'draft' | 'awaiting_deposit' | 'confirmed' | 'cancelled';
  customerName: string | null;
  phone: string | null;
  address: string | null;
  sku: string;
  productName: string;
  quantity: number;
  unitPriceVnd: number;
  totalVnd: number;
  depositRequiredVnd: number;
  depositPaidVnd: number;
  flags: string[];
  /** Sale đã sửa nháp. */
  saleEdited: boolean;
}

export interface PaymentView {
  id: string;
  messageId: string;
  status: 'proposed' | 'confirmed' | 'rejected';
  readOk: boolean;
  amountVnd: number | null;
  transferNote: string | null;
  billTime: string | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
  /** `true` khi do bộ đọc mô phỏng (không phải AI thật) đọc. */
  simulatedReader: boolean;
  amountEdited: boolean;
  confirmedBy: string | null;
  /** Tính khi đọc từ số tiền và đơn; không có khi không đọc được hoặc chưa có đơn. */
  verdict: 'ok' | 'below' | null;
  ratioPercent: number | null;
  thresholdPercent: number | null;
  orderTotalVnd: number | null;
}

export interface ReplyDraftView {
  id: string;
  orderId: string;
  kind: 'confirm_order' | 'top_up' | 'deposit_received';
  text: string;
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
  /** Có gửi tin được cho khách này không (cửa sổ 24 giờ và trạng thái Page). */
  reply: { open: boolean; closesAt: Date | null; pageActive: boolean };
  /** Đơn của hội thoại: đơn đang mở, nếu không thì đơn mới nhất. */
  order: OrderView | null;
  /** Tin nháp đang chờ Sale bấm Gửi. */
  replyDrafts: ReplyDraftView[];
  /** Khoản chuyển khoản AI đọc từ ảnh bill của khách (Sale xác nhận). */
  payments: PaymentView[];
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
  const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));
  if (!conv) return null;

  const summary = (await loadSummariesFor(db, tenantId, now, [conv]))[0];
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
    .map((m) => ({ id: m.id, direction: m.direction, senderKind: m.senderKind, text: m.text, hasAttachment: m.attachments !== null, attachments: toAttachmentViews(m.attachments), sentAt: m.sentAt }));

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

  const orderRows = await db.select().from(orders).where(and(eq(orders.conversationId, conversationId), eq(orders.tenantId, tenantId))).orderBy(desc(orders.createdAt));
  const o = orderRows.find((r) => r.status === 'draft' || r.status === 'awaiting_deposit') ?? orderRows[0];
  const order: OrderView | null = o
    ? { id: o.id, code: o.code, status: o.status, customerName: o.customerName, phone: o.phone, address: o.address, sku: o.sku, productName: o.productName, quantity: o.quantity, unitPriceVnd: o.unitPriceVnd, totalVnd: o.totalVnd, depositRequiredVnd: o.depositRequiredVnd, depositPaidVnd: o.depositPaidVnd, flags: o.flags, saleEdited: o.saleEditedAt !== null }
    : null;
  const drafts = await db.select().from(replyDrafts).where(and(eq(replyDrafts.conversationId, conversationId), eq(replyDrafts.tenantId, tenantId), eq(replyDrafts.status, 'pending'))).orderBy(asc(replyDrafts.createdAt));

  const [tn] = await db.select({ pct: tenants.depositPercent }).from(tenants).where(eq(tenants.id, tenantId));
  const payRows = await db.select().from(payments).where(and(eq(payments.conversationId, conversationId), eq(payments.tenantId, tenantId))).orderBy(asc(payments.createdAt));
  const orderById = new Map(orderRows.map((r) => [r.id, r]));
  const paymentViews: PaymentView[] = payRows.map((p) => {
    const ord = (p.orderId ? orderById.get(p.orderId) : undefined) ?? orderRows.find((r) => r.status === 'awaiting_deposit');
    const ev = p.readOk && p.amountVnd !== null && ord ? evaluateDeposit(p.amountVnd, ord.totalVnd, tn?.pct ?? 50) : null;
    return {
      id: p.id,
      messageId: p.messageId,
      status: p.status,
      readOk: p.readOk,
      amountVnd: p.amountVnd,
      transferNote: p.transferNote,
      billTime: p.billTime,
      bbox: (p.bbox as PaymentView['bbox']) ?? null,
      simulatedReader: p.readModel === OFFLINE_BILL_MODEL,
      amountEdited: p.amountEdited,
      confirmedBy: p.confirmedBy,
      verdict: ev?.verdict ?? null,
      ratioPercent: ev?.ratioPercent ?? null,
      thresholdPercent: ev ? (tn?.pct ?? 50) : null,
      orderTotalVnd: ord?.totalVnd ?? null,
    };
  });

  const [pg] = await db.select({ status: pages.status }).from(pages).where(eq(pages.id, conv.pageId));
  const win = sendWindow(conv.lastUserInteractionAt, now);
  return {
    summary,
    reply: { open: win.open, closesAt: win.closesAt, pageActive: pg?.status === 'active' },
    order,
    replyDrafts: drafts.map((d) => ({ id: d.id, orderId: d.orderId, kind: d.kind, text: d.text })),
    payments: paymentViews,
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
    .filter((p) => !SIGNAL_FIELDS.includes(p.field) && !ORDER_FIELDS.includes(p.field))
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
