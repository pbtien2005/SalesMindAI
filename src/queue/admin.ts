import type { PgBoss } from 'pg-boss';
import {
  BACKFILL_CONVERSATION_QUEUE,
  BACKFILL_DEAD_QUEUE,
  BACKFILL_PAGE_QUEUE,
  EXTRACT_DEAD_QUEUE,
  EXTRACT_QUEUE,
  WEBHOOK_DEAD_QUEUE,
  WEBHOOK_QUEUE,
} from './boss.js';

/** Mọi queue của hệ thống, theo thứ tự hiển thị. */
export const ALL_QUEUES = [
  WEBHOOK_QUEUE,
  WEBHOOK_DEAD_QUEUE,
  BACKFILL_PAGE_QUEUE,
  BACKFILL_CONVERSATION_QUEUE,
  BACKFILL_DEAD_QUEUE,
  EXTRACT_QUEUE,
  EXTRACT_DEAD_QUEUE,
] as const;

export const DEAD_LETTER_QUEUES = [WEBHOOK_DEAD_QUEUE, BACKFILL_DEAD_QUEUE, EXTRACT_DEAD_QUEUE] as const;
export const isDeadLetter = (name: string) => (DEAD_LETTER_QUEUES as readonly string[]).includes(name);

export interface QueueSummary {
  name: string;
  /** Đang chờ (kể cả chờ retry). */
  queued: number;
  active: number;
  failed: number;
  /** Tuổi (giây) của job sẵn sàng chạy lâu nhất; null nếu không có. */
  oldestReadySeconds: number | null;
}

/**
 * Số liệu từng queue. `force: true` bỏ qua cache (có thể trễ tới ~1 giờ), nhưng pg-boss vẫn tái dùng
 * kết quả vừa tính trong vòng một phút gần nhất nên số liệu có thể trễ tới ~1 phút.
 */
export async function queueOverview(
  boss: Pick<PgBoss, 'getQueueStats'>,
  names: readonly string[] = ALL_QUEUES,
): Promise<QueueSummary[]> {
  return Promise.all(
    names.map(async (name) => {
      const [s] = await boss.getQueueStats(name, { force: true });
      return {
        name,
        queued: s?.queuedCount ?? 0,
        active: s?.activeCount ?? 0,
        failed: s?.failedCount ?? 0,
        oldestReadySeconds: s?.readyOldestSeconds ?? null,
      };
    }),
  );
}

/**
 * Kiểm tra readiness cho hàng đợi: queue phải TỒN TẠI. `getQueue` trả null (không ném lỗi) khi queue
 * thiếu, nên không thể chỉ gọi nó và coi là đạt.
 */
export async function assertQueueExists(boss: Pick<PgBoss, 'getQueue'>, name: string): Promise<void> {
  if (!(await boss.getQueue(name))) throw new Error(`queue ${name} không tồn tại`);
}

export type DeadLetterTarget = 'webhook' | 'backfill' | 'extraction';

const DEAD_BY_TARGET: Record<DeadLetterTarget, string> = {
  webhook: WEBHOOK_DEAD_QUEUE,
  backfill: BACKFILL_DEAD_QUEUE,
  extraction: EXTRACT_DEAD_QUEUE,
};

export interface RedriveResult {
  target: DeadLetterTarget;
  dryRun: boolean;
  /** Số job đã chuyển (hoặc sẽ chuyển nếu dryRun). */
  jobs: number;
  /** Job không có queue nguồn nên không chuyển được; vẫn nằm trong dead-letter. */
  unroutable: number;
}

/**
 * Đưa job từ dead-letter về lại queue gốc để xử lý lại, sau khi người vận hành đã sửa nguyên nhân
 * (ví dụ kết nối Page còn thiếu). Payload còn nguyên nên không mất tin. Mặc định tối đa 1000 job mỗi lần.
 */
export async function redriveDeadLetter(
  boss: Pick<PgBoss, 'redrive' | 'previewRedrive'>,
  target: DeadLetterTarget,
  opts: { limit?: number; dryRun?: boolean } = {},
): Promise<RedriveResult> {
  const queue = DEAD_BY_TARGET[target];
  const limit = opts.limit ?? 1000;
  if (opts.dryRun) {
    const p = await boss.previewRedrive(queue, { limit });
    return { target, dryRun: true, jobs: Math.max(0, p.total - p.unroutable), unroutable: p.unroutable };
  }
  // Xem trước để biết số job không có queue nguồn (redrive không báo số này): nếu không, người vận hành
  // thấy cảnh báo dead-letter còn mãi mà không hiểu vì sao.
  const preview = await boss.previewRedrive(queue, { limit });
  const moved = await boss.redrive(queue, { limit });
  return { target, dryRun: false, jobs: moved, unroutable: preview.unroutable };
}
