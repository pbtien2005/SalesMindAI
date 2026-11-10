/**
 * Kiểu dữ liệu của API demo, chép tay từ backend (không import chéo package):
 * `backend/src/followup/overview.ts`, `backend/src/api/read-models.ts`, `backend/src/extraction/types.ts`,
 * `backend/src/extraction/proposals.ts`. Mọi thời điểm là chuỗi ISO (JSON hóa từ Date).
 */

/** Vai trò trong doanh nghiệp. */
export type Role = 'owner' | 'manager' | 'sale';

export interface Me {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  tenantId: string;
  emailVerified: boolean;
  /** Thuộc doanh nghiệp demo (chỉ khi server bật DEMO_MODE): có đồng hồ tua, Bảng Giả lập, Đặt lại demo. */
  demoTenant: boolean;
}

export interface AuthConfig {
  signupOpen: boolean;
  /** Server bật DEMO_MODE: có nút vào nhanh bằng tài khoản Lan hoặc chị Hà. */
  demoLogin: boolean;
}

export interface FollowupStatus {
  count: number;
  max: number;
  /** Sale đã quyết định ngừng bám. */
  stopped: boolean;
  /** Đủ max/max mà chưa ngừng: hệ thống chỉ ĐỀ XUẤT, Sale xác nhận. */
  suggestStop: boolean;
}

export interface ConversationSummary {
  id: string;
  pageId: string;
  pageName: string;
  displayName: string;
  lastMessageAt: string | null;
  lastMessageText: string | null;
  /** `page` = khách đang chờ Page trả lời; `customer` = Page đã nhắn, chờ khách. */
  waitingOn: 'page' | 'customer' | null;
  waitingMinutes: number | null;
  followup: FollowupStatus;
  isP1: boolean;
  /** Khách nhắn nhưng Page chưa từng trả lời. */
  isNew: boolean;
}

export type ReminderKind = 'overdue' | 'followup' | 'upcoming';

export interface Reminder {
  kind: ReminderKind;
  conversationId: string;
  displayName: string;
  title: string;
  dueAt: string | null;
}

export interface OverdueTask {
  taskId: string;
  conversationId: string;
  displayName: string;
  title: string;
  dueAt: string;
}

export interface AiStats {
  autoFilled: number;
  saleEdited: number;
  askedDate: number;
  approved: number;
}

export interface HomeData {
  now: string;
  p1: ConversationSummary[];
  overdue: OverdueTask[];
  reminders: Reminder[];
  suggestStop: ConversationSummary[];
  ai: AiStats;
  role: Role;
}

/** Giá trị đề xuất. `timeline` không bao giờ có ngày đã giải, chỉ có chữ của khách. */
export interface ProposalValue {
  text: string;
  kind?: 'absolute' | 'relative' | 'vague';
  /** Chỉ `timeline`: lúc tin chứa cụm này được gửi. */
  sentAt?: string;
}

/** `start`/`end` tính theo đơn vị UTF-16 của văn bản tin, dùng được với `String.slice`. */
export interface Evidence {
  messageId: string;
  start: number;
  end: number;
  text: string;
}

export interface MessageView {
  id: string;
  direction: 'inbound' | 'outbound';
  senderKind: string;
  text: string | null;
  hasAttachment: boolean;
  sentAt: string;
}

export interface ProposalView {
  id: string;
  field: string;
  value: ProposalValue;
  evidence: Evidence[];
  flags: string[];
  createdAt: string;
}

export interface ApprovedView {
  field: string;
  value: ProposalValue & { chosenAt?: string };
  version: number;
  updatedAt: string;
  decidedBy: string | null;
  /** `accepted` hoặc `edited`. */
  status: string | null;
}

export type BoxItem =
  | ({ kind: 'proposal' } & ProposalView)
  | { kind: 'stop_followup'; reason: string; count: number; max: number };

export interface ConversationDetail {
  summary: ConversationSummary;
  /** Có gửi tin được cho khách này không (cửa sổ 24 giờ và trạng thái Page). */
  reply: { open: boolean; closesAt: string | null; pageActive: boolean };
  messages: MessageView[];
  approved: ApprovedView[];
  autoFill: ProposalView[];
  box: BoxItem[];
  tasks: Array<{ id: string; title: string; dueAt: string; source: string }>;
}

export interface HistoryEntry {
  kind: 'proposal' | 'stop_followup';
  field: string | null;
  proposedValue: ProposalValue | null;
  decidedValue: unknown;
  status: string;
  decidedBy: string | null;
  at: string;
  evidence: Evidence[];
}

export type DecideAction = 'accept' | 'edit' | 'dismiss';

export interface DecideBody {
  action: DecideAction;
  editedText?: string;
  /** ISO 8601 có múi giờ, ví dụ `2026-11-14T10:00:00+07:00`. Bắt buộc với `timeline` có cờ `needs_clarification`. */
  chosenAt?: string;
}

export interface DecideResult {
  proposalId: string;
  field: string;
  status: string;
  value?: unknown;
  taskId?: string;
}

export interface Persona {
  key: string;
  displayName: string;
}

export const NEEDS_CLARIFICATION = 'needs_clarification';

export interface TeamMember {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
}
export interface TeamInvite {
  id: string;
  email: string | null;
  role: Role;
  expiresAt: string;
}
export interface TeamData {
  members: TeamMember[];
  invites: TeamInvite[];
  /** ID của người đang xem. */
  me: string;
}
export interface InviteInfo {
  tenantName: string;
  role: Role;
  email: string | null;
}

export interface PageView {
  id: string;
  fbPageId: string;
  name: string;
  status: 'active' | 'token_invalid' | 'disconnected';
  webhookSubscribed: boolean;
  conversations: number;
  lastMessageAt: string | null;
  connectedBy: string | null;
}
export interface PagesData {
  pages: PageView[];
  aiEnabled: boolean;
  /** Máy chủ đã có FB_APP_ID và APP_SECRET thật. */
  facebookConfigured: boolean;
}
