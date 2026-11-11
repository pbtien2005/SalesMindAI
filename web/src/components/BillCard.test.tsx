import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaymentView } from '../api/types';
import { json, mockFetch, renderApp } from '../test/render';
import { BillCard } from './BillCard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pay = (over: Partial<PaymentView> = {}): PaymentView => ({
  id: 'p1',
  messageId: 'm1',
  status: 'proposed',
  readOk: true,
  amountVnd: 6_000_000,
  transferNote: 'Minh coc SF-021',
  billTime: '13/11/2026 10:09',
  bbox: { x: 0.05, y: 0.17, w: 0.9, h: 0.14 },
  simulatedReader: false,
  amountEdited: false,
  confirmedBy: null,
  verdict: 'ok',
  ratioPercent: 50,
  thresholdPercent: 50,
  orderTotalVnd: 12_000_000,
  ...over,
});
const show = (p: PaymentView) => renderApp(<BillCard payment={p} imageUrl="/api/demo/assets/bill-6000000.png" />);
const ok = () => mockFetch(() => json({ ok: true }));

describe('BillCard', () => {
  it('bill 6 triệu: hiện số tiền, so ngưỡng "đạt", vùng khoanh, nút xác nhận bật', () => {
    ok();
    show(pay());
    expect(screen.getByText('6.000.000 ₫ / 12.000.000 ₫ = 50%, đạt ngưỡng ≥ 50%')).toBeTruthy();
    expect(screen.getByTestId('bill-bbox')).toBeTruthy();
    expect(screen.getByText(/AI chỉ đọc số tiền, trạng thái thanh toán do Sale xác nhận/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Xác nhận đã cọc' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('bill 3 triệu: "dưới 50%" và KHÔNG có chữ nào nói đã đủ cọc', () => {
    ok();
    show(pay({ amountVnd: 3_000_000, ratioPercent: 25, verdict: 'below' }));
    expect(screen.getByText('3.000.000 ₫ / 12.000.000 ₫ = 25%, dưới 50%')).toBeTruthy();
    expect(screen.queryByText(/đạt ngưỡng/)).toBeNull();
    expect(screen.queryByText(/đủ điều kiện/)).toBeNull();
  });

  it('không đọc được: không có phần trăm, phải nhập tay mới xác nhận được', async () => {
    const f = ok();
    const user = userEvent.setup();
    show(pay({ readOk: false, amountVnd: null, transferNote: null, billTime: null, bbox: null, verdict: null, ratioPercent: null, thresholdPercent: null }));
    expect(screen.getByText(/Không đọc được số tiền: Sale nhập tay hoặc bỏ qua/)).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    const confirm = screen.getByRole('button', { name: 'Xác nhận đã cọc' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText('Số tiền Sale nhập (VND)'), '6000000');
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.body(0)).toEqual({ amountVnd: 6_000_000 });
  });

  it('bấm xác nhận hai lần liên tiếp chỉ gửi một request', async () => {
    const f = mockFetch(() => new Promise<Response>((resolve) => setTimeout(() => resolve(json({ ok: true })), 50)));
    const user = userEvent.setup();
    show(pay());
    const btn = screen.getByRole('button', { name: 'Xác nhận đã cọc' });
    await user.click(btn);
    await user.click(btn);
    await waitFor(() => expect(f.posts().length).toBeGreaterThan(0));
    expect(f.posts()).toHaveLength(1);
    expect(f.posts()[0]?.url).toBe('/api/payments/p1/confirm');
  });

  it('đã xác nhận: không còn nút, hiện người xác nhận; bộ đọc mô phỏng được nói rõ', () => {
    ok();
    show(pay({ status: 'confirmed', confirmedBy: 'Lan', simulatedReader: true }));
    expect(screen.getByText('Đã xác nhận bởi Lan')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xác nhận đã cọc' })).toBeNull();
    expect(screen.getByText(/bộ đọc mô phỏng/)).toBeTruthy();
  });
});
