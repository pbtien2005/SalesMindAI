import { z } from 'zod';
import { parseKey } from '../crypto/token-crypto.js';

/** Khóa AES-256-GCM: base64 chuẩn của đúng 32 byte (kiểm tra chặt, dùng chung với token-crypto). */
const tokenEncKey = z.string().refine(
  (v) => {
    try {
      parseKey(v);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'TOKEN_ENC_KEY phải là base64 chuẩn của đúng 32 byte' },
);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** URL gốc công khai: không có dấu / cuối, không query hay fragment (để ghép đường dẫn an toàn). */
const publicBaseUrl = z
  .string()
  .url()
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'https:' || LOOPBACK_HOSTS.has(u.hostname)) && u.pathname === '/' && !u.search && !u.hash && !v.endsWith('/');
    } catch {
      return false;
    }
  }, 'PUBLIC_BASE_URL phải là https (hoặc http://localhost, http://127.0.0.1), không có dấu / ở cuối, không có đường dẫn hay query');

const envSchema = z.object({
  FB_APP_ID: z.string().min(1),
  /** Tùy chọn: ID cấu hình Facebook Login for Business. Bỏ trống thì dùng tham số `scope`. */
  // `KEY=` rỗng trong .env được hiểu là "không đặt" (không báo lỗi).
  FB_LOGIN_CONFIG_ID: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  PUBLIC_BASE_URL: publicBaseUrl,
  APP_SECRET: z.string().min(1),
  VERIFY_TOKEN: z.string().min(1),
  TOKEN_ENC_KEY: tokenEncKey,
  GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/, 'Dạng đúng: v23.0'),
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

/** Đọc và kiểm tra cấu hình. Thiếu hoặc sai thì ném lỗi, không in giá trị bí mật. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Cấu hình .env không hợp lệ:\n${problems}`);
  }
  return result.data;
}
