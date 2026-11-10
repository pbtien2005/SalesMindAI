/**
 * Mật khẩu và email. Băm bằng scrypt có sẵn trong node:crypto (không thêm thư viện).
 * Định dạng lưu: `scrypt$N$r$p$saltB64$hashB64`.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
// scrypt cần ~128*N*r byte (32 MiB với tham số trên); mặc định của Node là đúng 32 MiB nên phải nâng.
const MAXMEM = 128 * 1024 * 1024;

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128;

function derive(plain: string, salt: Buffer, N: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain.normalize('NFKC'), salt, keyLength, { N, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(plain, salt, PARAMS.N, PARAMS.r, PARAMS.p, KEY_LENGTH);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

interface Parsed {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parse(stored: string): Parsed | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 2 ** 20 || r > 32 || p > 8) return null;
  const b64 = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!b64.test(parts[4]!) || !b64.test(parts[5]!)) return null;
  const salt = Buffer.from(parts[4]!, 'base64');
  const key = Buffer.from(parts[5]!, 'base64');
  if (salt.length === 0 || key.length === 0) return null;
  return { N, r, p, salt, key };
}

/** Chuỗi hỏng hoặc sai mật khẩu đều trả false, không ném. So sánh thời gian cố định. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  try {
    const key = await derive(plain, parsed.salt, parsed.N, parsed.r, parsed.p, parsed.key.length);
    return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
  } catch {
    return false;
  }
}

/** Đúng khi băm đã lưu dùng tham số yếu hơn hiện hành (hoặc hỏng): nên băm lại khi người dùng đăng nhập. */
export function needsRehash(stored: string): boolean {
  const p = parse(stored);
  return !p || p.N < PARAMS.N || p.r < PARAMS.r || p.p < PARAMS.p;
}

/** Trả thông báo lỗi (tiếng Việt) hoặc null nếu hợp lệ. */
export function validatePassword(plain: string, email: string): string | null {
  if (plain.length < MIN_PASSWORD) return `Mật khẩu phải có ít nhất ${MIN_PASSWORD} ký tự.`;
  if (plain.length > MAX_PASSWORD) return `Mật khẩu tối đa ${MAX_PASSWORD} ký tự.`;
  if (plain.toLowerCase() === email.toLowerCase()) return 'Mật khẩu không được trùng email.';
  return null;
}

/** Chuẩn hóa email (NFC, trim, chữ thường). Trả null nếu không hợp lệ. */
export function normalizeEmail(raw: string): string | null {
  const e = raw.normalize('NFC').trim().toLowerCase();
  if (e.length === 0 || e.length > 254) return null;
  if (/\s/.test(e)) return null;
  const at = e.indexOf('@');
  if (at <= 0 || at !== e.lastIndexOf('@') || at === e.length - 1) return null;
  return e;
}
