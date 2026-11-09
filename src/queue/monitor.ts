import type { PgBoss } from 'pg-boss';
import { isDeadLetter, queueOverview, type QueueSummary } from './admin.js';

export interface MonitorLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

/** Job sẵn sàng mà chờ lâu hơn mức này (giây) nghĩa là worker đang tắc hoặc không chạy. */
export const STALE_READY_SECONDS = 300;

export interface QueueHealth {
  level: 'info' | 'warn';
  /** Các vấn đề cần người vận hành chú ý. */
  problems: string[];
  queues: QueueSummary[];
}

/**
 * Đánh giá sức khỏe hàng đợi. Cảnh báo khi:
 * - dead-letter có job: tin chưa lưu được, cần xử lý (`queue:redrive`) trước khi hết hạn 14 ngày;
 * - job sẵn sàng chờ quá lâu: worker không chạy hoặc tắc.
 *
 * KHÔNG cảnh báo theo số job `failed` của queue nguồn: pg-boss giữ job hết retry ở trạng thái failed tới
 * khi hết hạn lưu trữ, dù bản sao đã vào dead-letter. Cảnh báo đó trùng với dead-letter và không tự hết
 * sau khi redrive nên chỉ gây nhiễu. Số `failed` vẫn có trong log để tham khảo.
 */
export function assessQueueHealth(queues: QueueSummary[]): QueueHealth {
  const problems: string[] = [];
  for (const q of queues) {
    if (isDeadLetter(q.name) && q.queued > 0) {
      problems.push(`${q.name}: ${q.queued} job trong dead-letter, cần xử lý (npm run cli -- queue:redrive)`);
    }
    if (!isDeadLetter(q.name) && q.oldestReadySeconds !== null && q.oldestReadySeconds > STALE_READY_SECONDS) {
      problems.push(`${q.name}: job chờ lâu nhất ${Math.round(q.oldestReadySeconds)} giây, worker có thể đang tắc`);
    }
  }
  return { level: problems.length > 0 ? 'warn' : 'info', problems, queues };
}

/**
 * Ghi log độ sâu hàng đợi định kỳ (mặc định mỗi phút). Trả về hàm dừng: ngừng lên lịch VÀ chờ lượt đang
 * chạy xong (để không còn truy vấn dở dang khi đóng pg-boss). Không bao giờ ném lỗi: lỗi đọc số liệu
 * chỉ được ghi cảnh báo. Timer không giữ tiến trình sống.
 */
export function startQueueMonitor(
  boss: Pick<PgBoss, 'getQueueStats'>,
  log: MonitorLogger,
  opts: { intervalMs?: number } = {},
): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  const run = async () => {
    try {
      const health = assessQueueHealth(await queueOverview(boss));
      const summary = Object.fromEntries(health.queues.map((q) => [q.name, { queued: q.queued, active: q.active, failed: q.failed }]));
      if (health.level === 'warn') log.warn({ queues: summary, problems: health.problems }, 'hàng đợi cần chú ý');
      else log.info({ queues: summary }, 'độ sâu hàng đợi');
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'không đọc được số liệu hàng đợi');
    } finally {
      inFlight = null;
    }
  };
  const tick = () => {
    if (inFlight) return; // lần trước chưa xong thì bỏ lượt này
    inFlight = run();
  };
  const timer = setInterval(tick, opts.intervalMs ?? 60_000);
  timer.unref();
  tick();
  return async () => {
    clearInterval(timer);
    await inFlight;
  };
}
