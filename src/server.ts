import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createTokenCrypto } from './crypto/token-crypto.js';
import { createDb } from './db/client.js';
import { GraphClient } from './meta/graph-client.js';
import { handleBackfillConversation, handleBackfillPage, type BackfillDeps } from './backfill/backfill.js';
import {
  createBackfillQueue,
  createBoss,
  createWebhookQueue,
  startBackfillWorkers,
  startWebhookWorker,
  WEBHOOK_QUEUE,
} from './queue/boss.js';
import { assertQueueExists } from './queue/admin.js';
import { startQueueMonitor } from './queue/monitor.js';
import { processWebhookPayload } from './workers/process-webhook.js';

const env = loadEnv();

const dbHandle = createDb(env.DATABASE_URL);
const boss = await createBoss(env.DATABASE_URL);

const graph = new GraphClient({
  apiVersion: env.GRAPH_API_VERSION,
  appId: env.FB_APP_ID,
  appSecret: env.APP_SECRET,
  ...(env.FB_LOGIN_CONFIG_ID ? { loginConfigId: env.FB_LOGIN_CONFIG_ID } : {}),
});
const crypto = createTokenCrypto(env.TOKEN_ENC_KEY);

const app = buildApp(
  {
    logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    // Chỉ tin X-Forwarded-* khi có proxy phía trước (xem TRUST_PROXY trong .env.example).
    trustProxy: env.TRUST_PROXY,
  },
  {
    readiness: [
      { name: 'db', check: () => dbHandle.pool.query('select 1') },
      { name: 'queue', check: () => assertQueueExists(boss, WEBHOOK_QUEUE) },
    ],
    appSecret: env.APP_SECRET,
    verifyToken: env.VERIFY_TOKEN,
    queue: createWebhookQueue(boss),
    oauth: {
      db: dbHandle.db,
      graph,
      crypto,
      publicBaseUrl: env.PUBLIC_BASE_URL,
    },
  },
);

/**
 * Tắt nhẹ nhàng: ngừng nhận request, để job đang chạy xong, rồi đóng kết nối.
 * Dùng cho cả tín hiệu SIGTERM/SIGINT và lỗi khởi động, để không bao giờ thoát mà bỏ dở job.
 */
let stopMonitor: (() => Promise<void>) | undefined;
let shuttingDown = false;
async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ reason }, 'đang tắt server');
  try {
    await stopMonitor?.(); // chờ lượt đọc số liệu đang chạy trước khi đóng pg-boss
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

const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.PUBLIC_BASE_URL).hostname);
if (!loopback && !env.TRUST_PROXY) {
  app.log.info('Nếu server chạy sau proxy, tunnel hoặc load balancer, hãy đặt TRUST_PROXY=true để giới hạn tốc độ tính theo IP thật của từng client (nếu không, mọi client chung một giới hạn).');
}

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

const backfillDeps: BackfillDeps = {
  db: dbHandle.db,
  graph,
  crypto,
  queue: createBackfillQueue(boss),
  log: app.log,
};
stopMonitor = startQueueMonitor(boss, app.log);

await startBackfillWorkers(boss, {
  page: (job) => handleBackfillPage(backfillDeps, job),
  conversation: async (job) => void (await handleBackfillConversation(backfillDeps, job)),
});
