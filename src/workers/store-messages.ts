import { and, between, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, messages, pagePolicyEvents } from '../db/schema.js';
import type { ParsedMessage, PolicyEvent } from '../meta/parse-webhook.js';
import type { SenderKind } from '../meta/sender-kind.js';

/** Transaction của Drizzle (kiểu của tham số callback `db.transaction`). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface PageRef {
  /** `pages.id` trong DB (không phải ID Page của Facebook). */
  id: string;
  tenantId: string;
}

export interface StoreItem {
  m: ParsedMessage;
  page: PageRef;
  /** `customer` cho tin đến; với tin của Page là kết quả phân loại theo `app_id`. */
  senderKind: SenderKind;
}

/** Hành động của khách ngoài tin nhắn (reaction, postback, referral) đã gắn với Page trong DB. */
export interface InteractionItem {
  page: PageRef;
  psid: string;
  atMs: number;
}

export interface StoreResult {
  /** Tin mới được lưu. */
  stored: number;
  /** Tin đã có từ trước (cùng mid), bỏ qua. */
  duplicates: number;
  /** Tin bỏ qua vì khớp một tin webhook đã có theo (hội thoại, hướng, thời điểm, nội dung) dù khác mid. */
  heuristicSkipped: number;
}

export interface StoreOptions {
  /**
   * Khử trùng dự phòng cho backfill. Tài liệu Meta không nói `id` của Conversations API có trùng
   * `message.mid` của webhook không. Nếu không trùng, cùng một tin sẽ vào hai lần. Bật tùy chọn này thì
   * tin khớp một tin `webhook` đã có (cùng hội thoại, cùng hướng, cách nhau tối đa 2 giây, cùng nội dung)
   * bị bỏ qua. Đánh đổi: hai tin giống hệt nhau trong 2 giây mà webhook bỏ lỡ cái thứ hai sẽ bị coi là
   * trùng. Tin không có text (ví dụ chỉ có ảnh) không bao giờ bị khử trùng theo cách này vì không đủ
   * thông tin.
   */
  heuristicDedupe?: boolean;
  /** Tương tác của khách cần ghi vào `last_user_interaction_at` (gộp chung một câu upsert hội thoại). */
  interactions?: InteractionItem[];
}

/** `created_time` của Graph chỉ chính xác tới giây, `timestamp` của webhook tới mili giây. */
const HEURISTIC_WINDOW_MS = 2000;
/** Số dòng mỗi câu INSERT: giữ số tham số dưới giới hạn 65535 của Postgres và transaction ngắn. */
const CHUNK = 500;

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

const convKey = (pageId: string, psid: string) => `${pageId}\u0001${psid}`;

interface ConvAgg {
  tenantId: string;
  pageId: string;
  psid: string;
  /** Tin mới nhất, mọi hướng. */
  lastMs: number | null;
  /** Hành động mới nhất của khách (tin đến, reaction, postback, referral). */
  lastUserMs: number | null;
  /** Tin mới nhất do Page gửi. */
  lastPageMs: number | null;
}

const maxOf = (a: number | null, b: number) => (a === null ? b : Math.max(a, b));
const toDate = (ms: number | null) => (ms === null ? null : new Date(ms));

/**
 * Lưu tin đến và tin của Page vào DB, idempotent theo `mid`, bằng câu lệnh hàng loạt (số truy vấn không
 * tăng theo số tin). Phải gọi trong một transaction. `items` nên đã sắp theo thời gian.
 *
 * Mỗi (Page, khách) một hội thoại. Ba mốc thời gian dùng GREATEST nên tin đến sai thứ tự không làm lùi:
 * `last_message_at` (mọi tin), `last_user_interaction_at` (chỉ hành động của khách), `last_page_message_at`
 * (chỉ tin của Page). Tin của Page KHÔNG làm mới `last_user_interaction_at`.
 */
export async function storeInbound(
  tx: Tx,
  items: StoreItem[],
  source: 'webhook' | 'backfill',
  opts: StoreOptions = {},
): Promise<StoreResult> {
  const result: StoreResult = { stored: 0, duplicates: 0, heuristicSkipped: 0 };
  const interactions = opts.interactions ?? [];
  if (items.length === 0 && interactions.length === 0) return result;

  // 1) Gộp theo hội thoại: tin và tương tác cùng vào một câu upsert (khóa dòng theo một thứ tự duy nhất).
  const agg = new Map<string, ConvAgg>();
  const slot = (page: PageRef, psid: string): ConvAgg => {
    const key = convKey(page.id, psid);
    let cur = agg.get(key);
    if (!cur) {
      cur = { tenantId: page.tenantId, pageId: page.id, psid, lastMs: null, lastUserMs: null, lastPageMs: null };
      agg.set(key, cur);
    }
    return cur;
  };
  for (const { m, page } of items) {
    const c = slot(page, m.psid);
    c.lastMs = maxOf(c.lastMs, m.sentAtMs);
    if (m.direction === 'inbound') c.lastUserMs = maxOf(c.lastUserMs, m.sentAtMs);
    else c.lastPageMs = maxOf(c.lastPageMs, m.sentAtMs);
  }
  for (const i of interactions) {
    const c = slot(i.page, i.psid);
    c.lastUserMs = maxOf(c.lastUserMs, i.atMs); // không đổi last_message_at: đây không phải tin nhắn
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
          lastMessageAt: toDate(c.lastMs),
          lastUserInteractionAt: toDate(c.lastUserMs),
          lastPageMessageAt: toDate(c.lastPageMs),
        })),
      )
      .onConflictDoUpdate({
        target: [conversations.pageId, conversations.psid],
        // GREATEST bỏ qua NULL: cột không có giá trị mới giữ nguyên, tin đến sai thứ tự không làm lùi mốc.
        set: {
          lastMessageAt: sql`GREATEST(${conversations.lastMessageAt}, excluded.last_message_at)`,
          lastUserInteractionAt: sql`GREATEST(${conversations.lastUserInteractionAt}, excluded.last_user_interaction_at)`,
          lastPageMessageAt: sql`GREATEST(${conversations.lastPageMessageAt}, excluded.last_page_message_at)`,
        },
      })
      .returning({ id: conversations.id, pageId: conversations.pageId, psid: conversations.psid });
    for (const r of rows) convIdByKey.set(convKey(r.pageId, r.psid), r.id);
  }
  if (items.length === 0) return result;

  // 2) Khử trùng dự phòng (chỉ backfill): bỏ tin khớp một tin webhook đã có dù khác mid.
  let toInsert = items;
  if (opts.heuristicDedupe) {
    const convIds = [...new Set(items.map(({ m, page }) => convIdByKey.get(convKey(page.id, m.psid))!))];
    const times = items.map((i) => i.m.sentAtMs);
    const existing = await tx
      .select({
        conversationId: messages.conversationId,
        mid: messages.mid,
        direction: messages.direction,
        sentAt: messages.sentAt,
        text: messages.text,
      })
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
          e.direction === m.direction && // tin của khách và tin của Page giống nhau không phải một tin
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
        part.map(({ m, page, senderKind }) => ({
          tenantId: page.tenantId,
          pageId: page.id,
          conversationId: convIdByKey.get(convKey(page.id, m.psid))!,
          mid: m.mid,
          direction: m.direction,
          senderKind,
          appId: m.appId,
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

export interface PolicyEventItem {
  page: PageRef;
  event: PolicyEvent;
}

/**
 * Lưu cảnh báo hoặc khóa từ Meta. Idempotent theo (Page, thời điểm, hành động). Trả về những sự kiện MỚI thật
 * sự (không gồm sự kiện đã có từ lần gửi trước), để người gọi chỉ ghi log cho sự kiện mới.
 */
export async function storePolicyEvents(tx: Tx, items: PolicyEventItem[]): Promise<PolicyEventItem[]> {
  const inserted: PolicyEventItem[] = [];
  for (const part of chunks(items, CHUNK)) {
    const rows = await tx
      .insert(pagePolicyEvents)
      .values(
        part.map(({ page, event }) => ({
          tenantId: page.tenantId,
          pageId: page.id,
          action: event.action,
          reason: event.reason,
          occurredAt: new Date(event.atMs),
        })),
      )
      .onConflictDoNothing({ target: [pagePolicyEvents.pageId, pagePolicyEvents.occurredAt, pagePolicyEvents.action] })
      .returning({ pageId: pagePolicyEvents.pageId, occurredAt: pagePolicyEvents.occurredAt, action: pagePolicyEvents.action });
    const fresh = new Set(rows.map((r) => `${r.pageId}|${r.occurredAt.getTime()}|${r.action}`));
    for (const it of part) {
      if (fresh.has(`${it.page.id}|${it.event.atMs}|${it.event.action}`)) inserted.push(it);
    }
  }
  return inserted;
}
