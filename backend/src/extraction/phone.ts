/**
 * Nhận diện số điện thoại di động Việt Nam bằng code (không nhờ mô hình): đầu số 0, 84 hoặc +84, rồi 3, 5, 7, 8 hoặc 9
 * và 8 chữ số nữa. Cho phép dấu cách, chấm, gạch ngang giữa các chữ số. Số 11 chữ số kiểu cũ (01xx) và chuỗi số dài
 * hơn (số tài khoản, mã đơn) không được coi là SĐT, cũng không cắt một đoạn ra từ chuỗi số dài.
 */

export interface PhoneMatch {
  /** Dạng chuẩn, 10 chữ số bắt đầu bằng 0 (ví dụ `0912345678`). */
  value: string;
  start: number;
  end: number;
  /** Đoạn gốc đúng như khách gõ. */
  text: string;
}

const SEP = '[\\s.\\-]?';
const PHONE = new RegExp(`(?<![\\d+])(?:\\+?84|0)${SEP}[35789](?:${SEP}\\d){8}(?!\\d)`, 'gu');

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.startsWith('84') ? `0${digits.slice(2)}` : digits;
}

export function findPhones(text: string): PhoneMatch[] {
  const out: PhoneMatch[] = [];
  for (const m of text.matchAll(PHONE)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const value = normalizePhone(raw);
    // "0" + 9 chữ số, hoặc "84" + 9 chữ số đã đổi về dạng 0xxxxxxxxx: luôn đúng 10 chữ số.
    if (value.length !== 10) continue;
    out.push({ value, start, end: start + raw.length, text: raw });
  }
  return out;
}
