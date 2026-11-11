/**
 * Định dạng thời gian theo múi giờ Việt Nam (UTC+7, không có giờ mùa hè).
 * Mọi thời điểm "bây giờ" phải lấy từ server (`/api/now`), KHÔNG dùng `Date.now()`: đồng hồ demo tua được.
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'] as const;
const WEEKDAYS_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

interface VnParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  wd: number;
}

function vnParts(iso: string): VnParts | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const s = new Date(t + VN_OFFSET_MS);
  return { y: s.getUTCFullYear(), mo: s.getUTCMonth() + 1, d: s.getUTCDate(), h: s.getUTCHours(), mi: s.getUTCMinutes(), wd: s.getUTCDay() };
}

/** "09:30" */
export function formatTime(iso: string): string {
  const p = vnParts(iso);
  return p ? `${pad(p.h)}:${pad(p.mi)}` : '';
}

/** "Thứ Sáu 13/11" */
export function formatDay(iso: string): string {
  const p = vnParts(iso);
  return p ? `${WEEKDAYS[p.wd]} ${pad(p.d)}/${pad(p.mo)}` : '';
}

/** "Thứ Sáu 13/11 09:30" */
export function formatDateTime(iso: string): string {
  const p = vnParts(iso);
  return p ? `${WEEKDAYS[p.wd]} ${pad(p.d)}/${pad(p.mo)} ${pad(p.h)}:${pad(p.mi)}` : '';
}

const dayKey = (p: VnParts) => Date.UTC(p.y, p.mo - 1, p.d);

/** Nhãn thời gian ở danh sách hội thoại: "09:28" (cùng ngày), "Hôm qua", "T4" (trong tuần), "08/11". */
export function formatInboxTime(iso: string, nowIso: string): string {
  const p = vnParts(iso);
  const n = vnParts(nowIso);
  if (!p || !n) return '';
  const diffDays = Math.round((dayKey(n) - dayKey(p)) / 86_400_000);
  if (diffDays <= 0) return `${pad(p.h)}:${pad(p.mi)}`;
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays < 7) return WEEKDAYS_SHORT[p.wd] ?? '';
  return `${pad(p.d)}/${pad(p.mo)}`;
}

/** "22 phút", "1 giờ 5 phút", "3 ngày". */
export function formatWait(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} phút`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r === 0 ? `${h} giờ` : `${h} giờ ${r} phút`;
  }
  return `${Math.floor(m / (24 * 60))} ngày`;
}

/** Số ngày lịch (theo giờ VN) từ `due` đến `now`, dùng cho "Quá hạn 3 ngày". Âm nếu chưa đến hạn. */
export function daysOverdue(dueIso: string, nowIso: string): number {
  const d = vnParts(dueIso);
  const n = vnParts(nowIso);
  if (!d || !n) return 0;
  return Math.round((dayKey(n) - dayKey(d)) / 86_400_000);
}

/** Chỉ để HIỂN THỊ: "0912345678" -> "0912 345 678". Giá trị lưu và gửi đi không đổi. Dạng khác giữ nguyên. */
export function formatPhoneDisplay(value: string): string {
  const d = value.replace(/\s+/g, '');
  return /^0\d{9}$/.test(d) ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : value;
}

export interface DatePick {
  label: string;
  /** Giá trị cho `<input type="datetime-local">`. */
  local: string;
}

/**
 * "Chọn nhanh" cho ô chọn ngày hẹn: Thứ Bảy và Chủ Nhật gần nhất SAU ngày tin được gửi, 10:00.
 * Chỉ là lối tắt theo lịch, KHÔNG phụ thuộc cụm khách viết (không giải "cuối tuần này" thành ngày) và không bao giờ
 * được điền sẵn: Sale phải bấm.
 */
export function nextWeekendPicks(sentAtIso: string): DatePick[] {
  const p = vnParts(sentAtIso);
  if (!p) return [];
  return [6, 0].map((target) => {
    const delta = ((target - p.wd + 7) % 7) || 7;
    const d = new Date(Date.UTC(p.y, p.mo - 1, p.d + delta));
    const dd = pad(d.getUTCDate());
    const mm = pad(d.getUTCMonth() + 1);
    return { label: `${WEEKDAYS[target]} ${dd}/${mm} 10:00`, local: `${d.getUTCFullYear()}-${mm}-${dd}T10:00` };
  });
}

const LOCAL_RE =/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Giá trị của `<input type="datetime-local">` ("2026-11-14T10:00") -> ISO có offset +07:00
 * ("2026-11-14T10:00:00+07:00"), đúng dạng backend yêu cầu cho `chosenAt`.
 * Trả `null` khi rỗng hoặc sai dạng: nút Duyệt phải khóa, KHÔNG được tự điền ngày thay.
 */
export function toIsoWithOffset(local: string): string | null {
  const m = LOCAL_RE.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const probe = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
  if (probe.getUTCMonth() !== Number(mo) - 1 || probe.getUTCDate() !== Number(d) || Number(h) > 23 || Number(mi) > 59) return null;
  return `${y}-${mo}-${d}T${h}:${mi}:00+07:00`;
}

/** Chuỗi ISO -> giá trị `datetime-local` theo giờ VN (để đặt lại ô chọn). */
export function toLocalInput(iso: string): string {
  const p = vnParts(iso);
  return p ? `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}` : '';
}

/** 6000000 -> "6.000.000 ₫". */
export function formatVnd(n: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;
}
