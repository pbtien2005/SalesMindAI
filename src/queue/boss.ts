import { PgBoss, type QueueOptions } from 'pg-boss';

export const WEBHOOK_QUEUE = 'webhook-events';
export const WEBHOOK_DEAD_QUEUE = 'webhook-events-dead';

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
  /** Nhận lỗi của pg-boss. Mặc định ghi stderr. */
  onError?: (err: Error) => void;
}

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
 * pg-boss `createQueue` không làm gì nếu queue đã có, nên đổi cấu hình trong mã sẽ không có hiệu lực
 * ở lần chạy sau. Với queue đã có thì cập nhật bằng `updateQueue`.
 * Giới hạn của pg-boss: `retryDelayMax` không sửa được qua `updateQueue`, nên muốn đổi nó phải xóa
 * và tạo lại queue (cần bảo đảm queue đã trống).
 */
async function ensureQueue(boss: PgBoss, name: string, options: QueueOptions & { deadLetter?: string }): Promise<void> {
  const existing = await boss.getQueue(name);
  if (!existing) {
    await boss.createQueue(name, options);
    return;
  }
  const { retryDelayMax: _ignored, heartbeatSeconds: _hb, ...updatable } = options;
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
  return boss;
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
