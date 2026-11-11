/**
 * Bộ đọc MÔ PHỎNG: tra bảng theo SHA-256 của hai ảnh bill mẫu (`demo-assets/`). KHÔNG phải AI và không đọc được ảnh lạ.
 * Chỉ là đường lui khi mạng hoặc API AI lỗi giữa buổi demo; giao diện ghi rõ "bộ đọc mô phỏng".
 */
import { createHash } from 'node:crypto';
import type { BillImage, BillReader, BillReadOutcome } from './types.js';

export const OFFLINE_BILL_MODEL = 'offline-lookup';

const KNOWN: Record<string, BillReadOutcome> = {
  // bill-6000000.png
  fd105e46d15d28cd13eb7c4051fab955142e1da76b504c85f49a349a242553de: { kind: 'ok', amountVnd: 6_000_000, transferNote: 'Minh coc SF-021', billTime: '13/11/2026 10:09', bbox: { x: 0.05, y: 0.17, w: 0.9, h: 0.14 } },
  // bill-3000000.png
  '4223355f6d4a2295aea353f9855bc663945e6236b497d844badc322507c1287e': { kind: 'ok', amountVnd: 3_000_000, transferNote: 'Minh coc SF-021', billTime: '13/11/2026 10:09', bbox: { x: 0.05, y: 0.17, w: 0.9, h: 0.14 } },
};

export class OfflineBillReader implements BillReader {
  readonly model = OFFLINE_BILL_MODEL;
  async read(image: BillImage): Promise<BillReadOutcome> {
    const hash = createHash('sha256').update(image.bytes).digest('hex');
    return KNOWN[hash] ?? { kind: 'unreadable' };
  }
}
