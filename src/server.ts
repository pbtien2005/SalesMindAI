import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { createBoss, createWebhookQueue, startWebhookWorker } from './queue/boss.js';
import { processWebhookPayload } from './workers/process-webhook.js';

const env = loadEnv();

const dbHandle = createDb(env.DATABASE_URL);
const boss = await createBoss(env.DATABASE_URL);

const app = buildApp(
  { logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' } },
  {
    appSecret: env.APP_SECRET,
    verifyToken: env.VERIFY_TOKEN,
    queue: createWebhookQueue(boss),
  },
);

/**
 * Tắt nhẹ nhàng: ngừng nhận request, để job đang chạy xong, rồi đóng kết nối.
 * Dùng cho cả tín hiệu SIGTERM/SIGINT và lỗi khởi động, để không bao giờ thoát mà bỏ dở job.
 */
let shuttingDown = false;
async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ reason }, 'đang tắt server');
  try {
    await app.close();
    await boss.stop({ graceful: true, timeout: 20_000 });
    await dbHandle.close();
    process.exit(exitCode);
  } catch (err) {
    app.log.error({ err }, 'lỗi khi tắt server');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
process.on('SIGINT', () => void shutdown('SIGINT', 0));

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error({ err }, 'không mở được cổng');
  await shutdown('lỗi khởi động', 1);
}

// Chỉ bắt đầu xử lý job sau khi server đã nhận request được.
await startWebhookWorker(boss, async (data) => {
  await processWebhookPayload(dbHandle.db, data.payload, app.log);
});
