/**
 * Xếp việc trích xuất: từ webhook (debounce) và từ sweeper (lưới an toàn khi enqueue lỗi hoặc job bị mất).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, tenants } from '../db/schema.js';
import type { ExtractQueue } from '../queue/boss.js';
import { PROMPT_VERSION } from './prompt.js';
import type { RunLogger } from './run.js';

/**
 * Xếp việc cho các hội thoại vừa có tin khách mới, chỉ với tenant đã bật AI. `delaySeconds` là thời gian gom
 * tin: nhiều tin liên tiếp trong khoảng này chỉ ra MỘT lần trích (job cùng hội thoại đang chờ thì không xếp thêm).
 */
export async function enqueueExtractions(db: Db, queue: ExtractQueue, conversationIds: string[], delaySeconds: number): Promise<number> {
  if (conversationIds.length === 0) return 0;
  const enabled = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(tenants, eq(tenants.id, conversations.tenantId))
    .where(and(inArray(conversations.id, conversationIds), eq(tenants.aiExtractionEnabled, true)));
  let queued = 0;
  for (const c of enabled) if (await queue.enqueue(c.id, delaySeconds)) queued += 1;
  return queued;
}

/**
 * Hội thoại của tenant bật AI có tin khách mới nhất (sau lúc bật AI) mà chưa có run cho tin đó và phiên bản
 * prompt hiện hành. Cùng thứ tự (sent_at, id) với `runExtraction`.
 */
export async function findStaleConversations(db: Db, limit = 500): Promise<string[]> {
  const res = await db.execute<{ id: string }>(sql`
    SELECT c.id
    FROM conversations c
    JOIN tenants t ON t.id = c.tenant_id
    JOIN LATERAL (
      SELECT m.id, m.sent_at
      FROM messages m
      WHERE m.conversation_id = c.id AND m.direction = 'inbound' AND m.text IS NOT NULL AND m.text <> ''
      ORDER BY m.sent_at DESC, m.id DESC
      LIMIT 1
    ) m ON true
    WHERE t.ai_extraction_enabled
      AND (t.ai_enabled_at IS NULL OR m.sent_at >= t.ai_enabled_at)
      AND NOT EXISTS (
        SELECT 1 FROM extraction_runs r
        WHERE r.conversation_id = c.id AND r.up_to_message_id = m.id AND r.prompt_version = ${PROMPT_VERSION}
      )
    LIMIT ${limit}
  `);
  return res.rows.map((r) => r.id);
}

export interface SweeperDeps {
  db: Db;
  queue: ExtractQueue;
  log: RunLogger;
  delaySeconds: number;
}

/** Một lượt quét. Trả về số job đã xếp. */
export async function sweepOnce(deps: SweeperDeps): Promise<number> {
  const stale = await findStaleConversations(deps.db);
  const queued = await enqueueExtractions(deps.db, deps.queue, stale, deps.delaySeconds);
  if (stale.length > 0) deps.log.info({ sweeper: { stale: stale.length, queued } }, 'sweeper xếp việc trích xuất bị lỡ');
  return queued;
}

/**
 * Quét định kỳ (mặc định 5 phút) và một lượt ngay khi khởi động. Trả về hàm dừng: ngừng lên lịch VÀ chờ lượt đang
 * chạy xong. Không bao giờ ném lỗi (chỉ ghi cảnh báo); timer không giữ tiến trình sống.
 */
export function startSweeper(deps: SweeperDeps, opts: { intervalMs?: number } = {}): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  const tick = () => {
    if (inFlight) return;
    inFlight = sweepOnce(deps)
      .then(() => undefined)
      .catch((err: unknown) => deps.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'sweeper lỗi'))
      .finally(() => {
        inFlight = null;
      });
  };
  const timer = setInterval(tick, opts.intervalMs ?? 5 * 60_000);
  timer.unref();
  tick();
  return async () => {
    clearInterval(timer);
    await inFlight;
  };
}
