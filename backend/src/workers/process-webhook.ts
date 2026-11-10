import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pages } from '../db/schema.js';
import { parseWebhookPayload, type ParseStats } from '../meta/parse-webhook.js';
import { classifyPageSender, DEFAULT_PAGE_INBOX_APP_IDS, type SenderKindConfig } from '../meta/sender-kind.js';
import {
  storeInbound,
  storePolicyEvents,
  type InteractionItem,
  type PolicyEventItem,
  type StoreItem,
} from './store-messages.js';

/** Logger tối thiểu (FastifyBaseLogger thỏa). Không bao giờ truyền nội dung tin nhắn vào đây. */
export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface ProcessStats extends ParseStats {
  /** Tin mới được lưu (cả tin của khách lẫn tin của Page). */
  stored: number;
  /** Tin đã có từ trước (cùng mid), bỏ qua. */
  duplicates: number;
  /** TIN NHẮN gửi tới Page chưa được kết nối: gây lỗi để retry (không bỏ tin). */
  unknownPage: number;
  /**
   * Tương tác (reaction, postback, referral) hoặc sự kiện chính sách gửi tới Page chưa được kết nối. Chỉ đếm và
   * ghi cảnh báo, KHÔNG retry: mất một lượt thả cảm xúc không đáng làm đầy dead-letter, khác với mất tin nhắn.
   */
  unknownPageOther: number;
  /** Sự kiện chính sách mới được lưu. */
  policyStored: number;
}

export interface ProcessOptions {
  /** Cấu hình phân loại người gửi của tin do Page gửi. Mặc định: không có app riêng, chỉ có Page Inbox. */
  sender?: SenderKindConfig;
  /**
   * Gọi SAU khi transaction lưu tin thành công, với các hội thoại vừa có tin khách mới (để xếp việc AI trích
   * xuất). Lỗi trong đây chỉ được ghi log, KHÔNG làm hỏng job webhook (tin đã lưu; sweeper sẽ bù việc bị lỡ).
   */
  afterStore?: (conversationIds: string[]) => Promise<void>;
}

const DEFAULT_SENDER_CONFIG: SenderKindConfig = { ownAppId: '', pageInboxAppIds: DEFAULT_PAGE_INBOX_APP_IDS };

/**
 * Có sự kiện gửi tới Page chưa có trong DB (chưa kết nối xong, hoặc đã bị gỡ).
 *
 * Ném lỗi thay vì lặng lẽ bỏ qua: Meta đã nhận 200 và sẽ không gửi lại, nên bỏ qua là mất tin.
 * Job được retry (đủ lâu để cover việc kết nối Page chậm một chút); hết retry thì vào dead-letter,
 * nơi payload còn nguyên để chạy lại sau khi kết nối Page. Các sự kiện của Page đã biết trong cùng
 * payload đã được lưu trước khi ném lỗi, và chạy lại thì chúng chỉ bị đếm là trùng.
 */
export class UnknownPageError extends Error {
  override readonly name = 'UnknownPageError';
  constructor(readonly count: number) {
    super(`${count} sự kiện gửi tới Page chưa được kết nối`);
  }
}

/**
 * Xử lý một payload webhook: lưu tin của khách và của Page (echo), ghi nhận tương tác của khách
 * (reaction, postback, referral) và sự kiện chính sách. Idempotent theo `mid`.
 *
 * Toàn bộ phần lưu chạy trong MỘT transaction: lỗi giữa chừng thì không lưu gì và job được retry,
 * lần sau lưu lại từ đầu mà không trùng nhờ ON CONFLICT (mid). Dùng câu lệnh hàng loạt (số truy vấn
 * không tăng theo số tin) nên batch 1000 sự kiện của Meta vẫn là một transaction ngắn.
 */
export async function processWebhookPayload(
  db: Db,
  payload: unknown,
  log: Logger,
  opts: ProcessOptions = {},
): Promise<ProcessStats> {
  const sender = opts.sender ?? DEFAULT_SENDER_CONFIG;
  const parsed = parseWebhookPayload(payload);
  const stats: ProcessStats = { ...parsed.stats, stored: 0, duplicates: 0, unknownPage: 0, unknownPageOther: 0, policyStored: 0 };
  // Chỉ gồm sự kiện chính sách MỚI thật sự và chỉ ghi log SAU khi transaction thành công (không lặp khi retry).
  let newPolicy: PolicyEventItem[] = [];
  let customerConversations: string[] = [];

  const fbPageIds = [
    ...new Set([
      ...parsed.messages.map((m) => m.fbPageId),
      ...parsed.interactions.map((i) => i.fbPageId),
      ...parsed.policyEvents.map((p) => p.fbPageId),
    ]),
  ];

  if (fbPageIds.length > 0) {
    await db.transaction(async (tx) => {
      const known = await tx
        .select({ id: pages.id, tenantId: pages.tenantId, fbPageId: pages.fbPageId })
        .from(pages)
        .where(inArray(pages.fbPageId, fbPageIds));
      const byFbId = new Map(known.map((p) => [p.fbPageId, { id: p.id, tenantId: p.tenantId }]));

      // `parsed.messages` đã sắp theo timestamp: giữ nguyên thứ tự đó.
      const items: StoreItem[] = [];
      for (const m of parsed.messages) {
        const page = byFbId.get(m.fbPageId);
        if (!page) {
          stats.unknownPage += 1;
          continue;
        }
        items.push({
          m,
          page,
          senderKind: m.direction === 'inbound' ? 'customer' : classifyPageSender(m.appId, sender),
        });
      }

      const interactions: InteractionItem[] = [];
      for (const i of parsed.interactions) {
        const page = byFbId.get(i.fbPageId);
        if (!page) stats.unknownPageOther += 1;
        else interactions.push({ page, psid: i.psid, atMs: i.atMs });
      }

      const policy: PolicyEventItem[] = [];
      for (const p of parsed.policyEvents) {
        const page = byFbId.get(p.fbPageId);
        if (!page) stats.unknownPageOther += 1;
        else policy.push({ page, event: p });
      }

      const r = await storeInbound(tx, items, 'webhook', { interactions });
      stats.stored += r.stored;
      stats.duplicates += r.duplicates;
      customerConversations = r.customerTextConversationIds;
      newPolicy = await storePolicyEvents(tx, policy);
      stats.policyStored = newPolicy.length;
    });
  }

  // Chỉ ghi số đếm, không ghi nội dung tin, psid hay token.
  log.info({ webhook: stats }, 'đã xử lý webhook');
  if (opts.afterStore && customerConversations.length > 0) {
    try {
      await opts.afterStore(customerConversations);
    } catch (err) {
      // Tin đã lưu. Không ném: nếu ném thì job webhook retry vô ích. Sweeper sẽ bù việc trích xuất bị lỡ.
      log.warn({ err: err instanceof Error ? err.message : String(err), conversations: customerConversations.length }, 'không xếp được việc trích xuất, sweeper sẽ bù');
    }
  }
  for (const { page: _page, event } of newPolicy) {
    // Meta cảnh báo hoặc khóa khả năng gửi tin của Page: người vận hành cần biết ngay.
    // `reason` do Meta viết (không phải nội dung của khách).
    log.warn({ policy: { fbPageId: event.fbPageId, action: event.action, reason: event.reason } }, 'Meta báo chính sách nhắn tin của Page');
  }
  if (stats.unknownPageOther > 0) {
    log.warn({ unknownPageOther: stats.unknownPageOther }, 'bỏ qua tương tác hoặc sự kiện chính sách của Page chưa được kết nối');
  }
  if (stats.unknownPage > 0) {
    log.warn({ unknownPage: stats.unknownPage }, 'có sự kiện gửi tới Page chưa được kết nối, sẽ thử lại');
    throw new UnknownPageError(stats.unknownPage);
  }
  return stats;
}
