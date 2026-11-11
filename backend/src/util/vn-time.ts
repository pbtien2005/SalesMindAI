const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

/** 00:00 giờ Việt Nam (UTC+7, không đổi giờ mùa hè) của ngày chứa `now`, dạng thời điểm UTC. */
export function startOfVnDay(now: Date): Date {
  const shifted = now.getTime() + VN_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - VN_OFFSET_MS);
}
