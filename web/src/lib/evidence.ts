/**
 * Tô câu gốc trong tin của khách. `start`/`end` của backend tính theo đơn vị UTF-16 nên dùng được với `String.slice`.
 * Nguyên tắc sản phẩm: chỉ hiển thị câu gốc đã kiểm chứng là chuỗi con của tin đã lưu. Nếu offset không khớp
 * với chữ trong `evidence.text` (lệch dữ liệu) thì KHÔNG tô, thay vì tô nhầm chỗ.
 */
import type { Evidence } from '../api/types';

export interface Segment {
  text: string;
  mark: boolean;
}

interface Range {
  start: number;
  end: number;
}

/** Giữ lại những câu gốc thật sự khớp với văn bản tin. */
export function validRanges(text: string, evidences: Evidence[]): Range[] {
  return evidences
    .filter((e) => Number.isInteger(e.start) && Number.isInteger(e.end) && e.start >= 0 && e.end > e.start && e.end <= text.length && text.slice(e.start, e.end) === e.text)
    .map((e) => ({ start: e.start, end: e.end }));
}

/** Cắt văn bản thành các đoạn, đánh dấu đoạn thuộc câu gốc. Đoạn chồng nhau được gộp. */
export function segmentText(text: string, evidences: Evidence[]): Segment[] {
  const sorted = validRanges(text, evidences).sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of sorted) {
    const last = merged.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }

  const out: Segment[] = [];
  let pos = 0;
  for (const r of merged) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start), mark: false });
    out.push({ text: text.slice(r.start, r.end), mark: true });
    pos = r.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), mark: false });
  return out.length > 0 ? out : [{ text, mark: false }];
}

export interface QuoteContext {
  before: string;
  match: string;
  after: string;
  cutBefore: boolean;
  cutAfter: boolean;
}

/** Câu gốc kèm một ít chữ xung quanh ("…Số mình là **0912 345 678**. Cuối…"). Trả null nếu offset không khớp. */
export function quoteContext(text: string, ev: Evidence, pad = 24): QuoteContext | null {
  if (validRanges(text, [ev]).length === 0) return null;
  const from = Math.max(0, ev.start - pad);
  const to = Math.min(text.length, ev.end + pad);
  return {
    before: text.slice(from, ev.start),
    match: text.slice(ev.start, ev.end),
    after: text.slice(ev.end, to),
    cutBefore: from > 0,
    cutAfter: to < text.length,
  };
}
