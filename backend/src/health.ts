import type { FastifyPluginAsync } from 'fastify';

export interface ReadinessCheck {
  name: string;
  /** Ném lỗi (hoặc reject) nếu thành phần chưa sẵn sàng. */
  check: () => Promise<unknown>;
}

export interface HealthOptions {
  readiness?: ReadinessCheck[];
  /** Mỗi kiểm tra tối đa bao lâu. Mặc định 2 giây. */
  checkTimeoutMs?: number;
}

async function runCheck(c: ReadinessCheck, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      c.check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `/healthz` (liveness): tiến trình còn sống, KHÔNG phụ thuộc DB, để orchestrator không khởi động lại
 * vô ích khi DB tạm lỗi. `/readyz` (readiness): các thành phần cần thiết đã sẵn sàng; 503 nếu không.
 * Phản hồi chỉ nêu tên thành phần lỗi, không kèm chi tiết lỗi (có thể chứa địa chỉ, mật khẩu...).
 */
export const healthRoutes: FastifyPluginAsync<HealthOptions> = async (app, opts) => {
  const checks = opts.readiness ?? [];
  const timeoutMs = opts.checkTimeoutMs ?? 2000;

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_req, reply) => {
    const results = await Promise.all(checks.map(async (c) => [c.name, await runCheck(c, timeoutMs)] as const));
    const failed = results.filter(([, ok]) => !ok).map(([name]) => name);
    const checksOut = Object.fromEntries(results.map(([name, ok]) => [name, ok ? 'ok' : 'fail']));
    if (failed.length > 0) {
      return reply.code(503).header('cache-control', 'no-store').send({ status: 'not_ready', checks: checksOut });
    }
    return reply.header('cache-control', 'no-store').send({ status: 'ready', checks: checksOut });
  });
};
