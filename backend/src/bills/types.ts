/** Bộ đọc ảnh bill chuyển khoản. AI chỉ ĐỌC số tiền; trạng thái thanh toán do Sale xác nhận. */
export interface BillImage {
  bytes: Uint8Array;
  mediaType: 'image/png' | 'image/jpeg';
}

export interface BillBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BillReadOutcome =
  | { kind: 'ok'; amountVnd: number; transferNote: string | null; billTime: string | null; bbox: BillBox | null; usage?: { inputTokens: number; outputTokens: number } }
  | { kind: 'unreadable' | 'refused' | 'invalid'; usage?: { inputTokens: number; outputTokens: number } };

export interface BillReader {
  /** Ghi vào `payments.read_model`; bộ đọc mô phỏng phải có tên khác bộ đọc AI thật để giao diện nói rõ. */
  readonly model: string;
  /** Lỗi tạm thời (mạng, 429, 5xx) thì NÉM lỗi để hàng đợi retry. */
  read(image: BillImage): Promise<BillReadOutcome>;
}

export const MAX_AMOUNT_VND = 10_000_000_000;

/** Số tiền phải là số nguyên dương hợp lý; vùng khoanh phải nằm trong [0,1] (ngoài thì bỏ, không ném). */
export function normalizeOutcome(o: { amountVnd: unknown; transferNote?: unknown; billTime?: unknown; bbox?: unknown }): BillReadOutcome {
  const a = o.amountVnd;
  if (typeof a !== 'number' || !Number.isInteger(a) || a < 1 || a > MAX_AMOUNT_VND) return { kind: 'invalid' };
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);
  let bbox: BillBox | null = null;
  const b = o.bbox as Partial<BillBox> | null | undefined;
  if (b && [b.x, b.y, b.w, b.h].every((n) => typeof n === 'number' && n >= 0 && n <= 1) && b.w! > 0 && b.h! > 0 && b.x! + b.w! <= 1.0001 && b.y! + b.h! <= 1.0001) {
    bbox = { x: b.x!, y: b.y!, w: b.w!, h: b.h! };
  }
  return { kind: 'ok', amountVnd: a, transferNote: text(o.transferNote, 200), billTime: text(o.billTime, 60), bbox };
}
