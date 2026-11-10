import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { messages, pages } from '../db/schema.js';
import type { BackfillState } from './backfill.js';

export interface BackfillOverviewRow {
  fbPageId: string;
  name: string;
  /** Sức khỏe của token (`active` hoặc `token_invalid`). */
  status: 'active' | 'token_invalid' | 'disconnected';
  state: BackfillState | null;
  /** Số tin đã lưu từ backfill của Page này. */
  stored: number;
}

/**
 * Tiến độ backfill từng Page. Đếm bằng truy vấn nhóm riêng rồi ghép trong JS, không dùng truy vấn con
 * tương quan: Drizzle viết cột không kèm tên bảng trong truy vấn con nên điều kiện so sánh sai cột
 * và luôn ra 0 (đã gặp ở tenant:list).
 */
export async function backfillOverview(db: Db): Promise<BackfillOverviewRow[]> {
  const [rows, counts] = await Promise.all([
    db
      .select({ id: pages.id, fbPageId: pages.fbPageId, name: pages.name, status: pages.status, state: pages.backfillState })
      .from(pages)
      .orderBy(pages.createdAt),
    db
      .select({ pageId: messages.pageId, n: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.source, 'backfill'))
      .groupBy(messages.pageId),
  ]);
  const byPage = new Map(counts.map((c) => [c.pageId, c.n]));
  return rows.map((r) => ({
    fbPageId: r.fbPageId,
    name: r.name,
    status: r.status,
    state: (r.state as BackfillState | null) ?? null,
    stored: byPage.get(r.id) ?? 0,
  }));
}

/** Một lần backfill coi là đang chạy nếu trạng thái `running` và vừa được cập nhật gần đây. */
export const BACKFILL_STALE_MS = 30 * 60 * 1000;

export function isBackfillRunning(state: BackfillState | null | undefined, now: Date = new Date()): boolean {
  if (!state || state.status !== 'running') return false;
  const updated = Date.parse(state.updatedAt);
  return Number.isFinite(updated) && now.getTime() - updated < BACKFILL_STALE_MS;
}
