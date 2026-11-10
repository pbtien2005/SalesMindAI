import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { extractionRuns, tenants } from '../db/schema.js';

/**
 * Bật hoặc tắt AI trích xuất cho một tenant. Bật thì ghi `ai_enabled_at`: tin của khách TRƯỚC thời điểm này
 * không tự được trích (tránh gửi lịch sử cũ ra ngoài khi mới bật); muốn trích lịch sử thì chạy tay `extract:run`.
 * Trả false nếu không có tenant.
 */
export async function setAiEnabled(db: Db, tenantId: string, enabled: boolean, now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .update(tenants)
    .set(enabled ? { aiExtractionEnabled: true, aiEnabledAt: now } : { aiExtractionEnabled: false })
    .where(eq(tenants.id, tenantId))
    .returning({ id: tenants.id });
  return rows.length > 0;
}

export interface ExtractionStatusRow {
  status: string;
  failureReason: string | null;
  runs: number;
}

/** Số lần chạy theo trạng thái (và lý do lỗi), để thấy nhanh AI có đang lỗi không. */
export async function extractionStatus(db: Db): Promise<ExtractionStatusRow[]> {
  const rows = await db
    .select({ status: extractionRuns.status, failureReason: extractionRuns.failureReason, runs: sql<number>`count(*)::int` })
    .from(extractionRuns)
    .groupBy(extractionRuns.status, extractionRuns.failureReason)
    .orderBy(extractionRuns.status);
  return rows;
}
