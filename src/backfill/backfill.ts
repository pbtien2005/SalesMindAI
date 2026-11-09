import { eq, inArray } from 'drizzle-orm';
import type { TokenCrypto } from '../crypto/token-crypto.js';
import type { Db } from '../db/client.js';
import { messages, pages } from '../db/schema.js';
import { GraphApiError, type GraphClient, type GraphMessage } from '../meta/graph-client.js';
import type { InboundMessage } from '../meta/parse-webhook.js';
import { stripNul } from '../meta/sanitize.js';
import { storeInbound, type StoreItem } from '../workers/store-messages.js';

/** Job liệt kê một trang hội thoại của Page; `after` là con trỏ trang kế tiếp (không có = trang đầu). */
export interface BackfillPageJob {
  /** `pages.id` trong DB. */
  pageId: string;
  after?: string;
}

/** Job lấy các tin gần nhất của một hội thoại. */
export interface BackfillConversationJob {
  pageId: string;
  /** ID hội thoại trên Facebook (dạng `t_...`). */
  conversationId: string;
}

/** Phần mà backfill cần của hàng đợi: không biết gì về pg-boss. */
export interface BackfillQueue {
  /** Trả false nếu bị bỏ vì đã có job cùng khóa đang chờ (khử trùng), true nếu đã xếp hàng. */
  enqueuePage(job: BackfillPageJob): Promise<boolean>;
  enqueueConversation(job: BackfillConversationJob): Promise<boolean>;
}

export interface BackfillLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface BackfillDeps {
  db: Db;
  graph: Pick<GraphClient, 'listConversations' | 'listConversationMessages' | 'getMessage'>;
  crypto: TokenCrypto;
  queue: BackfillQueue;
  log: BackfillLogger;
  /** Nghỉ giữa hai lời gọi chi tiết tin để không dồn dập vào Graph API. Mặc định 100 ms. */
  pacingMs?: number;
  /** Cho test thay bằng hàm không chờ. */
  sleep?: (ms: number) => Promise<void>;
}

/** Trạng thái backfill lưu trong `pages.backfill_state` để chạy lại được và để CLI hiển thị. */
export interface BackfillState {
  /** `running`: đang liệt kê hội thoại. `listed`: đã liệt kê hết (job từng hội thoại có thể còn chạy). `failed`: dừng vì lỗi không thể thử lại. */
  status: 'running' | 'listed' | 'failed';
  startedAt: string;
  conversationsEnqueued: number;
  updatedAt: string;
  reason?: string;
}

/**
 * Theo tài liệu Meta, chi tiết tin chỉ lấy được cho 20 tin gần nhất của mỗi hội thoại; tin cũ hơn trả
 * lỗi "đã xóa". Vì vậy backfill chỉ phục hồi tối đa chừng này tin mỗi hội thoại.
 */
export const RECENT_MESSAGE_LIMIT = 20;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function loadPage(db: Db, pageId: string) {
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  return page;
}

async function setState(db: Db, pageId: string, state: BackfillState): Promise<void> {
  await db.update(pages).set({ backfillState: state }).where(eq(pages.id, pageId));
}

async function markTokenInvalid(db: Db, pageId: string, reason: string): Promise<void> {
  await db.update(pages).set({ status: 'token_invalid' }).where(eq(pages.id, pageId));
  const prev = (await loadPage(db, pageId))?.backfillState as BackfillState | null | undefined;
  const now = new Date().toISOString();
  await setState(db, pageId, {
    status: 'failed',
    startedAt: prev?.startedAt ?? now,
    conversationsEnqueued: prev?.conversationsEnqueued ?? 0,
    updatedAt: now,
    reason,
  });
}

/**
 * Liệt kê MỘT trang hội thoại, đưa mỗi hội thoại thành một job, rồi đưa trang kế tiếp (nếu có) vào
 * hàng đợi. Mỗi lần chạy ngắn và bị chặn trên, con trỏ nằm trong dữ liệu job nên chạy lại từ chỗ dừng
 * được; chạy lặp một job chỉ tạo thêm job trùng (xử lý hội thoại là idempotent).
 *
 * Lỗi tạm thời (mạng, Meta 5xx, giới hạn tốc độ) được ném ra để pg-boss retry có backoff. Token hỏng
 * (mã 190) là lỗi vĩnh viễn: đánh dấu Page rồi dừng, không retry.
 */
export async function handleBackfillPage(deps: BackfillDeps, job: BackfillPageJob): Promise<void> {
  const { db, graph, crypto, queue, log } = deps;
  const page = await loadPage(db, job.pageId);
  if (!page) {
    log.warn({ pageId: job.pageId }, 'backfill: Page không còn trong DB, bỏ qua');
    return;
  }
  if (page.status === 'token_invalid') {
    log.warn({ pageId: page.id }, 'backfill: token của Page không hợp lệ, bỏ qua (cần kết nối lại)');
    return;
  }

  const token = crypto.decrypt(page.tokenEnc, page.fbPageId);
  let result: Awaited<ReturnType<typeof graph.listConversations>>;
  try {
    result = await graph.listConversations(token, page.fbPageId, job.after ? { after: job.after } : {});
  } catch (err) {
    if (err instanceof GraphApiError && err.isTokenInvalid) {
      await markTokenInvalid(db, page.id, 'token_invalid');
      log.warn({ pageId: page.id }, 'backfill: Meta báo token không hợp lệ (190), dừng');
      return;
    }
    throw err;
  }

  for (const c of result.conversations) {
    await queue.enqueueConversation({ pageId: page.id, conversationId: c.id });
  }
  if (result.after) await queue.enqueuePage({ pageId: page.id, after: result.after });

  const now = new Date().toISOString();
  const prev = page.backfillState as BackfillState | null;
  const continuing = job.after !== undefined && prev?.status === 'running';
  await setState(db, page.id, {
    status: result.after ? 'running' : 'listed',
    startedAt: continuing ? prev.startedAt : now,
    conversationsEnqueued: (continuing ? prev.conversationsEnqueued : 0) + result.conversations.length,
    updatedAt: now,
  });
  log.info(
    { pageId: page.id, conversations: result.conversations.length, hasMore: Boolean(result.after) },
    'backfill: đã liệt kê một trang hội thoại',
  );
}

export interface ConversationStats {
  /** Số tin Meta trả về cho hội thoại (trước khi cắt còn 20 tin gần nhất). */
  listed: number;
  /** Bỏ qua vì đã có trong DB (cùng mid), không cần gọi lấy chi tiết. */
  alreadyStored: number;
  /** Tin do chính Page gửi. */
  outbound: number;
  /** Tin không có text (thường chỉ có ảnh): không lưu, xem ghi chú ở handleBackfillConversation. */
  noText: number;
  /** Meta báo lỗi 4xx khi lấy chi tiết (thường là tin quá 20 gần nhất: "đã xóa"). */
  unavailable: number;
  stored: number;
  duplicates: number;
  heuristicSkipped: number;
  /** Meta báo danh sách tin còn trang sau mà ta không đọc: có thể thiếu tin gần đây. */
  truncated: boolean;
}

/** Lỗi 4xx của Meta cho MỘT tin (không phải token, không phải giới hạn tốc độ): tin không lấy được. */
const isUnavailable = (err: GraphApiError) =>
  err.httpStatus !== null && err.httpStatus >= 400 && err.httpStatus < 500 && !err.isTokenInvalid && !err.isRateLimited;

/**
 * Lấy các tin gần nhất của một hội thoại và lưu tin của khách. Idempotent: chạy lại không tạo trùng.
 *
 * - Chỉ lấy RECENT_MESSAGE_LIMIT (20) tin MỚI NHẤT theo `created_time` (tự sắp, không tin vào thứ tự Meta trả).
 * - Lỗi giới hạn tốc độ, mạng, 5xx hay phản hồi sai dạng được ném ra để pg-boss retry có backoff, NHƯNG
 *   những tin đã lấy được trước đó vẫn được lưu, nên mỗi lần retry chỉ phải làm phần còn lại.
 * - Chỉ lỗi 4xx của Meta trên một tin (thường là tin quá cũ) mới bị bỏ qua riêng tin đó.
 * - Tin không có text (ví dụ chỉ có ảnh) KHÔNG được lưu: Conversations API không cho lấy attachment theo
 *   tài liệu, nên dòng lưu ra sẽ rỗng và không phân biệt được với tin trống. Tin ảnh của khách vẫn vào DB
 *   qua webhook (có metadata attachment).
 */
export async function handleBackfillConversation(
  deps: BackfillDeps,
  job: BackfillConversationJob,
): Promise<ConversationStats> {
  const { db, graph, crypto, log } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const pacing = deps.pacingMs ?? 100;
  const stats: ConversationStats = {
    listed: 0, alreadyStored: 0, outbound: 0, noText: 0, unavailable: 0,
    stored: 0, duplicates: 0, heuristicSkipped: 0, truncated: false,
  };

  const page = await loadPage(db, job.pageId);
  if (!page || page.status === 'token_invalid') {
    log.warn({ pageId: job.pageId }, 'backfill: Page không còn hoặc token không hợp lệ, bỏ qua hội thoại');
    return stats;
  }
  const token = crypto.decrypt(page.tokenEnc, page.fbPageId);
  const pageRef = { id: page.id, tenantId: page.tenantId };

  const collected: GraphMessage[] = [];
  const flush = async () => {
    if (collected.length === 0) return;
    const items: StoreItem[] = collected.map((g) => ({ m: toInbound(g, page.fbPageId), page: pageRef }));
    items.sort((a, b) => a.m.sentAtMs - b.m.sentAtMs);
    const r = await db.transaction((tx) => storeInbound(tx, items, 'backfill', { heuristicDedupe: true }));
    stats.stored += r.stored;
    stats.duplicates += r.duplicates;
    stats.heuristicSkipped += r.heuristicSkipped;
    collected.length = 0;
  };

  try {
    const { messages: all, hasMore } = await graph.listConversationMessages(token, job.conversationId);
    stats.listed = all.length;
    stats.truncated = hasMore;
    // Tự sắp mới nhất trước rồi cắt: nếu Meta trả theo thứ tự khác thì cắt theo thứ tự đó sẽ giữ nhầm
    // những tin cũ nhất, đúng những tin Meta báo đã xóa.
    const listed = [...all].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, RECENT_MESSAGE_LIMIT);

    // Tin đã có trong DB (cùng mid) thì khỏi gọi lấy chi tiết: tiết kiệm lời gọi khi chạy lại hoặc
    // khi webhook đã lưu. Nếu id của Conversations API khác mid thì bước này không bỏ qua gì cả.
    const known = listed.length
      ? new Set(
          (await db.select({ mid: messages.mid }).from(messages).where(inArray(messages.mid, listed.map((l) => l.id)))).map((r) => r.mid),
        )
      : new Set<string>();

    let first = true;
    for (const l of listed) {
      if (known.has(l.id)) {
        stats.alreadyStored += 1;
        continue;
      }
      if (!first && pacing > 0) await sleep(pacing);
      first = false;
      try {
        const g = await graph.getMessage(token, l.id);
        if (g.fromId === null) {
          stats.unavailable += 1;
        } else if (g.fromId === page.fbPageId) {
          stats.outbound += 1; // tin do Page gửi: module này chỉ lưu tin của khách
        } else if (g.text === null || g.text === '') {
          stats.noText += 1;
        } else {
          collected.push(g);
        }
      } catch (err) {
        if (err instanceof GraphApiError && isUnavailable(err)) {
          stats.unavailable += 1; // thường là tin quá 20 gần nhất: Meta báo đã xóa
          continue;
        }
        throw err; // token hỏng, giới hạn tốc độ, mạng, 5xx, phản hồi sai dạng: xử lý ở dưới
      }
    }
    await flush();
  } catch (err) {
    // Xử lý lỗi gốc TRƯỚC, rồi mới cố giữ phần đã lấy: lỗi ghi DB lúc giữ lại không được che mất lỗi gốc.
    // (Đặc biệt quan trọng với 190: nếu không đánh dấu Page, mọi job sau vẫn gọi Meta bằng token hỏng.)
    const tokenInvalid = err instanceof GraphApiError && err.isTokenInvalid;
    if (tokenInvalid) {
      try {
        await markTokenInvalid(db, page.id, 'token_invalid');
        log.warn({ pageId: page.id }, 'backfill: Meta báo token không hợp lệ (190), dừng');
      } catch (dbErr) {
        log.warn({ pageId: page.id, err: String(dbErr) }, 'backfill: không đánh dấu được token_invalid');
      }
    }
    try {
      await flush();
    } catch (dbErr) {
      log.warn({ pageId: page.id, err: String(dbErr) }, 'backfill: không lưu được phần đã lấy trước khi lỗi');
    }
    if (tokenInvalid) return stats;
    throw err; // pg-boss retry có backoff
  }

  log.info({ pageId: page.id, ...stats }, 'backfill: đã xử lý một hội thoại');
  if (stats.truncated) {
    log.warn(
      { pageId: page.id },
      'backfill: Meta báo danh sách tin của hội thoại còn trang sau mà ta không đọc; có thể thiếu tin gần đây (cần xác minh cách phân trang)',
    );
  }
  if (stats.heuristicSkipped > 0) {
    log.warn(
      { pageId: page.id, heuristicSkipped: stats.heuristicSkipped },
      'backfill: có tin bị coi là trùng theo thời gian và nội dung dù khác mid; có thể id của Conversations API khác mid của webhook',
    );
  }
  return stats;
}

/** Chuyển một tin Graph thành dạng chung với webhook để dùng chung phần lưu. */
function toInbound(g: GraphMessage, fbPageId: string): InboundMessage {
  return {
    fbPageId,
    psid: stripNul(g.fromId!) as string, // đã lọc: chỉ tin của khách mới tới đây
    mid: stripNul(g.id) as string,
    text: g.text === null ? null : (stripNul(g.text) as string),
    attachments: null,
    sentAtMs: g.createdAt.getTime(),
  };
}
