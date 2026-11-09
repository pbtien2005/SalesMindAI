import { z } from 'zod';
import { NUL, stripNul } from './sanitize.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Một tin nhắn đã chuẩn hóa, của khách hoặc của Page. */
export interface ParsedMessage {
  /** ID Page (entry.id). */
  fbPageId: string;
  /** Page-scoped ID của KHÁCH: người gửi (tin đến) hoặc người nhận (tin Page gửi). */
  psid: string;
  /** message.mid: khóa khử trùng. */
  mid: string;
  direction: 'inbound' | 'outbound';
  /** `message.app_id` của echo (chuỗi); null với tin của khách và tin lấy qua backfill. */
  appId: string | null;
  text: string | null;
  attachments: unknown[] | null;
  /** `timestamp` của Meta, mili giây (giả định, xem PROGRESS.md điểm bổ sung). */
  sentAtMs: number;
}

/** Hành động của khách mở lại cửa sổ nhắn tin nhưng không phải là tin nhắn. */
export interface InteractionEvent {
  fbPageId: string;
  psid: string;
  atMs: number;
  kind: 'reaction' | 'postback' | 'referral';
}

/** Cảnh báo hoặc khóa từ Meta (`messaging_policy_enforcement`). */
export interface PolicyEvent {
  fbPageId: string;
  atMs: number;
  action: string;
  reason: string | null;
}

export interface ParseStats {
  /** Tin do Page gửi (echo hoặc sender là Page): được GIỮ, hướng outbound. */
  outbound: number;
  /** Sự kiện không thuộc loại nào ta lưu (delivery, read, optin...). */
  notMessage: number;
  /** Sự kiện thuộc loại ta lưu nhưng sai cấu trúc. */
  invalid: number;
  /** Cùng mid xuất hiện nhiều lần trong một payload. */
  duplicateInPayload: number;
  /** Số tương tác của khách (reaction, postback, referral) ghi nhận được. */
  interactions: number;
  /** Số sự kiện chính sách (cảnh báo, khóa) ghi nhận được. */
  policyEvents: number;
}

export interface ParseResult {
  /** Đã sắp theo timestamp tăng dần (ổn định: bằng nhau thì giữ thứ tự gốc). */
  messages: ParsedMessage[];
  interactions: InteractionEvent[];
  policyEvents: PolicyEvent[];
  stats: ParseStats;
}

// Route đã bỏ NUL khỏi payload trước khi vào hàng đợi. Đây là lớp phòng thủ thứ hai cho payload
// đến bằng đường khác: ID chứa NUL thì coi là sự kiện hỏng; nội dung (text, attachments) thì bỏ
// NUL đi rồi vẫn lưu. Xem sanitize.ts.
const cleanId = z.string().min(1).refine((s) => !s.includes(NUL), 'ID chứa ký tự NUL');

/** `app_id` có thể là số hoặc chuỗi trong JSON; luôn chuẩn hóa thành chuỗi. */
const appId = z.union([z.string().min(1), z.number().int().nonnegative()]).transform((v) => String(v));

const messageEventSchema = z.object({
  sender: z.object({ id: cleanId }),
  recipient: z.object({ id: cleanId }),
  timestamp: z.number().int().positive(),
  message: z.object({
    mid: cleanId,
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
    app_id: appId.optional(),
    attachments: z.array(z.unknown()).optional(),
  }),
});

const interactionEventSchema = z.object({
  sender: z.object({ id: cleanId }),
  timestamp: z.number().int().positive(),
});

const policyBodySchema = z.object({
  action: z.string().min(1).max(64),
  reason: z.string().optional(),
});

/**
 * Khóa chứa nội dung cảnh báo. Tài liệu Meta (đọc ngày 2026-11-09) dùng `policy_enforcement`, nhưng đây là
 * điểm CHƯA kiểm chứng bằng payload thật và bỏ lỡ cảnh báo khóa Page rất đắt, nên nhận cả dạng gạch ngang và
 * dạng có tiền tố tên field. Không có khóa nào khớp thì sự kiện rơi vào "không thuộc loại nào ta lưu".
 */
const POLICY_KEYS = ['policy_enforcement', 'policy-enforcement', 'messaging_policy_enforcement'] as const;
const policyKeyOf = (ev: Record<string, unknown>) => POLICY_KEYS.find((k) => k in ev);

const entrySchema = z.object({
  id: cleanId,
  time: z.number().int().positive().optional(),
  messaging: z.array(z.unknown()).optional(),
  // Khi app KHÔNG phải chủ thread (Handover Protocol), sự kiện đến qua `standby` thay vì `messaging`.
  standby: z.array(z.unknown()).optional(),
});

const MAX_REASON_LENGTH = 1000;

/**
 * Rút tin nhắn, tương tác của khách và sự kiện chính sách từ payload webhook của Meta
 * (`object` / `entry[]` / `messaging[]` và `standby[]`).
 *
 * Không bao giờ ném lỗi: Meta gộp nhiều sự kiện vào một request, một sự kiện hỏng không được
 * làm mất các sự kiện còn lại. Sự kiện bị bỏ qua được đếm trong `stats`.
 */
export function parseWebhookPayload(payload: unknown): ParseResult {
  const stats: ParseStats = { outbound: 0, notMessage: 0, invalid: 0, duplicateInPayload: 0, interactions: 0, policyEvents: 0 };
  const messages: ParsedMessage[] = [];
  const interactions: InteractionEvent[] = [];
  const policyEvents: PolicyEvent[] = [];
  const seen = new Set<string>();
  const result = (): ParseResult => ({ messages, interactions, policyEvents, stats });

  if (!isRecord(payload) || payload.object !== 'page' || !Array.isArray(payload.entry)) return result();

  for (const rawEntry of payload.entry) {
    const entry = entrySchema.safeParse(rawEntry);
    if (!entry.success) {
      stats.invalid += 1;
      continue;
    }
    const fbPageId = entry.data.id;

    for (const rawEvent of [...(entry.data.messaging ?? []), ...(entry.data.standby ?? [])]) {
      if (!isRecord(rawEvent)) {
        stats.notMessage += 1;
        continue;
      }

      // 1) Tin nhắn (của khách, hoặc echo của Page)
      if ('message' in rawEvent) {
        const event = messageEventSchema.safeParse(rawEvent);
        if (!event.success) {
          stats.invalid += 1;
          continue;
        }
        const { sender, recipient, message, timestamp } = event.data;
        const fromPage = message.is_echo === true || sender.id === fbPageId;
        // Echo: người gửi là Page, người nhận là khách. Khách là bên còn lại.
        const psid = fromPage ? recipient.id : sender.id;
        if (psid === fbPageId) {
          stats.invalid += 1; // không xác định được khách (Page gửi cho chính Page?)
          continue;
        }
        if (seen.has(message.mid)) {
          stats.duplicateInPayload += 1;
          continue;
        }
        seen.add(message.mid);
        if (fromPage) stats.outbound += 1;
        messages.push({
          fbPageId,
          psid,
          mid: message.mid,
          direction: fromPage ? 'outbound' : 'inbound',
          appId: fromPage ? (message.app_id ?? null) : null,
          text: message.text === undefined ? null : (stripNul(message.text) as string),
          attachments:
            message.attachments && message.attachments.length > 0 ? (stripNul(message.attachments) as unknown[]) : null,
          sentAtMs: timestamp,
        });
        continue;
      }

      // 2) Tương tác của khách ngoài tin nhắn: chỉ cần biết khách vừa làm gì và lúc nào.
      //    Chỉ kiểm tra SỰ CÓ MẶT của khóa, không phụ thuộc cấu trúc bên trong (postback và referral
      //    chưa lấy được cấu trúc từ tài liệu).
      const kind = 'reaction' in rawEvent ? 'reaction' : 'postback' in rawEvent ? 'postback' : 'referral' in rawEvent ? 'referral' : null;
      if (kind) {
        const event = interactionEventSchema.safeParse(rawEvent);
        if (!event.success) {
          stats.invalid += 1;
          continue;
        }
        if (event.data.sender.id === fbPageId) {
          stats.notMessage += 1; // Page tự thả cảm xúc hoặc bấm: không phải hành động của khách
          continue;
        }
        if (kind === 'reaction') {
          const reaction = rawEvent.reaction;
          // Bỏ thả cảm xúc (`unreact`) không mở cửa sổ. Thiếu `action` thì coi là `react`.
          if (isRecord(reaction) && typeof reaction.action === 'string' && reaction.action !== 'react') {
            stats.notMessage += 1;
            continue;
          }
        }
        interactions.push({ fbPageId, psid: event.data.sender.id, atMs: event.data.timestamp, kind });
        stats.interactions += 1;
        continue;
      }

      // 3) Cảnh báo hoặc khóa từ Meta (xem POLICY_KEYS).
      const policyKey = policyKeyOf(rawEvent);
      if (policyKey) {
        const body = policyBodySchema.safeParse(rawEvent[policyKey]);
        const ts = rawEvent.timestamp;
        const atMs = typeof ts === 'number' && Number.isInteger(ts) && ts > 0 ? ts : entry.data.time;
        if (!body.success || atMs === undefined) {
          stats.invalid += 1;
          continue;
        }
        const { action, reason } = body.data;
        policyEvents.push({
          fbPageId,
          atMs,
          action: stripNul(action) as string,
          reason: reason === undefined ? null : (stripNul(reason.slice(0, MAX_REASON_LENGTH)) as string),
        });
        stats.policyEvents += 1;
        continue;
      }

      stats.notMessage += 1; // delivery, read, optin...
    }
  }

  // Array.prototype.sort ổn định: cùng timestamp thì giữ thứ tự xuất hiện.
  messages.sort((a, b) => a.sentAtMs - b.sentAtMs);
  return result();
}
