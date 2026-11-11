/**
 * Bám khách: số lần bám TÍNH KHI ĐỌC từ các tin Page đã gửi và `now`, không lưu. Nhờ vậy tua đồng hồ chỉ cần đổi `now`.
 * Chỉ quyết định NGỪNG BÁM của Sale được lưu (`followup_state`).
 *
 * Định nghĩa (đổi ngày 2026-11-11; drawio không nói, xem `doc/KICH-BAN-DEMO-MVP.md` mục 10): một "lần bám" là một hành
 * động chăm sóc THẬT của nhân viên, không phải số ngày trôi qua.
 * - Xét các tin Page gửi SAU lần khách hành động cuối (hoặc mọi tin Page nếu khách chưa hành động).
 * - Tin Page đầu tiên là TRẢ LỜI, chưa tính là bám.
 * - Mỗi tin Page tiếp theo, gửi cách mốc tính trước đó ít nhất 24 giờ, là 1 lần bám. Tin gửi dồn trong 24 giờ chỉ tính một.
 * - Khách có bất kỳ hành động nào thì về 0. Tối đa 5.
 * - ĐẾN HẠN bám lần tiếp theo khi tin Page cuối đã quá 24 giờ mà khách chưa phản hồi và chưa đủ 5 lần.
 * - Đủ 5 lần và đã chờ thêm 24 giờ sau lần bám cuối mà khách vẫn im thì mới ĐỀ XUẤT ngừng bám.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { followupState } from '../db/schema.js';

export const MAX_FOLLOWUP = 5;
/** Khoảng cách tối thiểu giữa hai lần bám, và thời gian chờ khách phản hồi trước khi đến hạn bám tiếp. */
export const FOLLOWUP_GAP_MS = 24 * 3600_000;

export interface ConvTimes {
  lastUserInteractionAt: Date | null;
  /** Giờ gửi các tin Page SAU lần khách hành động cuối, cũ nhất trước. Rỗng nếu Page chưa nhắn sau khách. */
  pageMessagesAfterUser: readonly Date[];
}

/** Các tin Page đã gửi tính đến `now`, cũ nhất trước (tin ở tương lai bị bỏ). */
function sentUntil(c: ConvTimes, now: Date): number[] {
  return c.pageMessagesAfterUser
    .map((d) => d.getTime())
    .filter((t) => t <= now.getTime())
    .sort((a, b) => a - b);
}

export function followupCount(c: ConvTimes, now: Date): number {
  const times = sentUntil(c, now);
  let count = 0;
  let ref: number | null = null; // mốc tính trước đó (tin trả lời, rồi mỗi lần bám)
  for (const t of times) {
    if (ref === null) {
      ref = t; // tin đầu tiên là trả lời
      continue;
    }
    if (t - ref >= FOLLOWUP_GAP_MS) {
      count += 1;
      ref = t;
    }
  }
  return Math.min(MAX_FOLLOWUP, count);
}

export interface FollowupStatus {
  count: number;
  max: number;
  /** Sale đã quyết định ngừng bám (và khách chưa hành động lại kể từ đó). */
  stopped: boolean;
  /** Đủ 5 lần, đã chờ thêm 24 giờ mà chưa ngừng: hệ thống ĐỀ XUẤT ngừng, Sale xác nhận. */
  suggestStop: boolean;
  /** Đã quá 24 giờ kể từ tin Page cuối mà khách chưa phản hồi, và chưa đủ 5 lần: đến hạn bám lần tiếp theo. */
  due: boolean;
  /** Lúc đến hạn bám lần tiếp theo (tin Page cuối + 24 giờ); null nếu không có gì để bám. */
  dueAt: Date | null;
}

/** Khách quay lại sau lúc ngừng thì không còn coi là "đã ngừng". */
export function isStopped(stoppedAt: Date | null, lastUserInteractionAt: Date | null): boolean {
  return stoppedAt !== null && !(lastUserInteractionAt && lastUserInteractionAt > stoppedAt);
}

export function followupStatus(c: ConvTimes, stoppedAt: Date | null, now: Date): FollowupStatus {
  const stopped = isStopped(stoppedAt, c.lastUserInteractionAt);
  const times = sentUntil(c, now);
  const count = followupCount(c, now);
  const lastPage = times.length ? times[times.length - 1]! : null;
  const nextAt = lastPage === null ? null : new Date(lastPage + FOLLOWUP_GAP_MS);
  const waited = nextAt !== null && nextAt.getTime() <= now.getTime();
  return {
    count,
    max: MAX_FOLLOWUP,
    stopped,
    suggestStop: !stopped && count >= MAX_FOLLOWUP && waited,
    due: !stopped && count < MAX_FOLLOWUP && waited,
    dueAt: !stopped && count < MAX_FOLLOWUP ? nextAt : null,
  };
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
  conv: Pick<ConvTimes, 'lastUserInteractionAt'>,
  now: Date,
): Promise<void> {
  const [existing] = await db
    .select({ stoppedAt: followupState.stoppedAt })
    .from(followupState)
    .where(and(eq(followupState.conversationId, input.conversationId), eq(followupState.tenantId, input.tenantId)));
  if (existing && isStopped(existing.stoppedAt, conv.lastUserInteractionAt)) {
    throw new FollowupError('already_stopped', 'Hội thoại này đã ngừng bám.');
  }
  await db
    .insert(followupState)
    .values({ conversationId: input.conversationId, tenantId: input.tenantId, stoppedAt: now, stoppedBy: input.by })
    .onConflictDoUpdate({ target: followupState.conversationId, set: { stoppedAt: now, stoppedBy: input.by } });
}
