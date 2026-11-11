import { z } from 'zod';
import { parseKey } from '../crypto/token-crypto.js';
import { DEFAULT_PAGE_INBOX_APP_IDS } from '../meta/sender-kind.js';

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
  /**
   * `app_id` của Page Inbox (tin nhân viên gõ tay), cách nhau bằng dấu phẩy. Bỏ trống: dùng giá trị mặc định
   * (cả dạng 14 và 15 chữ số, vì tài liệu Meta và thực tế chưa thống nhất). Điền giá trị thật sau khi xem một echo thật.
   */
  PAGE_INBOX_APP_IDS: z
    .string()
    .optional()
    .transform((v) => {
      const ids = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      return ids.length > 0 ? ids : [...DEFAULT_PAGE_INBOX_APP_IDS];
    })
    .refine((ids) => ids.every((id) => /^\d{5,20}$/.test(id)), 'PAGE_INBOX_APP_IDS chỉ gồm các ID dạng số, cách nhau bằng dấu phẩy'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /**
   * Tin các header X-Forwarded-* (cần khi chạy sau proxy, tunnel hoặc load balancer để biết IP thật của
   * client). Chỉ bật khi thật sự có proxy phía trước: nếu không, client có thể giả IP để né giới hạn tốc độ.
   */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Chế độ trích xuất AI. `offline` (mặc định): luật tất định, không gọi mạng. `live`: gọi Claude, cần
   * `ANTHROPIC_API_KEY` và gửi nội dung chat ra API nước ngoài, nên PHẢI đặt tường minh (không tự bật khi có khóa).
   */
  AI_MODE: z.enum(['offline', 'live']).default('offline'),
  // `KEY=` rỗng nghĩa là "không đặt".
  ANTHROPIC_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  AI_MODEL: z.string().min(1).default('claude-haiku-5-5'),
  /** Chờ bấy nhiêu giây sau tin khách mới nhất rồi mới trích (gom nhiều tin liên tiếp). Demo đặt 3. */
  AI_DEBOUNCE_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),
  /** Số lời gọi AI tối đa mỗi doanh nghiệp mỗi ngày (giờ Việt Nam). Chỉ áp dụng khi AI_MODE=live. Doanh nghiệp có thể có hạn mức riêng. */
  AI_DAILY_CAP: z.coerce.number().int().min(0).max(1_000_000).default(500),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  /** Thư mục ảnh demo (bill mẫu). Mặc định: `backend/demo-assets`. */
  BILL_ASSET_DIR: z.string().min(1).optional(),
  /** Số tin gần nhất (cả hai chiều) đưa cho AI đọc. */
  AI_CONTEXT_MESSAGES: z.coerce.number().int().min(1).max(200).default(30),

  /** Thư mục bản build của giao diện (`npm run build` trong web/). Bỏ trống: `../web/dist` so với thư mục chạy. Không có thư mục thì không phục vụ giao diện. */
  WEB_DIST_DIR: z.string().trim().optional().transform((v) => (v ? v : undefined)),
  /** Địa chỉ nghe. Bỏ trống: 127.0.0.1 khi DEMO_MODE, ngược lại 0.0.0.0. */
  HOST: z.string().trim().optional().transform((v) => (v ? v : undefined)),
  /** Đăng ký tự do (`open`) hay chỉ tạo tài khoản bằng CLI và lời mời (`closed`, mặc định). */
  SIGNUP_MODE: z.enum(['open', 'closed']).default('closed'),
  /** Phiên hết hạn sau bấy nhiêu ngày không dùng, và tối đa bấy nhiêu ngày kể từ lúc đăng nhập. */
  SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /**
   * Bật API demo (`/api/*`), đồng hồ tua được và công cụ giả lập. KHÔNG có đăng nhập: chỉ để chạy demo trên máy
   * của bạn. Bị từ chối khi NODE_ENV=production.
   */
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const envSchemaChecked = envSchema.superRefine((v, ctx) => {
  if (v.DEMO_MODE && v.NODE_ENV === 'production') {
    ctx.addIssue({ code: 'custom', path: ['DEMO_MODE'], message: 'DEMO_MODE=true không được dùng cùng NODE_ENV=production (API demo không có đăng nhập)' });
  }
  if (v.AI_MODE === 'live' && !v.ANTHROPIC_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'AI_MODE=live cần ANTHROPIC_API_KEY' });
  }
});

export type Env = z.infer<typeof envSchema>;

/** Đọc và kiểm tra cấu hình. Thiếu hoặc sai thì ném lỗi, không in giá trị bí mật. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchemaChecked.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Cấu hình .env không hợp lệ:\n${problems}`);
  }
  return result.data;
}
