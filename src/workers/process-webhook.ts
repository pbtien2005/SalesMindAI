import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pages } from '../db/schema.js';
import { parseWebhookPayload, type ParseStats } from '../meta/parse-webhook.js';
import { storeInbound, type StoreItem } from './store-messages.js';

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
      const items: StoreItem[] = [];
      for (const m of inbound) {
        const page = byFbId.get(m.fbPageId);
        if (page) items.push({ m, page: { id: page.id, tenantId: page.tenantId } });
        else stats.unknownPage += 1;
      }
      const r = await storeInbound(tx, items, 'webhook');
      stats.stored += r.stored;
      stats.duplicates += r.duplicates;
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
