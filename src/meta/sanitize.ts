/**
 * PostgreSQL không lưu được ký tự NUL (\u0000) trong text/jsonb. Payload chứa nó mà đi thẳng vào
 * pg-boss (jsonb) hay vào bảng messages sẽ lỗi mãi mãi: route trả 5xx, Meta thử lại 36 giờ rồi bỏ
 * (mất tin), hoặc cả batch tới 1000 sự kiện kẹt ở worker (poison message).
 */
export const NUL = '\u0000';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Bỏ mọi ký tự NUL khỏi chuỗi, khóa và giá trị lồng nhau. Không đổi các kiểu khác. */
export function stripNul(value: unknown): unknown {
  if (typeof value === 'string') return value.includes(NUL) ? value.replaceAll(NUL, '') : value;
  if (Array.isArray(value)) return value.map(stripNul);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [stripNul(k) as string, stripNul(v)]));
  }
  return value;
}

/**
 * `app_id` trong echo có thể là SỐ nguyên trong JSON. Số nguyên lớn hơn 2^53 (khoảng 9,0e15, tức từ 16 chữ
 * số) mất độ chính xác khi `JSON.parse`, khiến `app_id` không còn khớp `FB_APP_ID` hay `PAGE_INBOX_APP_IDS` và
 * tin của chính ta bị phân loại nhầm. Chuyển các giá trị `app_id` dài (16 chữ số trở lên) thành chuỗi TRƯỚC
 * khi parse. Chỉ áp dụng cho khóa `"app_id"` thật: trong nội dung tin nhắn, dấu nháy bị escape (`\"`) nên không khớp.
 */
export function quoteLargeAppIds(rawJson: string): string {
  return rawJson.replace(/("app_id"\s*:\s*)(\d{16,})/g, '$1"$2"');
}
