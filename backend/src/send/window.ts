/**
 * Cửa sổ trả lời của Messenger: chỉ được gửi tin `RESPONSE` trong 24 giờ kể từ hành động cuối của KHÁCH
 * (`conversations.last_user_interaction_at`). Hằng số này chỉ nằm ở đây; Module 1 cố ý không hard-code quy tắc cửa sổ.
 * Quy tắc cụ thể (24 giờ, những hành động nào mở lại cửa sổ) lấy từ tài liệu Meta và CHƯA kiểm chứng bằng Page thật.
 */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function sendWindow(lastUserInteractionAt: Date | null, now: Date): { open: boolean; closesAt: Date | null } {
  if (!lastUserInteractionAt) return { open: false, closesAt: null };
  const closesAt = new Date(lastUserInteractionAt.getTime() + REPLY_WINDOW_MS);
  return { open: now.getTime() < closesAt.getTime(), closesAt };
}
