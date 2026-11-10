import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_FORMAT = /^sha256=([0-9a-fA-F]{64})$/;

/**
 * Kiểm tra `X-Hub-Signature-256` của Meta: `sha256=` + HMAC-SHA256(raw body, APP_SECRET) dạng hex.
 *
 * - Phải tính trên đúng các byte thô của body (không phải JSON đã parse lại).
 * - So sánh timing-safe. Header sai dạng thì trả false ngay (không có bí mật nào để lộ ở đó).
 */
export function verifySignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (typeof header !== 'string') return false;
  const match = SIGNATURE_FORMAT.exec(header);
  if (!match) return false;
  const provided = Buffer.from(match[1]!, 'hex'); // luôn 32 byte nhờ regex
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return timingSafeEqual(provided, expected);
}

/** So sánh chuỗi bí mật (ví dụ VERIFY_TOKEN) không lộ độ dài hay vị trí khác biệt qua thời gian. */
export function safeEqual(a: string, b: string): boolean {
  // Băm trước để hai bên luôn cùng độ dài, timingSafeEqual không ném lỗi và không lộ độ dài.
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
