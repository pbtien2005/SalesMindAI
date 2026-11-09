import { z } from 'zod';
import { NUL, stripNul } from './sanitize.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Một tin nhắn đến từ khách, đã chuẩn hóa. */
export interface InboundMessage {
  /** ID Page nhận tin (entry.id). */
  fbPageId: string;
  /** Page-scoped ID của khách. */
  psid: string;
  /** message.mid: khóa khử trùng. */
  mid: string;
  text: string | null;
  attachments: unknown[] | null;
  /** `timestamp` của Meta, mili giây (giả định, xem PROGRESS.md điểm bổ sung). */
  sentAtMs: number;
}

export interface ParseStats {
  /** Tin do chính Page gửi (is_echo hoặc sender là Page). */
  echo: number;
  /** Sự kiện không phải tin nhắn (delivery, read, postback...). */
  notMessage: number;
  /** Sự kiện có `message` nhưng sai cấu trúc. */
  invalid: number;
  /** Cùng mid xuất hiện nhiều lần trong một payload. */
  duplicateInPayload: number;
}

export interface ParseResult {
  /** Đã sắp theo timestamp tăng dần (ổn định: bằng nhau thì giữ thứ tự gốc). */
  messages: InboundMessage[];
  stats: ParseStats;
}

// Route đã bỏ NUL khỏi payload trước khi vào hàng đợi. Đây là lớp phòng thủ thứ hai cho payload
// đến bằng đường khác: ID chứa NUL thì coi là sự kiện hỏng; nội dung (text, attachments) thì bỏ
// NUL đi rồi vẫn lưu. Xem sanitize.ts.
const cleanId = z.string().min(1).refine((s) => !s.includes(NUL), 'ID chứa ký tự NUL');

const eventSchema = z.object({
  sender: z.object({ id: cleanId }),
  recipient: z.object({ id: cleanId }),
  timestamp: z.number().int().positive(),
  message: z.object({
    mid: cleanId,
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
    attachments: z.array(z.unknown()).optional(),
  }),
});

const entrySchema = z.object({
  id: cleanId,
  messaging: z.array(z.unknown()).optional(),
});

/**
 * Rút các tin nhắn đến từ payload webhook của Meta (`object` / `entry[]` / `messaging[]`).
 *
 * Không bao giờ ném lỗi: Meta gộp nhiều sự kiện vào một request, một sự kiện hỏng không được
 * làm mất các sự kiện còn lại. Sự kiện bị bỏ qua được đếm trong `stats`.
 */
export function parseWebhookPayload(payload: unknown): ParseResult {
  const stats: ParseStats = { echo: 0, notMessage: 0, invalid: 0, duplicateInPayload: 0 };
  const messages: InboundMessage[] = [];
  const seen = new Set<string>();

  if (!isRecord(payload) || payload.object !== 'page' || !Array.isArray(payload.entry)) {
    return { messages, stats };
  }

  for (const rawEntry of payload.entry) {
    const entry = entrySchema.safeParse(rawEntry);
    if (!entry.success) {
      stats.invalid += 1;
      continue;
    }
    const fbPageId = entry.data.id;

    for (const rawEvent of entry.data.messaging ?? []) {
      if (!isRecord(rawEvent) || !('message' in rawEvent)) {
        stats.notMessage += 1;
        continue;
      }
      const event = eventSchema.safeParse(rawEvent);
      if (!event.success) {
        stats.invalid += 1;
        continue;
      }
      const { sender, message, timestamp } = event.data;

      // Tin do Page gửi: is_echo, hoặc sender chính là Page (phòng thủ).
      if (message.is_echo === true || sender.id === fbPageId) {
        stats.echo += 1;
        continue;
      }
      if (seen.has(message.mid)) {
        stats.duplicateInPayload += 1;
        continue;
      }
      seen.add(message.mid);

      messages.push({
        fbPageId,
        psid: sender.id,
        mid: message.mid,
        text: message.text === undefined ? null : (stripNul(message.text) as string),
        attachments:
          message.attachments && message.attachments.length > 0
            ? (stripNul(message.attachments) as unknown[])
            : null,
        sentAtMs: timestamp,
      });
    }
  }

  // Array.prototype.sort ổn định: cùng timestamp thì giữ thứ tự xuất hiện.
  messages.sort((a, b) => a.sentAtMs - b.sentAtMs);
  return { messages, stats };
}
