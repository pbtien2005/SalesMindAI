/**
 * Một lần AI đọc một hội thoại và tạo ĐỀ XUẤT.
 *
 * Bất biến:
 * - Câu gốc chỉ lấy từ tin KHÁCH đã lưu, và là chuỗi con thật (`locateQuote`): chuỗi mô hình viết ra không bao giờ
 *   được lưu. Không đạt thì bỏ trường và tăng `fields_rejected`.
 * - Không bao giờ giải ngày: `timeline` chỉ lưu cụm gốc, loại (`classifyTime`) và lúc tin được gửi.
 * - Chỉ ghi `proposals` (và `extraction_runs`); `profile_fields` chỉ do service duyệt ghi.
 * - Idempotent: UNIQUE (hội thoại, tin khách cuối, phiên bản prompt).
 * - Không log nội dung tin, câu gốc hay giá trị trích: chỉ số đếm, id, token.
 */
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, extractionRuns, messages, profileFields, proposals, tenants } from '../db/schema.js';
import { checkAndReserve, recordUsage, releaseReservation, tenantCap } from '../ai/budget.js';
import { buildOrderDraft } from '../orders/draft.js';
import { findPhones } from './phone.js';
import { findSkus } from './sku.js';
import { PROMPT_VERSION } from './prompt.js';
import { classifyTime, needsClarification } from './time-expr.js';
import {
  type Candidate,
  type Evidence,
  type Extractor,
  type ExtractorMessage,
  INTENTS,
  MESSAGE_PURPOSES,
  NEEDS_CLARIFICATION,
  type ProposalFieldName,
  type ProposalValue,
  ZERO_USAGE,
} from './types.js';
import { locateQuote } from './verify-evidence.js';

export interface RunLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface RunDeps {
  db: Db;
  extractor: Extractor;
  log: RunLogger;
  /** Số tin gần nhất (cả hai chiều) đưa cho AI đọc. */
  contextMessages: number;
  /** Có thì mỗi lời gọi mô hình bị giới hạn theo hạn mức ngày của doanh nghiệp (xem `ai/budget.ts`). */
  budget?: { defaultCap: number; now?: () => Date };
}

export type RunResult =
  | { status: 'skipped'; reason: 'conversation_missing' | 'budget_exhausted' | 'ai_disabled' | 'no_customer_message' | 'before_enabled' | 'already_done' }
  | { status: 'succeeded' | 'failed'; proposed: number; rejected: number; failureReason?: string };

const MAX_VALUE_LENGTH = 200;

interface Built {
  field: ProposalFieldName;
  value: ProposalValue;
  evidence: Evidence[];
  flags: string[];
}

const FAILURE_REASON = { refused: 'refusal', max_tokens: 'max_tokens', invalid: 'invalid_output' } as const;

/** Kiểm chứng một ứng viên của mô hình. Trả null nếu phải loại. Hàm thuần, test trực tiếp được. */
export function buildProposal(c: Candidate, customerById: Map<string, ExtractorMessage>): Built | null {
  if (c.quotes.length === 0 || c.quotes.length > 4) return null;
  const evidence: Evidence[] = [];
  for (const q of c.quotes) {
    const msg = customerById.get(q.messageId); // chỉ tin KHÁCH của đúng hội thoại này
    if (!msg) return null;
    const loc = locateQuote(msg.text, q.quote);
    if (!loc) return null; // câu bịa hoặc đã bị sửa: loại cả trường
    evidence.push({ messageId: msg.id, start: loc.start, end: loc.end, text: loc.text });
  }
  const value = c.value.trim().slice(0, MAX_VALUE_LENGTH);
  if (value === '') return null;

  switch (c.field) {
    case 'timeline': {
      const phrase = evidence[0]!.text; // luôn là đoạn GỐC đã kiểm chứng, không phải chữ của mô hình
      const kind = classifyTime(phrase);
      if (kind === 'none') return null;
      const sentAt = customerById.get(evidence[0]!.messageId)!.sentAt.toISOString();
      return {
        field: 'timeline',
        value: { text: phrase, kind, sentAt },
        evidence,
        flags: needsClarification(kind) ? [NEEDS_CLARIFICATION] : [],
      };
    }
    case 'unit_price':
      if (!/\d/u.test(evidence.map((e) => e.text).join(' '))) return null;
      return { field: 'unit_price', value: { text: value }, evidence, flags: [] };
    case 'budget':
      if (!/\d|triệu|nghìn|ngàn|tỷ|tỉ|trăm/iu.test(evidence.map((e) => e.text).join(' '))) return null;
      return { field: 'budget', value: { text: value }, evidence, flags: [] };
    case 'message_purpose':
      if (!(MESSAGE_PURPOSES as readonly string[]).includes(value)) return null;
      return { field: c.field, value: { text: value }, evidence, flags: [] };
    case 'intent':
      if (!(INTENTS as readonly string[]).includes(value)) return null;
      return { field: c.field, value: { text: value }, evidence, flags: [] };
    default:
      return { field: c.field, value: { text: value }, evidence, flags: [] };
  }
}

/** SĐT trích bằng code từ tin khách: lấy số của tin mới nhất có SĐT. Câu gốc là đoạn khớp nguyên văn. */
export function buildPhoneProposal(customerMsgs: ExtractorMessage[]): Built | null {
  for (let i = customerMsgs.length - 1; i >= 0; i--) {
    const m = customerMsgs[i]!;
    const phones = findPhones(m.text);
    const p = phones[phones.length - 1];
    if (p) {
      return {
        field: 'phone',
        value: { text: p.value },
        evidence: [{ messageId: m.id, start: p.start, end: p.end, text: p.text }],
        flags: [],
      };
    }
  }
  return null;
}

/** Mã hàng trích bằng code từ tin khách: lấy mã của tin mới nhất có mã. */
export function buildSkuProposal(customerMsgs: ExtractorMessage[]): Built | null {
  for (let i = customerMsgs.length - 1; i >= 0; i--) {
    const m = customerMsgs[i]!;
    const skus = findSkus(m.text);
    const s = skus[skus.length - 1];
    if (s) return { field: 'sku', value: { text: s.value }, evidence: [{ messageId: m.id, start: s.start, end: s.end, text: s.text }], flags: [] };
  }
  return null;
}

export async function runExtraction(deps: RunDeps, conversationId: string): Promise<RunResult> {
  const { db, extractor, log } = deps;

  const [conv] = await db
    .select({
      id: conversations.id,
      tenantId: conversations.tenantId,
      enabled: tenants.aiExtractionEnabled,
      enabledAt: tenants.aiEnabledAt,
    })
    .from(conversations)
    .innerJoin(tenants, eq(tenants.id, conversations.tenantId))
    .where(eq(conversations.id, conversationId));
  if (!conv) return { status: 'skipped', reason: 'conversation_missing' };
  if (!conv.enabled) return { status: 'skipped', reason: 'ai_disabled' };

  // Cùng thứ tự với sweeper: sent_at rồi id.
  const rows = await db
    .select({ id: messages.id, direction: messages.direction, text: messages.text, sentAt: messages.sentAt })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), ne(messages.text, '')))
    .orderBy(desc(messages.sentAt), desc(messages.id))
    .limit(deps.contextMessages);
  const ctx: ExtractorMessage[] = rows
    .filter((r): r is typeof r & { text: string } => r.text !== null && r.text.trim() !== '')
    .reverse()
    .map((r) => ({ id: r.id, direction: r.direction, text: r.text, sentAt: r.sentAt }));

  const customerMsgs = ctx.filter((m) => m.direction === 'inbound');
  const latest = customerMsgs[customerMsgs.length - 1];
  if (!latest) return { status: 'skipped', reason: 'no_customer_message' };
  if (conv.enabledAt && latest.sentAt < conv.enabledAt) return { status: 'skipped', reason: 'before_enabled' };

  const [done] = await db
    .select({ id: extractionRuns.id })
    .from(extractionRuns)
    .where(and(eq(extractionRuns.conversationId, conversationId), eq(extractionRuns.upToMessageId, latest.id), eq(extractionRuns.promptVersion, PROMPT_VERSION)));
  if (done) return { status: 'skipped', reason: 'already_done' };

  // Hạn mức theo doanh nghiệp: hết thì bỏ qua (KHÔNG ghi run, KHÔNG retry); sweeper sẽ bù khi sang ngày mới.
  const clock = deps.budget?.now ?? (() => new Date());
  if (deps.budget) {
    const cap = await tenantCap(db, conv.tenantId, deps.budget.defaultCap);
    if (!(await checkAndReserve(db, conv.tenantId, clock(), cap)).allowed) {
      log.warn({ extraction: { conversationId, skipped: 'budget_exhausted' } }, 'hết hạn mức AI trong ngày của doanh nghiệp');
      return { status: 'skipped', reason: 'budget_exhausted' };
    }
  }

  // Lỗi tạm thời được NÉM ở đây (không ghi run) để hàng đợi retry rồi vào dead-letter.
  let outcome;
  try {
    outcome = await extractor.extract({ messages: ctx });
  } catch (e) {
    if (deps.budget) await releaseReservation(db, conv.tenantId, clock()); // chưa tốn gì: trả lại lượt
    throw e;
  }
  if (deps.budget) await recordUsage(db, conv.tenantId, outcome.usage ?? ZERO_USAGE, clock());

  const customerById = new Map(customerMsgs.map((m) => [m.id, m]));
  const built: Built[] = [];
  let rejected = 0;
  let failureReason: string | undefined;
  if (outcome.kind === 'ok') {
    for (const c of outcome.candidates) {
      const b = buildProposal(c, customerById);
      if (b) built.push(b);
      else rejected += 1;
    }
  } else {
    failureReason = FAILURE_REASON[outcome.kind];
  }
  // SĐT do code trích: có dù mô hình lỗi.
  const phone = buildPhoneProposal(customerMsgs);
  if (phone) built.push(phone);
  const sku = buildSkuProposal(customerMsgs);
  if (sku) built.push(sku);

  const usage = outcome.usage ?? ZERO_USAGE;
  const status = failureReason ? 'failed' : 'succeeded';

  const proposed = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(extractionRuns)
      .values({
        tenantId: conv.tenantId,
        conversationId,
        upToMessageId: latest.id,
        promptVersion: PROMPT_VERSION,
        model: extractor.model,
        status,
        failureReason: failureReason ?? null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        fieldsRejected: rejected,
      })
      .onConflictDoNothing({ target: [extractionRuns.conversationId, extractionRuns.upToMessageId, extractionRuns.promptVersion] })
      .returning({ id: extractionRuns.id });
    if (!run) return null; // job khác đã chạy xong trước

    if (built.length === 0) return 0;
    const fields = built.map((b) => b.field);
    const approved = await tx
      .select({ field: profileFields.field, value: profileFields.value })
      .from(profileFields)
      .where(and(eq(profileFields.conversationId, conversationId), inArray(profileFields.field, fields)));
    const previous = await tx
      .select({ id: proposals.id, field: proposals.field, value: proposals.value, status: proposals.status })
      .from(proposals)
      .where(and(eq(proposals.conversationId, conversationId), inArray(proposals.field, fields), ne(proposals.status, 'superseded')));

    const textOf = (v: unknown) => (v as { text?: string } | null)?.text;
    let count = 0;
    for (const b of built) {
      const text = b.value.text;
      // Đã duyệt đúng giá trị này, hoặc Sale đã quyết định về đúng giá trị này (bỏ qua, sửa): không nhắc lại mỗi tin mới.
      if (approved.some((a) => a.field === b.field && textOf(a.value) === text)) continue;
      const same = previous.filter((p) => p.field === b.field && textOf(p.value) === text);
      if (same.length > 0) continue;
      // Giá trị khác với đề xuất đang chờ: đề xuất cũ bị thay.
      await tx
        .update(proposals)
        .set({ status: 'superseded' })
        .where(and(eq(proposals.conversationId, conversationId), eq(proposals.field, b.field), eq(proposals.status, 'pending')));
      await tx.insert(proposals).values({
        tenantId: conv.tenantId,
        conversationId,
        runId: run.id,
        field: b.field,
        value: b.value,
        evidence: b.evidence,
        flags: b.flags,
      });
      count += 1;
    }
    await tx.update(extractionRuns).set({ fieldsProposed: count }).where(eq(extractionRuns.id, run.id));
    return count;
  });

  if (proposed === null) return { status: 'skipped', reason: 'already_done' };
  // Đơn nháp (cảnh 4): ngoài giao dịch trích xuất, lỗi không làm hỏng run (chỉ ghi log).
  if (status === 'succeeded') {
    try {
      await buildOrderDraft(db, conv.tenantId, conversationId);
    } catch (e) {
      log.warn({ extraction: { conversationId, orderDraftError: e instanceof Error ? e.name : 'error' } }, 'không dựng được đơn nháp');
    }
  }
  log.info(
    { extraction: { conversationId, status, proposed, rejected, failureReason: failureReason ?? null, model: extractor.model, ...usage } },
    'đã trích xuất hội thoại',
  );
  return { status, proposed, rejected, ...(failureReason ? { failureReason } : {}) };
}
