/**
 * Đồng hồ demo: `now = giờ thật + offset_ms`, offset lưu trong DB (một dòng) nên server, CLI và test thấy
 * cùng một giá trị. Đồng hồ vẫn chạy tiếp theo giờ thật sau khi đặt. Chỉ có hiệu lực khi DEMO_MODE=true;
 * ngoài demo thì `getNow` luôn trả giờ thật.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { demoClock } from '../db/schema.js';

export async function getOffsetMs(db: Db): Promise<number> {
  const [row] = await db.select({ offsetMs: demoClock.offsetMs }).from(demoClock).where(eq(demoClock.id, 1));
  return row?.offsetMs ?? 0;
}

/** Giờ hiện tại theo ngữ cảnh: giờ thật, hoặc giờ demo (đã tua) khi bật DEMO_MODE. */
export async function getNow(db: Db, demoMode: boolean, realNow: Date = new Date()): Promise<Date> {
  if (!demoMode) return realNow;
  return new Date(realNow.getTime() + (await getOffsetMs(db)));
}

async function writeOffset(db: Db, offsetMs: number, realNow: Date): Promise<void> {
  await db
    .insert(demoClock)
    .values({ id: 1, offsetMs, updatedAt: realNow })
    .onConflictDoUpdate({ target: demoClock.id, set: { offsetMs, updatedAt: realNow } });
}

/** Đặt đồng hồ demo về đúng `target`. Trả về giờ demo sau khi đặt. */
export async function setClockTo(db: Db, target: Date, realNow: Date = new Date()): Promise<Date> {
  await writeOffset(db, target.getTime() - realNow.getTime(), realNow);
  return target;
}

/** Tua đồng hồ tới trước `minutes` phút. Không cho tua lùi (tin và việc đã tạo sẽ ở "tương lai"). */
export async function advanceClock(db: Db, minutes: number, realNow: Date = new Date()): Promise<Date> {
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('Số phút tua phải là số dương.');
  const offset = (await getOffsetMs(db)) + Math.round(minutes * 60_000);
  await writeOffset(db, offset, realNow);
  return new Date(realNow.getTime() + offset);
}

/** Tua tới một thời điểm ở tương lai (so với giờ demo hiện tại). */
export async function advanceClockTo(db: Db, target: Date, realNow: Date = new Date()): Promise<Date> {
  const current = await getNow(db, true, realNow);
  const minutes = (target.getTime() - current.getTime()) / 60_000;
  if (minutes <= 0) throw new Error('Chỉ tua tới thời điểm sau giờ demo hiện tại.');
  return advanceClock(db, minutes, realNow);
}
