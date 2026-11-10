/** Kiểu dùng chung của Module 2 (trích xuất). Không có logic. */

/** Mọi trường có thể thành đề xuất (khớp enum `proposal_field` trong DB). */
export const ALL_FIELDS = [
  'customer_name',
  'phone',
  'address',
  'product_interest',
  'quantity',
  'budget',
  'timeline',
  'intent',
  'message_purpose',
] as const;
export type ProposalFieldName = (typeof ALL_FIELDS)[number];

/** Trường do mô hình trích. SĐT KHÔNG nằm trong đây: SĐT trích bằng code (`phone.ts`). */
export const MODEL_FIELDS = ['customer_name', 'address', 'product_interest', 'quantity', 'budget', 'timeline', 'intent', 'message_purpose'] as const;
export type ModelField = (typeof MODEL_FIELDS)[number];

/** Giao diện tự điền, hiện thẳng trên thẻ khách với nhãn "AI điền, chưa duyệt". */
export const LIGHT_FIELDS: readonly ProposalFieldName[] = ['customer_name', 'product_interest', 'budget', 'quantity'];
/** Phải qua Hộp đề xuất: Sale duyệt, sửa hoặc bỏ qua. */
export const REVIEW_FIELDS: readonly ProposalFieldName[] = ['phone', 'timeline', 'address'];
/** Tín hiệu nội bộ (tính P1), không hiện cho Sale như một mục cần duyệt. */
export const SIGNAL_FIELDS: readonly ProposalFieldName[] = ['intent', 'message_purpose'];

export const MESSAGE_PURPOSES = ['ask_price', 'ask_payment', 'buy_intent', 'schedule_visit', 'provide_contact', 'other'] as const;
export const INTENTS = ['browsing', 'interested', 'ready_to_buy'] as const;
/** Mục đích tin báo hiệu khách sắp mua (dùng tính P1). */
export const P1_PURPOSES: readonly string[] = ['ask_payment', 'buy_intent'];

/** Một tin đưa vào cho mô hình đọc. `id` là `messages.id` (UUID), khóa ổn định để tham chiếu. */
export interface ExtractorMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  sentAt: Date;
}

export interface ExtractorInput {
  /** Cũ nhất trước. Gồm cả tin của Page (chỉ làm ngữ cảnh, không bao giờ là câu gốc). */
  messages: ExtractorMessage[];
}

export interface Quote {
  messageId: string;
  quote: string;
}

/** Một trường mô hình đề xuất. `quotes` chưa được kiểm chứng: pipeline kiểm bằng code trước khi tin. */
export interface Candidate {
  field: ModelField;
  /** Giá trị đã chuẩn hóa, ngắn, tiếng Việt. */
  value: string;
  quotes: Quote[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export type ExtractorOutcome =
  | { kind: 'ok'; candidates: Candidate[]; usage: TokenUsage }
  | { kind: 'refused' | 'max_tokens' | 'invalid'; usage: TokenUsage };

export interface Extractor {
  /** Tên model ghi vào `extraction_runs.model`. */
  readonly model: string;
  /**
   * Lỗi tạm thời (mạng, 429, 5xx, timeout) thì NÉM lỗi để hàng đợi retry. Từ chối, hết token hoặc đầu ra
   * sai schema thì trả `kind` tương ứng (không ném).
   */
  extract(input: ExtractorInput): Promise<ExtractorOutcome>;
}

/** Giá trị lưu trong `proposals.value` và `profile_fields.value`. Luôn là object. */
export interface ProposalValue {
  text: string;
  /** Chỉ `timeline`: loại cụm thời gian. KHÔNG có ngày đã giải. */
  kind?: 'absolute' | 'relative' | 'vague';
  /** Chỉ `timeline`: lúc tin chứa cụm này được gửi (ISO), để Sale biết "cuối tuần này" tính từ khi nào. */
  sentAt?: string;
}

export interface Evidence {
  messageId: string;
  start: number;
  end: number;
  text: string;
}

export const NEEDS_CLARIFICATION = 'needs_clarification';

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
