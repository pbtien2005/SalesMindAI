import { PgBoss, type QueueOptions } from 'pg-boss';
import type { BackfillConversationJob, BackfillPageJob, BackfillQueue } from '../backfill/backfill.js';

export const WEBHOOK_QUEUE = 'webhook-events';
export const WEBHOOK_DEAD_QUEUE = 'webhook-events-dead';
export const BACKFILL_PAGE_QUEUE = 'backfill-page';
export const BACKFILL_CONVERSATION_QUEUE = 'backfill-conversation';
export const BACKFILL_DEAD_QUEUE = 'backfill-dead';
export const EXTRACT_QUEUE = 'extract-conversation';
export const EXTRACT_DEAD_QUEUE = 'extract-conversation-dead';

/** Job trích xuất: chỉ mang ID hội thoại, không có nội dung tin (worker tự đọc từ DB). */
export interface ExtractJobData {
  conversationId: string;
}

/** Phần mà webhook và sweeper cần: xếp việc trích xuất, không biết gì về pg-boss. */
export interface ExtractQueue {
  /** Trả true nếu có job mới, false nếu đã có job cùng hội thoại đang chờ (khử trùng đúng ý, không phải lỗi). */
  enqueue(conversationId: string, delaySeconds: number): Promise<boolean>;
}

/** Dữ liệu một job: nguyên payload webhook đã qua kiểm tra chữ ký. */
export interface WebhookJobData {
  payload: unknown;
  receivedAt: string;
}

/** Phần mà route webhook cần: chỉ ghi vào hàng đợi, không biết gì về pg-boss. */
export interface WebhookQueue {
  enqueue(data: WebhookJobData): Promise<void>;
}

export interface BossOptions {
  /** Ghi đè cấu hình queue chính (test dùng để rút ngắn thời gian retry). */
  queueOverrides?: QueueOptions;
  /** Ghi đè cấu hình các queue backfill (test). */
  backfillQueueOverrides?: QueueOptions;
  /** Ghi đè cấu hình queue trích xuất (test). */
  extractQueueOverrides?: QueueOptions;
  /** Nhận lỗi của pg-boss. Mặc định ghi stderr. */
  onError?: (err: Error) => void;
}

/**
 * Queue trích xuất: lỗi chủ yếu là mạng hoặc giới hạn tốc độ của API AI nên retry có backoff (10 giây tăng dần
 * tới 5 phút, 5 lần). Job không chứa nội dung tin nên giữ ngắn. Lưới an toàn cho job bị mất là sweeper.
 */
const EXTRACT_QUEUE_DEFAULTS: QueueOptions = {
  retryLimit: 5,
  retryDelay: 10,
  retryBackoff: true,
  retryDelayMax: 300,
  expireInSeconds: 180,
  deleteAfterSeconds: 24 * 3600,
};

/**
 * Cấu hình queue chính. Ta trả 200 cho Meta ngay khi job vào hàng đợi, nên Meta sẽ không gửi lại:
 * mất tin chỉ xảy ra nếu job hỏng hẳn. Vì vậy retry dài (backoff 5s tăng dần tới 10 phút, tổng
 * khoảng 20 phút cho 8 lần) và job hết retry vào dead-letter thay vì bị xóa.
 */
const WEBHOOK_QUEUE_DEFAULTS: QueueOptions = {
  retryLimit: 8,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 600,
  expireInSeconds: 120,
  // Payload chứa nội dung tin nhắn: xóa job đã xong sau 24 giờ để không giữ bản sao lâu.
  deleteAfterSeconds: 24 * 3600,
};

/**
 * Dead-letter giữ NGUYÊN payload (gồm nội dung tin) 14 ngày, cố ý khác với 24 giờ của job đã xong:
 * đây là bản duy nhất còn lại của tin chưa lưu được, cần đủ thời gian để người vận hành sửa nguyên
 * nhân rồi chạy lại (`boss.redrive`). Chưa có worker hay cảnh báo nào cho queue này; mốc 6 thêm log
 * độ sâu hàng đợi và số job lỗi. Hết 14 ngày mà chưa xử lý thì tin mất.
 */
const DEAD_LETTER_OPTIONS: QueueOptions = { retentionSeconds: 14 * 24 * 3600 };

/**
 * Queue backfill: lỗi chủ yếu là giới hạn tốc độ của Graph API nên retry thưa hơn và dài hơn webhook
 * (30s tăng dần tới 15 phút). Job backfill không chứa nội dung tin nên có thể giữ ngắn.
 */
const BACKFILL_QUEUE_DEFAULTS: QueueOptions = {
  retryLimit: 6,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 900,
  expireInSeconds: 300,
  deleteAfterSeconds: 24 * 3600,
};

/**
 * pg-boss `createQueue` không làm gì nếu queue đã có, nên đổi cấu hình trong mã sẽ không có hiệu lực
 * ở lần chạy sau. Với queue đã có thì cập nhật bằng `updateQueue`.
 * Giới hạn của pg-boss: `retryDelayMax` không sửa được qua `updateQueue`, nên muốn đổi nó phải xóa
 * và tạo lại queue (cần bảo đảm queue đã trống).
 */
async function ensureQueue(
  boss: PgBoss,
  name: string,
  options: QueueOptions & { deadLetter?: string; policy?: string },
): Promise<void> {
  const existing = await boss.getQueue(name);
  if (!existing) {
    await boss.createQueue(name, options);
    return;
  }
  // `policy` chỉ đặt được lúc tạo queue; retryDelayMax và heartbeatSeconds không sửa được qua updateQueue.
  const { retryDelayMax: _ignored, heartbeatSeconds: _hb, policy: _policy, ...updatable } = options;
  await boss.updateQueue(name, updatable);
}

/** Khởi động pg-boss (tự tạo schema `pgboss`) và tạo hoặc cập nhật các queue. */
export async function createBoss(databaseUrl: string, opts: BossOptions = {}): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl, max: 5 });
  // Bắt buộc có handler 'error', nếu không EventEmitter sẽ làm sập tiến trình.
  boss.on('error', opts.onError ?? ((err) => console.error(`[pg-boss] ${err.message}`)));
  await boss.start();
  // Dead-letter phải tồn tại trước queue trỏ tới nó.
  await ensureQueue(boss, WEBHOOK_DEAD_QUEUE, DEAD_LETTER_OPTIONS);
  const queueOptions: QueueOptions = { ...WEBHOOK_QUEUE_DEFAULTS, ...opts.queueOverrides };
  // pg-boss từ chối retryDelayMax khi không bật backoff.
  if (!queueOptions.retryBackoff) delete queueOptions.retryDelayMax;
  await ensureQueue(boss, WEBHOOK_QUEUE, { ...queueOptions, deadLetter: WEBHOOK_DEAD_QUEUE });

  await ensureQueue(boss, BACKFILL_DEAD_QUEUE, DEAD_LETTER_OPTIONS);
  const backfillOptions: QueueOptions = { ...BACKFILL_QUEUE_DEFAULTS, ...opts.backfillQueueOverrides };
  if (!backfillOptions.retryBackoff) delete backfillOptions.retryDelayMax;
  for (const name of [BACKFILL_PAGE_QUEUE, BACKFILL_CONVERSATION_QUEUE]) {
    // Chính sách 'short' + singletonKey: mỗi khóa chỉ có một job ĐANG CHỜ, nên chạy backfill hai lần
    // hoặc job liệt kê được retry không nhân đôi job hội thoại đang chờ.
    await ensureQueue(boss, name, { ...backfillOptions, deadLetter: BACKFILL_DEAD_QUEUE, policy: 'short' });
  }

  await ensureQueue(boss, EXTRACT_DEAD_QUEUE, DEAD_LETTER_OPTIONS);
  const extractOptions: QueueOptions = { ...EXTRACT_QUEUE_DEFAULTS, ...opts.extractQueueOverrides };
  if (!extractOptions.retryBackoff) delete extractOptions.retryDelayMax;
  // 'short' + singletonKey: mỗi hội thoại chỉ có MỘT job đang chờ, nên nhiều tin liên tiếp chỉ ra một lần trích.
  await ensureQueue(boss, EXTRACT_QUEUE, { ...extractOptions, deadLetter: EXTRACT_DEAD_QUEUE, policy: 'short' });
  return boss;
}

export function createExtractQueue(boss: PgBoss): ExtractQueue {
  return {
    async enqueue(conversationId, delaySeconds) {
      const job: ExtractJobData = { conversationId };
      return (await boss.send(EXTRACT_QUEUE, job, { singletonKey: conversationId, startAfter: delaySeconds })) !== null;
    },
  };
}

/** Đăng ký worker trích xuất. Một job một hội thoại; số job song song giữ thấp để không dồn vào API AI. */
export async function startExtractWorker(
  boss: PgBoss,
  handler: (job: ExtractJobData) => Promise<void>,
  opts: WorkerOptions & { concurrency?: number } = {},
): Promise<void> {
  await boss.work<ExtractJobData>(
    EXTRACT_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 1, localConcurrency: opts.concurrency ?? 2 },
    async (jobs) => {
      for (const job of jobs) await handler(job.data);
    },
  );
}

export function createWebhookQueue(boss: PgBoss): WebhookQueue {
  return {
    async enqueue(data) {
      const id = await boss.send(WEBHOOK_QUEUE, data);
      // send() trả null khi job bị bỏ (trùng khóa singleton...). Ta không dùng singleton nên
      // null nghĩa là lỗi thật: ném để route trả 5xx và Meta thử lại.
      if (id === null) throw new Error('pg-boss không nhận job webhook');
    },
  };
}

export interface WorkerOptions {
  pollingIntervalSeconds?: number;
}

/** Đăng ký worker xử lý job webhook. Mỗi job là một request của Meta, xử lý nguyên tử. */
export async function startWebhookWorker(
  boss: PgBoss,
  handler: (data: WebhookJobData) => Promise<void>,
  opts: WorkerOptions = {},
): Promise<void> {
  await boss.work<WebhookJobData>(
    WEBHOOK_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 1 },
    async (jobs) => {
      for (const job of jobs) await handler(job.data);
    },
  );
}

export function createBackfillQueue(boss: PgBoss): BackfillQueue {
  // send() trả null khi đã có job cùng singletonKey đang chờ: đó là khử trùng đúng ý, không phải lỗi.
  return {
    async enqueuePage(job) {
      return (await boss.send(BACKFILL_PAGE_QUEUE, job, { singletonKey: job.pageId })) !== null;
    },
    async enqueueConversation(job) {
      return (await boss.send(BACKFILL_CONVERSATION_QUEUE, job, { singletonKey: `${job.pageId}:${job.conversationId}` })) !== null;
    },
  };
}

export interface BackfillWorkerOptions extends WorkerOptions {
  /** Số hội thoại xử lý song song trong tiến trình này. Giữ thấp để không dồn dập vào Graph API. */
  conversationConcurrency?: number;
}

/** Đăng ký worker cho hai queue backfill. */
export async function startBackfillWorkers(
  boss: PgBoss,
  handlers: {
    page: (job: BackfillPageJob) => Promise<void>;
    conversation: (job: BackfillConversationJob) => Promise<void>;
  },
  opts: BackfillWorkerOptions = {},
): Promise<void> {
  const polling = opts.pollingIntervalSeconds ?? 2;
  await boss.work<BackfillPageJob>(BACKFILL_PAGE_QUEUE, { batchSize: 1, pollingIntervalSeconds: polling }, async (jobs) => {
    for (const job of jobs) await handlers.page(job.data);
  });
  await boss.work<BackfillConversationJob>(
    BACKFILL_CONVERSATION_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: polling, localConcurrency: opts.conversationConcurrency ?? 2 },
    async (jobs) => {
      for (const job of jobs) await handlers.conversation(job.data);
    },
  );
}
