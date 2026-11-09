import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// PostgreSQL 18 có uuidv7() sẵn: khóa chính theo thời gian, thân thiện với index.
const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const pageStatus = pgEnum('page_status', ['active', 'token_invalid']);
export const messageSource = pgEnum('message_source', ['webhook', 'backfill']);
/** Hướng của tin: từ khách tới Page, hay từ Page tới khách (echo, hoặc tin Page gửi lấy qua backfill). */
export const messageDirection = pgEnum('message_direction', ['inbound', 'outbound']);
/**
 * Ai gửi. `customer`: khách. Với tin của Page, dựa vào `app_id` trong echo:
 * `page_app` (app của ta), `page_inbox` (người gõ tay ở Page Inbox), `page_other` (bot hoặc app khác),
 * `page_unknown` (không có app_id, ví dụ tin lấy qua backfill).
 */
export const senderKind = pgEnum('sender_kind', ['customer', 'page_app', 'page_inbox', 'page_other', 'page_unknown']);

/** Trường AI có thể đề xuất (Module 2). */
export const proposalField = pgEnum('proposal_field', [
  'customer_name',
  'phone',
  'address',
  'product_interest',
  'quantity',
  'budget',
  'timeline',
  'intent',
  'message_purpose',
]);
/** `pending` chờ Sale; `accepted` duyệt nguyên văn; `edited` Sale sửa rồi duyệt; `dismissed` bỏ qua; `superseded` bị đề xuất mới thay. */
export const proposalStatus = pgEnum('proposal_status', ['pending', 'accepted', 'edited', 'dismissed', 'superseded']);
export const extractionRunStatus = pgEnum('extraction_run_status', ['succeeded', 'failed', 'skipped']);

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  /** AI trích xuất bật theo từng tenant, mặc định TẮT (xem CLAUDE.md: kiểm tra pháp lý trước khi bật cho khách thật). */
  aiExtractionEnabled: boolean('ai_extraction_enabled').notNull().default(false),
  aiEnabledAt: timestamp('ai_enabled_at', { withTimezone: true }),
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
    /** Tên hiển thị trong giao diện (webhook Messenger không kèm tên). Chỉ do demo hoặc nhân viên đặt. */
    displayName: text('display_name'),
    /** Thời điểm tin mới nhất theo sent_at, mọi hướng. Cập nhật bằng GREATEST() nên tin đến sai thứ tự không làm lùi. */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    /**
     * Lần cuối KHÁCH có hành động mở cửa sổ nhắn tin: gửi tin, bấm nút (postback), thả cảm xúc,
     * vào qua link m.me có ref (referral). Tin của Page không tính. Không hard-code cửa sổ 24 giờ ở đây:
     * quy tắc cửa sổ do module gửi tin quyết định (báo cáo nghiên cứu: chưa xác minh hết).
     */
    lastUserInteractionAt: timestamp('last_user_interaction_at', { withTimezone: true }),
    /** Lần cuối PAGE gửi tin (echo hoặc backfill), kể cả tin do nhân viên gõ ở Page Inbox. */
    lastPageMessageAt: timestamp('last_page_message_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('conversations_page_psid_unique').on(t.pageId, t.psid),
    unique('conversations_id_page_tenant_unique').on(t.id, t.pageId, t.tenantId),
    unique('conversations_id_tenant_unique').on(t.id, t.tenantId),
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
    /** `message.mid` của Meta: khóa khử trùng (idempotent). Khóa ổn định để tham chiếu tin là `id` (UUID), không phải `mid`. */
    mid: text('mid').notNull().unique(),
    direction: messageDirection('direction').notNull().default('inbound'),
    senderKind: senderKind('sender_kind').notNull().default('customer'),
    /** `message.app_id` của echo: app đã gửi tin. Null với tin của khách và tin lấy qua backfill. */
    appId: text('app_id'),
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
 * Cảnh báo hoặc khóa từ Meta về việc Page gửi tin (webhook `messaging_policy_enforcement`).
 * `action`: warning, block hoặc unblock (tài liệu Meta); lưu dạng text để không vỡ nếu Meta thêm giá trị.
 */
export const pagePolicyEvents = pgTable(
  'page_policy_events',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    pageId: uuid('page_id').notNull(),
    action: text('action').notNull(),
    /** Lý do do Meta nêu; vắng khi `unblock`. */
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Meta có thể gửi lại cùng một sự kiện: khử trùng theo (Page, thời điểm, hành động).
    unique('page_policy_events_dedupe').on(t.pageId, t.occurredAt, t.action),
    foreignKey({
      name: 'page_policy_events_page_tenant_fk',
      columns: [t.pageId, t.tenantId],
      foreignColumns: [pages.id, pages.tenantId],
    }),
    index('page_policy_events_tenant_idx').on(t.tenantId, t.occurredAt),
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

/** Một lần AI đọc một hội thoại. UNIQUE (hội thoại, tin cuối, phiên bản prompt) là khóa idempotency. */
export const extractionRuns = pgTable(
  'extraction_runs',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    /** Tin của khách mới nhất đã được đọc. */
    upToMessageId: uuid('up_to_message_id')
      .notNull()
      .references(() => messages.id),
    promptVersion: text('prompt_version').notNull(),
    model: text('model').notNull(),
    status: extractionRunStatus('status').notNull(),
    /** `refusal` | `max_tokens` | `invalid_output` | `provider_error`; chỉ có khi status = failed. */
    failureReason: text('failure_reason'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    fieldsProposed: integer('fields_proposed').notNull().default(0),
    /** Số trường bị loại vì câu gốc không kiểm chứng được. */
    fieldsRejected: integer('fields_rejected').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('extraction_runs_idempotency').on(t.conversationId, t.upToMessageId, t.promptVersion),
    unique('extraction_runs_id_tenant_unique').on(t.id, t.tenantId),
    foreignKey({
      name: 'extraction_runs_conversation_tenant_fk',
      columns: [t.conversationId, t.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    }),
    index('extraction_runs_conversation_idx').on(t.conversationId, t.createdAt),
  ],
);

/**
 * Đề xuất của AI. `evidence` là chuỗi con ĐÃ KIỂM CHỨNG trong tin khách đã lưu
 * (`[{ messageId, start, end, text }]`), không phải chuỗi do mô hình viết ra.
 * Mỗi (hội thoại, trường) chỉ có một đề xuất `pending`.
 */
export const proposals = pgTable(
  'proposals',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    runId: uuid('run_id').notNull(),
    field: proposalField('field').notNull(),
    value: jsonb('value').notNull(),
    evidence: jsonb('evidence').notNull().default(sql`'[]'::jsonb`),
    /** Ví dụ `needs_clarification` (mốc thời gian mơ hồ: Sale phải chọn ngày). */
    flags: text('flags').array().notNull().default(sql`'{}'::text[]`),
    status: proposalStatus('status').notNull().default('pending'),
    decidedValue: jsonb('decided_value'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('proposals_one_pending_per_field')
      .on(t.conversationId, t.field)
      .where(sql`${t.status} = 'pending'`),
    unique('proposals_id_tenant_unique').on(t.id, t.tenantId),
    foreignKey({
      name: 'proposals_conversation_tenant_fk',
      columns: [t.conversationId, t.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    }),
    foreignKey({
      name: 'proposals_run_tenant_fk',
      columns: [t.runId, t.tenantId],
      foreignColumns: [extractionRuns.id, extractionRuns.tenantId],
    }),
    index('proposals_conversation_idx').on(t.conversationId, t.status),
    index('proposals_tenant_status_idx').on(t.tenantId, t.status),
  ],
);

/** Dữ liệu ĐÃ DUYỆT. Chỉ code duyệt đề xuất mới được ghi vào đây. */
export const profileFields = pgTable(
  'profile_fields',
  {
    conversationId: uuid('conversation_id').notNull(),
    field: proposalField('field').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    value: jsonb('value').notNull(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.field] }),
    foreignKey({
      name: 'profile_fields_conversation_tenant_fk',
      columns: [t.conversationId, t.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    }),
  ],
);

/** Việc cần làm của Sale (gọi lại, nhắc thanh toán, khách hẹn ghé...). `source`: seed, appointment, manual. */
export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    title: text('title').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    doneAt: timestamp('done_at', { withTimezone: true }),
    source: text('source').notNull().default('manual'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'tasks_conversation_tenant_fk',
      columns: [t.conversationId, t.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    }),
    index('tasks_tenant_due_idx').on(t.tenantId, t.dueAt),
  ],
);

/** Quyết định NGỪNG BÁM của Sale. Số lần bám tính khi đọc từ mốc thời gian của hội thoại, không lưu. */
export const followupState = pgTable(
  'followup_state',
  {
    conversationId: uuid('conversation_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }).notNull(),
    stoppedBy: text('stopped_by').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'followup_state_conversation_tenant_fk',
      columns: [t.conversationId, t.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    }),
  ],
);

/** Đồng hồ demo: một dòng, `now = giờ thật + offset_ms`. Chỉ được dùng khi DEMO_MODE=true. */
export const demoClock = pgTable('demo_clock', {
  id: integer('id').primaryKey().default(1),
  offsetMs: bigint('offset_ms', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type ExtractionRun = typeof extractionRuns.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type ProfileField = typeof profileFields.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type PagePolicyEvent = typeof pagePolicyEvents.$inferSelect;
