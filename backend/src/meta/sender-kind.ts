export type SenderKind = 'customer' | 'page_app' | 'page_inbox' | 'page_other' | 'page_unknown';

/**
 * `app_id` của Page Inbox (tin nhân viên gõ tay trong hộp thư của Page).
 * Tài liệu Meta ghi `26390203743090` (14 chữ số), giá trị thường dùng là `263902037430900` (15 chữ số):
 * có thể tài liệu gõ sai. CHƯA xác minh bằng echo thật nên mặc định chấp nhận cả hai; ghi đè bằng
 * `PAGE_INBOX_APP_IDS` khi đã biết giá trị thật.
 */
export const DEFAULT_PAGE_INBOX_APP_IDS: readonly string[] = ['263902037430900', '26390203743090'];

export interface SenderKindConfig {
  /** `FB_APP_ID`: tin có `app_id` này là do chính app của ta gửi. */
  ownAppId: string;
  pageInboxAppIds: readonly string[];
}

/**
 * Phân loại một tin do PAGE gửi theo `app_id` của echo:
 * - không có `app_id`: `page_unknown` (ví dụ tin lấy qua backfill);
 * - app của ta: `page_app` (tin gửi từ SalesMind; khử trùng với `message_id` của Send API theo `mid`);
 * - Page Inbox: `page_inbox` (người gõ tay);
 * - còn lại: `page_other` (bot hoặc app khác).
 * Business Suite và app Pages trên điện thoại chưa được tài liệu nhắc tới nên có thể rơi vào `page_other`
 * cho tới khi biết `app_id` thật của chúng.
 */
export function classifyPageSender(appId: string | null, cfg: SenderKindConfig): Exclude<SenderKind, 'customer'> {
  if (appId === null || appId === '') return 'page_unknown';
  if (appId === cfg.ownAppId) return 'page_app';
  if (cfg.pageInboxAppIds.includes(appId)) return 'page_inbox';
  return 'page_other';
}
