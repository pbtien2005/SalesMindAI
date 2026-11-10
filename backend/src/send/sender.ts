/**
 * Gửi tin cho khách. CHỈ do người dùng bấm gửi: không có job, cron hay hook nào gọi `send`.
 * `GraphMessageSender` gửi thật qua Send API; `DemoMessageSender` (demo) chỉ ghi vào hội thoại như một tin của Page.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { TokenCrypto } from '../crypto/token-crypto.js';
import type { Db } from '../db/client.js';
import { conversations, messages, pages } from '../db/schema.js';
import { GraphApiError, type GraphClient } from '../meta/graph-client.js';
import { sendWindow } from './window.js';

export type SendErrorCode = 'not_found' | 'page_inactive' | 'window_closed' | 'token_invalid' | 'rate_limited' | 'user_unavailable' | 'meta_error' | 'network' | 'invalid';

export class SendError extends Error {
  override readonly name = 'SendError';
  constructor(
    readonly code: SendErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface SendInput {
  tenantId: string;
  conversationId: string;
  text: string;
  /** Người bấm gửi (ghi vào `messages.sent_by_user_id`). */
  byUserId: string;
}

export interface MessageSender {
  send(input: SendInput, now: Date): Promise<{ messageId: string; sentAt: Date }>;
}

export const MAX_SEND_LENGTH = 1000;

export function checkText(raw: string): string {
  const t = raw.trim();
  if (t === '') throw new SendError('invalid', 'Tin nhắn trống.');
  if (t.length > MAX_SEND_LENGTH) throw new SendError('invalid', `Tin nhắn quá dài (tối đa ${MAX_SEND_LENGTH} ký tự).`);
  return t;
}

export interface GraphSenderDeps {
  db: Db;
  crypto: TokenCrypto;
  graph: Pick<GraphClient, 'sendText'>;
  /** `FB_APP_ID`: ghi vào `app_id` để tin hiện là do SalesMind gửi (`page_app`). */
  ownAppId: string;
}

function classify(e: GraphApiError): SendError {
  if (e.isTokenInvalid) return new SendError('token_invalid', 'Token của Page không còn hiệu lực: hãy kết nối lại Page.');
  if (e.isRateLimited) return new SendError('rate_limited', 'Facebook đang giới hạn tốc độ gửi tin của Page này. Thử lại sau ít phút.');
  // 10 (quyền) với subcode 2018278 (ngoài cửa sổ 24 giờ) theo hiểu biết chung, CHƯA đối chiếu tài liệu: coi mọi lỗi 10 là hết cửa sổ.
  if (e.code === 10 || e.subcode === 2018278) return new SendError('window_closed', 'Facebook không cho gửi tin chủ động tới khách này (đã quá 24 giờ kể từ tin cuối của khách).');
  if (e.code === 551 || e.subcode === 1545041) return new SendError('user_unavailable', 'Khách này hiện không nhận được tin nhắn.');
  if (e.httpStatus === null) return new SendError('network', 'Không kết nối được tới Facebook. Thử lại.');
  return new SendError('meta_error', 'Facebook từ chối gửi tin.');
}

export class GraphMessageSender implements MessageSender {
  constructor(private readonly d: GraphSenderDeps) {}

  async send(input: SendInput, now: Date): Promise<{ messageId: string; sentAt: Date }> {
    const text = checkText(input.text);
    const { db } = this.d;
    const [row] = await db
      .select({ psid: conversations.psid, pageId: conversations.pageId, lastUser: conversations.lastUserInteractionAt, fbPageId: pages.fbPageId, tokenEnc: pages.tokenEnc, status: pages.status })
      .from(conversations)
      .innerJoin(pages, eq(pages.id, conversations.pageId))
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.tenantId, input.tenantId)));
    if (!row) throw new SendError('not_found', 'Không có hội thoại này.');
    if (row.status !== 'active' || row.tokenEnc === '') throw new SendError('page_inactive', 'Page chưa kết nối hoặc cần kết nối lại.');
    // Kiểm cửa sổ TRƯỚC khi gọi Meta: hết cửa sổ thì không có request nào ra ngoài.
    if (!sendWindow(row.lastUser, now).open) throw new SendError('window_closed', 'Đã quá 24 giờ kể từ tin cuối của khách, Facebook không cho gửi chủ động.');

    let messageId: string;
    try {
      ({ messageId } = await this.d.graph.sendText(this.d.crypto.decrypt(row.tokenEnc, row.fbPageId), row.psid, text));
    } catch (e) {
      if (e instanceof GraphApiError) {
        const err = classify(e);
        if (err.code === 'token_invalid') await db.update(pages).set({ status: 'token_invalid' }).where(eq(pages.id, row.pageId));
        throw err;
      }
      throw e;
    }

    // Lưu ngay (mid = message_id của Meta). Echo đến sau với cùng mid thì ON CONFLICT bỏ qua; nếu mid khác thì
    // khử trùng dự phòng trong `storeInbound` (cùng hội thoại, cùng nội dung, trong vài giây).
    await db.transaction(async (tx) => {
      await tx
        .insert(messages)
        .values({
          tenantId: input.tenantId,
          pageId: row.pageId,
          conversationId: input.conversationId,
          mid: messageId,
          direction: 'outbound',
          senderKind: 'page_app',
          appId: this.d.ownAppId,
          text,
          sentAt: now,
          source: 'send',
          sentByUserId: input.byUserId,
        })
        .onConflictDoNothing({ target: messages.mid });
      await tx
        .update(conversations)
        .set({
          lastMessageAt: sql`GREATEST(${conversations.lastMessageAt}, ${now}::timestamptz)`,
          lastPageMessageAt: sql`GREATEST(${conversations.lastPageMessageAt}, ${now}::timestamptz)`,
        })
        .where(eq(conversations.id, input.conversationId));
    });
    return { messageId, sentAt: now };
  }
}
