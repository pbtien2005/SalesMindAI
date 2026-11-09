import { z } from 'zod';

/** Khóa AES-256-GCM: base64 giải ra đúng 32 byte. */
const tokenEncKey = z
  .string()
  .min(1)
  .refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'TOKEN_ENC_KEY phải là base64 của đúng 32 byte',
  });

const envSchema = z.object({
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
