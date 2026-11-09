import { inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, messages, pages } from '../db/schema.js';
import { parseWebhookPayload, type InboundMessage, type ParseStats } from '../meta/parse-webhook.js';

/** Logger tối thiểu (FastifyBaseLogger thỏa). Không bao giờ truyền nội dung tin nhắn vào đây. */
export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface ProcessStats extends ParseStats {
  /** Tin mới được lưu. */
  stored: number;
  /** Tin đã có từ trước (cùng mid), bỏ qua. */
  duplicates: number;
  /** Tin gửi tới Page chưa được kết nối. */
  unknownPage: number;
}

/**
 * Có tin gửi tới Page chưa có trong DB (chưa kết nối xong, hoặc đã bị gỡ).
 *
 * Ném lỗi thay vì lặng lẽ bỏ qua: Meta đã nhận 200 và sẽ không gửi lại, nên bỏ qua là mất tin.
 * Job được retry (đủ lâu để cover việc kết nối Page chậm một chút); hết retry thì vào dead-letter,
 * nơi payload còn nguyên để chạy lại sau khi kết nối Page. Các tin của Page đã biết trong cùng
 * payload đã được lưu trước khi ném lỗi, và chạy lại thì chúng chỉ bị đếm là trùng.
 */
export class UnknownPageError extends Error {
  override readonly name = 'UnknownPageError';
  constructor(readonly count: number) {
    super(`${count} tin gửi tới Page chưa được kết nối`);
  }
}

/** Số dòng mỗi câu INSERT: giữ số tham số dưới giới hạn 65535 của Postgres và transaction ngắn. */
const CHUNK = 500;

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

const convKey = (pageId: string, psid: string) => `${pageId}\u0001${psid}`;

/**
 * Xử lý một payload webhook: lưu mọi tin đến vào DB, idempotent theo `mid`.
 *
 * Toàn bộ phần lưu chạy trong MỘT transaction: lỗi giữa chừng thì không lưu gì và job được retry,
 * lần sau lưu lại từ đầu mà không trùng nhờ ON CONFLICT (mid). Dùng câu lệnh hàng loạt (số truy vấn
 * không tăng theo số tin) nên batch 1000 sự kiện của Meta vẫn là một transaction ngắn.
 */
export async function processWebhookPayload(
  db: Db,
  payload: unknown,
  log: Logger,
): Promise<ProcessStats> {
  const { messages: inbound, stats: parseStats } = parseWebhookPayload(payload);
  const stats: ProcessStats = { ...parseStats, stored: 0, duplicates: 0, unknownPage: 0 };

  if (inbound.length > 0) {
    await db.transaction(async (tx) => {
      const fbPageIds = [...new Set(inbound.map((m) => m.fbPageId))];
      const known = await tx
        .select({ id: pages.id, tenantId: pages.tenantId, fbPageId: pages.fbPageId })
        .from(pages)
        .where(inArray(pages.fbPageId, fbPageIds));
      const byFbId = new Map(known.map((p) => [p.fbPageId, p]));

      // `inbound` đã sắp theo timestamp: giữ nguyên thứ tự đó.
      const toStore: Array<{ m: InboundMessage; pageId: string; tenantId: string }> = [];
      for (const m of inbound) {
        const page = byFbId.get(m.fbPageId);
        if (page) toStore.push({ m, pageId: page.id, tenantId: page.tenantId });
        else stats.unknownPage += 1;
      }
      if (toStore.length === 0) return;

      // 1) Mỗi (page, khách) một conversation; last_message_at = tin mới nhất trong payload.
      const agg = new Map<string, { tenantId: string; pageId: string; psid: string; lastMs: number }>();
      for (const { m, pageId, tenantId } of toStore) {
        const key = convKey(pageId, m.psid);
        const cur = agg.get(key);
        if (cur) cur.lastMs = Math.max(cur.lastMs, m.sentAtMs);
        else agg.set(key, { tenantId, pageId, psid: m.psid, lastMs: m.sentAtMs });
      }
      // Sắp theo khóa để các job chạy song song khóa dòng theo cùng một thứ tự (tránh deadlock).
      const convRows = [...agg.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const convIdByKey = new Map<string, string>();
      for (const part of chunks(convRows, CHUNK)) {
        const rows = await tx
          .insert(conversations)
          .values(
            part.map(([, c]) => ({
              tenantId: c.tenantId,
              pageId: c.pageId,
              psid: c.psid,
              lastMessageAt: new Date(c.lastMs),
            })),
          )
          .onConflictDoUpdate({
            target: [conversations.pageId, conversations.psid],
            // GREATEST bỏ qua NULL; tin đến sai thứ tự không làm lùi last_message_at.
            set: { lastMessageAt: sql`GREATEST(${conversations.lastMessageAt}, excluded.last_message_at)` },
          })
          .returning({ id: conversations.id, pageId: conversations.pageId, psid: conversations.psid });
        for (const r of rows) convIdByKey.set(convKey(r.pageId, r.psid), r.id);
      }

      // 2) Tin nhắn: ON CONFLICT (mid) DO NOTHING, dòng trả về là những tin mới thật sự.
      for (const part of chunks(toStore, CHUNK)) {
        const inserted = await tx
          .insert(messages)
          .values(
            part.map(({ m, pageId, tenantId }) => ({
              tenantId,
              pageId,
              conversationId: convIdByKey.get(convKey(pageId, m.psid))!,
              mid: m.mid,
              text: m.text,
              attachments: m.attachments,
              sentAt: new Date(m.sentAtMs),
              source: 'webhook' as const,
            })),
          )
          .onConflictDoNothing({ target: messages.mid })
          .returning({ id: messages.id });
        stats.stored += inserted.length;
        stats.duplicates += part.length - inserted.length;
      }
    });
  }

  // Chỉ ghi số đếm, không ghi nội dung tin, psid hay token.
  log.info({ webhook: stats }, 'đã xử lý webhook');
  if (stats.unknownPage > 0) {
    log.warn({ unknownPage: stats.unknownPage }, 'có tin gửi tới Page chưa được kết nối, sẽ thử lại');
    throw new UnknownPageError(stats.unknownPage);
  }
  return stats;
}
