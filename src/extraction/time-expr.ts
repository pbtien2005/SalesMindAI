/**
 * Phân loại cụm từ chỉ thời gian. CỐ Ý không có hàm nào trả ra ngày: "cuối tuần này" là thứ Bảy hay Chủ Nhật,
 * "mai" là mai nào, do Sale chọn. Module này chỉ cho biết cụm đó có cần hỏi lại hay không.
 *
 * - `absolute`: có ngày tháng rõ ràng ("14/11", "ngày 14 tháng 11").
 * - `relative`: tính từ lúc gửi tin ("mai", "thứ 6", "tuần sau", "cuối tuần này").
 * - `vague`: không có mốc ("khi nào rảnh", "sớm", "sắp tới").
 * - `none`: không phải biểu thức thời gian.
 */
import { foldText } from './verify-evidence.js';

export type TimeKind = 'absolute' | 'relative' | 'vague' | 'none';

const W = (body: string) => new RegExp(`(?<![a-z0-9])(?:${body})(?![a-z0-9])`);

const ABSOLUTE = [
  /(?<!\d)\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?(?!\d)/, // 14/11, 14-11-2026
  W('ngay\\s+\\d{1,2}'), // ngày 14
  W('thang\\s+\\d{1,2}'), // tháng 11
];

const RELATIVE = [
  W('hom nay|ngay mai|ngay kia|hom sau|ngay hom sau|mai|may hom nua|vai hom nua|vai ngay nua'),
  W('(?:sang|trua|chieu|toi|dem)\\s+(?:nay|mai|nay|qua)'),
  W('thu\\s+(?:hai|ba|tu|nam|sau|bay|[2-7])'),
  W('chu nhat|cn'),
  W('(?:cuoi|dau|giua)\\s+tuan(?:\\s+(?:nay|sau|toi))?'),
  W('tuan\\s+(?:nay|sau|toi)'),
  W('(?:cuoi|dau|giua)\\s+thang(?:\\s+(?:nay|sau|toi))?'),
  W('thang\\s+(?:nay|sau|toi)'),
  W('(?:\\d+|mot|hai|ba|bon|nam|sau|bay)\\s+(?:ngay|tuan|thang)\\s+(?:nua|toi|sau)'),
];

const VAGUE = [W('khi nao|luc nao|bao gio|som|sap toi|chua biet|khi nao ranh|luc ranh|dip nao|ranh thi|tien thi')];

/** Chỉ phân loại, không giải ngày. Cụm đã chuẩn hóa (không dấu, chữ thường) được so với các mẫu. */
export function classifyTime(phrase: string): TimeKind {
  const f = foldText(phrase);
  if (f.length === 0) return 'none';
  if (ABSOLUTE.some((r) => r.test(f))) return 'absolute';
  if (RELATIVE.some((r) => r.test(f))) return 'relative';
  if (VAGUE.some((r) => r.test(f))) return 'vague';
  return 'none';
}

/** Cụm tương đối hoặc mơ hồ thì Sale phải chọn ngày; hệ thống không tự suy ra. */
export function needsClarification(kind: TimeKind): boolean {
  return kind === 'relative' || kind === 'vague';
}
