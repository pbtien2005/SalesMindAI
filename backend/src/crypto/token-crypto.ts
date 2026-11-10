import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Mã hóa Page token bằng AES-256-GCM.
 *
 * Định dạng lưu: `v1:<iv>:<tag>:<ciphertext>` (ba phần sau là base64).
 * - `v1` là số phiên bản, dành cho việc xoay khóa hoặc đổi thuật toán sau này.
 * - IV 12 byte ngẫu nhiên cho mỗi lần mã hóa (không bao giờ dùng lại với cùng khóa).
 * - AAD gắn ciphertext với một định danh (ở đây là ID Page): chép ciphertext của Page A
 *   sang dòng của Page B thì giải mã sẽ thất bại.
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Lỗi mã hóa. Thông báo không chứa khóa, token hay ciphertext. */
export class TokenCryptoError extends Error {
  override readonly name = 'TokenCryptoError';
}

export interface TokenCrypto {
  encrypt(plaintext: string, aad: string): string;
  decrypt(payload: string, aad: string): string;
}

// 32 byte = 43 ký tự base64 chuẩn + 1 ký tự đệm "=". Buffer.from(..., 'base64') quá dễ dãi
// (bỏ qua ký tự lạ, nhận cả base64url), nên kiểm tra chặt bằng regex trước.
const KEY_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

/** Giải mã khóa base64 chuẩn thành đúng 32 byte; sai dạng thì ném TokenCryptoError. */
export function parseKey(keyBase64: string): Buffer {
  if (!KEY_BASE64.test(keyBase64)) {
    throw new TokenCryptoError(`Khóa phải là base64 chuẩn của đúng ${KEY_BYTES} byte.`);
  }
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new TokenCryptoError(`Khóa phải là base64 chuẩn của đúng ${KEY_BYTES} byte.`);
  }
  return key;
}

/** Tạo bộ mã hóa từ khóa base64 (đúng 32 byte sau khi giải mã). */
export function createTokenCrypto(keyBase64: string): TokenCrypto {
  const key = parseKey(keyBase64);

  return {
    encrypt(plaintext, aad) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
    },

    decrypt(payload, aad) {
      const parts = payload.split(':');
      if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new TokenCryptoError('Định dạng dữ liệu mã hóa không hợp lệ.');
      }
      const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
      const iv = Buffer.from(ivB64, 'base64');
      const tag = Buffer.from(tagB64, 'base64');
      const ciphertext = Buffer.from(ctB64, 'base64');
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
        throw new TokenCryptoError('Định dạng dữ liệu mã hóa không hợp lệ.');
      }
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(Buffer.from(aad, 'utf8'));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        // Không chuyển tiếp lỗi gốc để khỏi lộ chi tiết; sai khóa, sai AAD hay bị sửa đều như nhau.
        throw new TokenCryptoError('Giải mã thất bại (sai khóa, sai ngữ cảnh hoặc dữ liệu bị sửa).');
      }
    },
  };
}
