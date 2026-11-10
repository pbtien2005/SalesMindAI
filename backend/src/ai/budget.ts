/**
 * Hạn mức và đo lường AI theo doanh nghiệp. Mỗi lời gọi mô hình phải xin giữ chỗ TRƯỚC (`checkAndReserve`, nguyên tử:
 * một câu INSERT ... ON CONFLICT DO UPDATE ... WHERE calls < cap) rồi ghi token SAU (`recordUsage`). Tính theo ngày giờ
 * Việt Nam. Doanh nghiệp này hết hạn mức không ảnh hưởng doanh nghiệp khác (mỗi tenant một dòng mỗi ngày).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { aiUsage, tenants } from '../db/schema.js';

const VN_OFFSET_MS = 7 * 3_600_000;

/** Ngày (YYYY-MM-DD) theo giờ Việt Nam. */
export function vnDay(now: Date): string {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export async function tenantCap(db: Db, tenantId: string, defaultCap: number): Promise<number> {
  const [t] = await db.select({ cap: tenants.aiDailyCap }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.cap ?? defaultCap;
}

/** Giữ chỗ một lời gọi. `allowed: false` khi đã đủ `cap` lời gọi trong ngày. */
export async function checkAndReserve(db: Db, tenantId: string, now: Date, cap: number): Promise<{ allowed: boolean; remaining: number }> {
  if (cap <= 0) return { allowed: false, remaining: 0 };
  const rows = await db
    .insert(aiUsage)
    .values({ tenantId, day: vnDay(now), calls: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.tenantId, aiUsage.day],
      set: { calls: sql`${aiUsage.calls} + 1` },
      setWhere: sql`${aiUsage.calls} < ${cap}`,
    })
    .returning({ calls: aiUsage.calls });
  const calls = rows[0]?.calls;
  return calls === undefined ? { allowed: false, remaining: 0 } : { allowed: true, remaining: Math.max(0, cap - calls) };
}

/** Trả lại một lượt đã giữ khi lời gọi không thực sự tốn gì (ví dụ ném lỗi mạng trước khi gửi). */
export async function releaseReservation(db: Db, tenantId: string, now: Date): Promise<void> {
  await db
    .update(aiUsage)
    .set({ calls: sql`GREATEST(${aiUsage.calls} - 1, 0)` })
    .where(and(eq(aiUsage.tenantId, tenantId), eq(aiUsage.day, vnDay(now))));
}

export async function recordUsage(db: Db, tenantId: string, usage: { inputTokens: number; outputTokens: number }, now: Date): Promise<void> {
  await db
    .insert(aiUsage)
    .values({ tenantId, day: vnDay(now), calls: 0, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
    .onConflictDoUpdate({
      target: [aiUsage.tenantId, aiUsage.day],
      set: { inputTokens: sql`${aiUsage.inputTokens} + ${usage.inputTokens}`, outputTokens: sql`${aiUsage.outputTokens} + ${usage.outputTokens}` },
    });
}

export async function usageToday(db: Db, tenantId: string, now: Date): Promise<{ calls: number; inputTokens: number; outputTokens: number }> {
  const [r] = await db.select().from(aiUsage).where(and(eq(aiUsage.tenantId, tenantId), eq(aiUsage.day, vnDay(now))));
  return { calls: r?.calls ?? 0, inputTokens: r?.inputTokens ?? 0, outputTokens: r?.outputTokens ?? 0 };
}
