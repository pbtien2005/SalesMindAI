/**
 * Kiểm chứng câu gốc: một câu mô hình đưa ra chỉ được chấp nhận nếu nó là chuỗi con của tin khách đã lưu.
 * Kết quả luôn là đoạn cắt từ văn bản GỐC (`text.slice(start, end)`), không bao giờ là chuỗi do mô hình viết.
 *
 * So khớp không phân biệt hoa thường, dấu tiếng Việt và khoảng trắng thừa, để "Tầm 15  triệu" khớp "tam 15 trieu".
 * Offset tính theo đơn vị UTF-16 (như `String.prototype.slice`), đúng thứ giao diện cần để tô đoạn khớp.
 * Không khớp mờ: gần giống mà không phải chuỗi con thì bị loại.
 */

export interface Located {
  start: number;
  end: number;
  /** Đoạn gốc `original.slice(start, end)`. */
  text: string;
}

interface Folded {
  /** Chuỗi đã chuẩn hóa (không dấu, chữ thường, khoảng trắng gộp). */
  norm: string;
  /** Với mỗi ký tự của `norm`: vị trí bắt đầu trong văn bản gốc. */
  starts: number[];
  /** Với mỗi ký tự của `norm`: vị trí ngay sau nó trong văn bản gốc. */
  ends: number[];
}

const COMBINING = /\p{M}/u;
const WHITESPACE = /\s/u;

function foldCodePoint(cp: string): string {
  const base = cp.normalize('NFD').replace(/\p{M}/gu, '');
  return base.replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

/** Chuẩn hóa kèm bảng ánh xạ ngược về văn bản gốc. */
function foldWithMap(text: string): Folded {
  let norm = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const cp of text) {
    const next = i + cp.length;
    if (COMBINING.test(cp)) {
      // Dấu rời (văn bản dạng NFD): thuộc về ký tự đứng trước.
      if (ends.length > 0) ends[ends.length - 1] = next;
    } else if (WHITESPACE.test(cp)) {
      if (norm.length > 0 && norm[norm.length - 1] !== ' ') {
        norm += ' ';
        starts.push(i);
        ends.push(next);
      } else if (ends.length > 0) {
        ends[ends.length - 1] = next; // gộp khoảng trắng liên tiếp
      }
    } else {
      const folded = foldCodePoint(cp);
      // Mỗi ĐƠN VỊ UTF-16 một mục (ký tự ngoài BMP như emoji chiếm hai), vì `indexOf` trả chỉ số theo đơn vị UTF-16.
      for (let k = 0; k < folded.length; k++) {
        norm += folded[k];
        starts.push(i);
        ends.push(next);
      }
    }
    i = next;
  }
  return { norm, starts, ends };
}

/** Chuẩn hóa để so khớp (dùng chung cho bộ phân loại thời gian): không dấu, chữ thường, gộp khoảng trắng, cắt hai đầu. */
export function foldText(text: string): string {
  return foldWithMap(text).norm.trim();
}

/**
 * Tìm `quote` trong `original`. Trả về đoạn khớp đầu tiên (offset theo văn bản gốc) hoặc null nếu quote
 * rỗng hoặc không phải chuỗi con.
 */
export function locateQuote(original: string, quote: string): Located | null {
  const q = foldText(quote);
  if (q.length === 0) return null;
  const { norm, starts, ends } = foldWithMap(original);
  const idx = norm.indexOf(q);
  if (idx < 0) return null;
  const start = starts[idx]!;
  const end = ends[idx + q.length - 1]!;
  return { start, end, text: original.slice(start, end) };
}
