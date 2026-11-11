/** Tìm mã hàng (ví dụ `SF-021`) trong tin của khách, kèm vị trí để làm câu gốc. Trích bằng code, không qua mô hình. */
export interface SkuMatch {
  value: string;
  start: number;
  end: number;
  text: string;
}

export function findSkus(text: string): SkuMatch[] {
  const out: SkuMatch[] = [];
  for (const m of text.matchAll(/(?<![A-Za-z0-9-])[A-Z]{2,3}-\d{2,4}(?![A-Za-z0-9-])/giu)) {
    const start = m.index ?? 0;
    out.push({ value: m[0].toUpperCase(), start, end: start + m[0].length, text: m[0] });
  }
  return out;
}
