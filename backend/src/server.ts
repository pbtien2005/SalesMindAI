import { ConsoleMailer, UnavailableMailer } from './auth/mailer.js';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createTokenCrypto } from './crypto/token-crypto.js';
import { createDb } from './db/client.js';
import { GraphClient } from './meta/graph-client.js';
import { handleBackfillConversation, handleBackfillPage, type BackfillDeps } from './backfill/backfill.js';
import { createExtractor } from './extraction/factory.js';
import { runExtraction } from './extraction/run.js';
import { enqueueExtractions, startSweeper } from './extraction/schedule.js';
import {
  createBackfillQueue,
  createBoss,
  createExtractQueue,
  createWebhookQueue,
  startBackfillWorkers,
  startExtractWorker,
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
    auth: {
      db: dbHandle.db,
      mailer: env.NODE_ENV === 'production' ? new UnavailableMailer() : new ConsoleMailer((m) => app.log.info(m)),
      signupOpen: env.SIGNUP_MODE === 'open',
      demoMode: env.DEMO_MODE,
      publicBaseUrl: env.PUBLIC_BASE_URL,
      session: { idleDays: env.SESSION_IDLE_DAYS, maxDays: env.SESSION_MAX_DAYS },
    },
    // API demo chỉ tồn tại khi DEMO_MODE=true (không có đăng nhập).
    api: { db: dbHandle.db, crypto, demoMode: env.DEMO_MODE, log: { info: (o: object, m?: string) => app.log.info(o, m), warn: (o: object, m?: string) => app.log.warn(o, m) } },
  },
);

/**
 * Tắt nhẹ nhàng: ngừng nhận request, để job đang chạy xong, rồi đóng kết nối.
 * Dùng cho cả tín hiệu SIGTERM/SIGINT và lỗi khởi động, để không bao giờ thoát mà bỏ dở job.
 */
let stopMonitor: (() => Promise<void>) | undefined;
let stopSweeper: (() => Promise<void>) | undefined;
let shuttingDown = false;
async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ reason }, 'đang tắt server');
  try {
    await stopMonitor?.(); // chờ lượt đọc số liệu đang chạy trước khi đóng pg-boss
    await stopSweeper?.();
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
  // API demo không có đăng nhập: ở DEMO_MODE chỉ nghe localhost (tunnel tới localhost vẫn nhận được webhook).
  await app.listen({ port: env.PORT, host: env.DEMO_MODE ? '127.0.0.1' : '0.0.0.0' });
  if (env.DEMO_MODE) app.log.warn('DEMO_MODE=true: API demo /api/* đang bật, KHÔNG có đăng nhập, chỉ nghe 127.0.0.1. Không dùng cho dữ liệu khách thật.');
} catch (err) {
  app.log.error({ err }, 'không mở được cổng');
  await shutdown('lỗi khởi động', 1);
}

// AI trích xuất (Module 2). `AI_MODE=offline` là mặc định: luật tất định, không gọi mạng.
const extractor = createExtractor(env);
const extractQueue = createExtractQueue(boss);
app.log.info({ aiMode: env.AI_MODE, model: extractor.model, debounceSeconds: env.AI_DEBOUNCE_SECONDS }, 'AI trích xuất');
if (env.AI_MODE === 'live') {
  app.log.warn('AI_MODE=live: nội dung chat của tenant đã bật AI được gửi tới API Anthropic (nước ngoài). Chỉ dùng sau khi kiểm tra pháp lý.');
}

// Chỉ bắt đầu xử lý job sau khi server đã nhận request được.
await startWebhookWorker(boss, async (data) => {
  await processWebhookPayload(dbHandle.db, data.payload, app.log, {
    // Phân loại tin do Page gửi theo app_id của echo.
    sender: { ownAppId: env.FB_APP_ID, pageInboxAppIds: env.PAGE_INBOX_APP_IDS },
    afterStore: async (conversationIds) => {
      await enqueueExtractions(dbHandle.db, extractQueue, conversationIds, env.AI_DEBOUNCE_SECONDS);
    },
  });
});

await startExtractWorker(boss, async ({ conversationId }) => {
  await runExtraction({ db: dbHandle.db, extractor, log: app.log, contextMessages: env.AI_CONTEXT_MESSAGES }, conversationId);
});
stopSweeper = startSweeper({ db: dbHandle.db, queue: extractQueue, log: app.log, delaySeconds: env.AI_DEBOUNCE_SECONDS });

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
