import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// PostgreSQL 18 có uuidv7() sẵn: khóa chính theo thời gian, thân thiện với index.
const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const pageStatus = pgEnum('page_status', ['active', 'token_invalid']);
export const messageSource = pgEnum('message_source', ['webhook', 'backfill']);

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

/*
 * Tính nhất quán đa tenant: tenant_id, page_id, conversation_id của một dòng phải khớp nhau.
 * Thay vì tin vào code, DB ép bằng khóa ngoại ghép (cột phụ thuộc, cột cha) trỏ vào
 * các ràng buộc UNIQUE (id, tenant_id) / (id, page_id, tenant_id) ở bảng cha.
 */

export const pages = pgTable(
  'pages',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** ID Page trên Facebook. */
    fbPageId: text('fb_page_id').notNull().unique(),
    name: text('name').notNull(),
    /** Page token đã mã hóa AES-256-GCM, dạng `v1:iv:tag:ciphertext`. Không bao giờ lưu rõ. */
    tokenEnc: text('token_enc').notNull(),
    /** Sức khỏe của TOKEN (không phải của đăng ký webhook): `token_invalid` khi Meta báo lỗi 190. */
    status: pageStatus('status').notNull().default('active'),
    /** Lúc đăng ký webhook thành công. Null nghĩa là CHƯA chắc nhận được tin của Page này. */
    subscribedAt: timestamp('subscribed_at', { withTimezone: true }),
    /** Con trỏ để chạy lại backfill từ chỗ dừng (mốc 5). */
    backfillState: jsonb('backfill_state'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('pages_id_tenant_unique').on(t.id, t.tenantId),
    index('pages_tenant_idx').on(t.tenantId),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    pageId: uuid('page_id').notNull(),
    /** Page-scoped ID của khách. */
    psid: text('psid').notNull(),
    /** Thời điểm tin mới nhất (theo sent_at). Worker cập nhật bằng GREATEST() ở mốc 3. */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('conversations_page_psid_unique').on(t.pageId, t.psid),
    unique('conversations_id_page_tenant_unique').on(t.id, t.pageId, t.tenantId),
    foreignKey({
      name: 'conversations_page_tenant_fk',
      columns: [t.pageId, t.tenantId],
      foreignColumns: [pages.id, pages.tenantId],
    }),
    index('conversations_tenant_idx').on(t.tenantId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    pageId: uuid('page_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    /** `message.mid` của Meta: khóa khử trùng (idempotent). */
    mid: text('mid').notNull().unique(),
    /** Null khi tin chỉ có attachment. */
    text: text('text'),
    attachments: jsonb('attachments'),
    /** Thời điểm tin được gửi, theo `timestamp` của Meta (không phải lúc ta nhận). */
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    source: messageSource('source').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'messages_page_tenant_fk',
      columns: [t.pageId, t.tenantId],
      foreignColumns: [pages.id, pages.tenantId],
    }),
    foreignKey({
      name: 'messages_conversation_page_tenant_fk',
      columns: [t.conversationId, t.pageId, t.tenantId],
      foreignColumns: [conversations.id, conversations.pageId, conversations.tenantId],
    }),
    index('messages_conversation_sent_at_idx').on(t.conversationId, t.sentAt),
    index('messages_tenant_sent_at_idx').on(t.tenantId, t.sentAt),
  ],
);

/**
 * State dùng một lần cho luồng OAuth Facebook Login (chống CSRF và gắn lần kết nối với một tenant).
 * Chỉ lưu BĂM SHA-256 của state: lộ bảng này không cho phép dùng lại state.
 */
export const oauthStates = pgTable(
  'oauth_states',
  {
    id: id(),
    stateHash: text('state_hash').notNull().unique(),
    /**
     * Băm của nonce trong cookie của trình duyệt đầu tiên mở liên kết. State nằm trong URL (lịch sử
     * trình duyệt, Referer, log proxy) nên chỉ có state thôi chưa đủ: callback phải đến từ đúng
     * trình duyệt đã mở liên kết, nếu không người khác có state là gắn được Page của họ vào tenant.
     */
    nonceHash: text('nonce_hash'),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('oauth_states_tenant_idx').on(t.tenantId)],
);

export type Tenant = typeof tenants.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
