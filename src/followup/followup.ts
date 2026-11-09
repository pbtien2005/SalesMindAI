/**
 * Bám khách: số lần bám TÍNH KHI ĐỌC từ mốc thời gian của hội thoại, không lưu. Nhờ vậy tua đồng hồ chỉ cần đổi `now`.
 * Chỉ quyết định NGỪNG BÁM của Sale được lưu (`followup_state`).
 *
 * Giả định (kịch bản demo mục 10, drawio không nói): bám tăng 1 sau mỗi 24 giờ kể từ tin cuối của Page mà khách
 * chưa phản hồi, tối đa 5. Khách có bất kỳ hành động nào sau tin Page cuối thì về 0.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { followupState } from '../db/schema.js';

export const MAX_FOLLOWUP = 5;
const DAY_MS = 24 * 3600_000;

export interface ConvTimes {
  lastPageMessageAt: Date | null;
  lastUserInteractionAt: Date | null;
}

export function followupCount(c: ConvTimes, now: Date): number {
  if (!c.lastPageMessageAt) return 0; // Page chưa nhắn gì thì chưa có gì để bám
  if (c.lastUserInteractionAt && c.lastUserInteractionAt >= c.lastPageMessageAt) return 0; // khách đã phản hồi
  const elapsed = now.getTime() - c.lastPageMessageAt.getTime();
  if (elapsed < 0) return 0;
  return Math.min(MAX_FOLLOWUP, Math.floor(elapsed / DAY_MS));
}

export interface FollowupStatus {
  count: number;
  max: number;
  /** Sale đã quyết định ngừng bám (và khách chưa hành động lại kể từ đó). */
  stopped: boolean;
  /** Đủ 5/5 mà chưa ngừng: hệ thống ĐỀ XUẤT ngừng, Sale xác nhận. */
  suggestStop: boolean;
}

export function followupStatus(c: ConvTimes, stoppedAt: Date | null, now: Date): FollowupStatus {
  // Khách quay lại sau lúc ngừng thì không còn coi là "đã ngừng".
  const stopped = stoppedAt !== null && !(c.lastUserInteractionAt && c.lastUserInteractionAt > stoppedAt);
  const count = followupCount(c, now);
  return { count, max: MAX_FOLLOWUP, stopped, suggestStop: !stopped && count >= MAX_FOLLOWUP };
}

export class FollowupError extends Error {
  override readonly name = 'FollowupError';
  constructor(
    readonly code: 'already_stopped',
    message: string,
  ) {
    super(message);
  }
}

/** Sale xác nhận ngừng bám. Không ngừng hai lần (trừ khi khách đã hành động lại rồi). */
export async function stopFollowup(
  db: Db,
  input: { tenantId: string; conversationId: string; by: string },
  conv: ConvTimes,
  now: Date,
): Promise<void> {
  const [existing] = await db
    .select({ stoppedAt: followupState.stoppedAt })
    .from(followupState)
    .where(and(eq(followupState.conversationId, input.conversationId), eq(followupState.tenantId, input.tenantId)));
  if (existing && followupStatus(conv, existing.stoppedAt, now).stopped) {
    throw new FollowupError('already_stopped', 'Hội thoại này đã ngừng bám.');
  }
  await db
    .insert(followupState)
    .values({ conversationId: input.conversationId, tenantId: input.tenantId, stoppedAt: now, stoppedBy: input.by })
    .onConflictDoUpdate({ target: followupState.conversationId, set: { stoppedAt: now, stoppedBy: input.by } });
}
