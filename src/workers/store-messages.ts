import { and, between, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, messages } from '../db/schema.js';
import type { InboundMessage } from '../meta/parse-webhook.js';

/** Transaction của Drizzle (kiểu của tham số callback `db.transaction`). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface PageRef {
  /** `pages.id` trong DB (không phải ID Page của Facebook). */
  id: string;
  tenantId: string;
}

export interface StoreItem {
  m: InboundMessage;
  page: PageRef;
}

export interface StoreResult {
  /** Tin mới được lưu. */
  stored: number;
  /** Tin đã có từ trước (cùng mid), bỏ qua. */
  duplicates: number;
  /** Tin bỏ qua vì khớp một tin webhook đã có theo (hội thoại, thời điểm, nội dung) dù khác mid. */
  heuristicSkipped: number;
}

export interface StoreOptions {
  /**
   * Khử trùng dự phòng cho backfill. Tài liệu Meta không nói `id` của Conversations API có trùng
   * `message.mid` của webhook không. Nếu không trùng, cùng một tin sẽ vào hai lần. Bật tùy chọn này thì
   * tin khớp một tin `webhook` đã có (cùng hội thoại, cách nhau tối đa 2 giây, cùng nội dung) bị bỏ qua.
   * Đánh đổi: hai tin giống hệt nhau trong 2 giây mà webhook bỏ lỡ cái thứ hai sẽ bị coi là trùng.
   * Tin không có text (ví dụ chỉ có ảnh) không bao giờ bị khử trùng theo cách này vì không đủ thông tin.
   */
  heuristicDedupe?: boolean;
}

/** `created_time` của Graph chỉ chính xác tới giây, `timestamp` của webhook tới mili giây. */
const HEURISTIC_WINDOW_MS = 2000;
/** Số dòng mỗi câu INSERT: giữ số tham số dưới giới hạn 65535 của Postgres và transaction ngắn. */
const CHUNK = 500;

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

const convKey = (pageId: string, psid: string) => `${pageId}\u0001${psid}`;

/**
 * Lưu tin đến vào DB, idempotent theo `mid`, bằng câu lệnh hàng loạt (số truy vấn không tăng theo số
 * tin). Phải gọi trong một transaction. `items` nên đã sắp theo thời gian.
 */
export async function storeInbound(
  tx: Tx,
  items: StoreItem[],
  source: 'webhook' | 'backfill',
  opts: StoreOptions = {},
): Promise<StoreResult> {
  const result: StoreResult = { stored: 0, duplicates: 0, heuristicSkipped: 0 };
  if (items.length === 0) return result;

  // 1) Mỗi (page, khách) một conversation; last_message_at = tin mới nhất trong lô.
  const agg = new Map<string, { tenantId: string; pageId: string; psid: string; lastMs: number }>();
  for (const { m, page } of items) {
    const key = convKey(page.id, m.psid);
    const cur = agg.get(key);
    if (cur) cur.lastMs = Math.max(cur.lastMs, m.sentAtMs);
    else agg.set(key, { tenantId: page.tenantId, pageId: page.id, psid: m.psid, lastMs: m.sentAtMs });
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

  // 2) Khử trùng dự phòng (chỉ backfill): bỏ tin khớp một tin webhook đã có dù khác mid.
  let toInsert = items;
  if (opts.heuristicDedupe) {
    const convIds = [...new Set(convIdByKey.values())];
    const times = items.map((i) => i.m.sentAtMs);
    const existing = await tx
      .select({ conversationId: messages.conversationId, mid: messages.mid, sentAt: messages.sentAt, text: messages.text })
      .from(messages)
      .where(
        and(
          inArray(messages.conversationId, convIds),
          eq(messages.source, 'webhook'),
          between(
            messages.sentAt,
            new Date(Math.min(...times) - HEURISTIC_WINDOW_MS),
            new Date(Math.max(...times) + HEURISTIC_WINDOW_MS),
          ),
        ),
      );
    toInsert = items.filter(({ m, page }) => {
      const cid = convIdByKey.get(convKey(page.id, m.psid));
      const match = existing.some(
        (e) =>
          e.conversationId === cid &&
          e.mid !== m.mid && // cùng mid là trùng bình thường, ON CONFLICT lo; không tính là dự phòng
          Math.abs(e.sentAt.getTime() - m.sentAtMs) <= HEURISTIC_WINDOW_MS &&
          m.text !== null && // tin không có nội dung (ví dụ chỉ có ảnh) không đủ thông tin để so khớp
          e.text === m.text,
      );
      if (match) result.heuristicSkipped += 1;
      return !match;
    });
  }

  // 3) Tin nhắn: ON CONFLICT (mid) DO NOTHING, dòng trả về là những tin mới thật sự.
  for (const part of chunks(toInsert, CHUNK)) {
    const inserted = await tx
      .insert(messages)
      .values(
        part.map(({ m, page }) => ({
          tenantId: page.tenantId,
          pageId: page.id,
          conversationId: convIdByKey.get(convKey(page.id, m.psid))!,
          mid: m.mid,
          text: m.text,
          attachments: m.attachments,
          sentAt: new Date(m.sentAtMs),
          source,
        })),
      )
      .onConflictDoNothing({ target: messages.mid })
      .returning({ id: messages.id });
    result.stored += inserted.length;
    result.duplicates += part.length - inserted.length;
  }
  return result;
}
