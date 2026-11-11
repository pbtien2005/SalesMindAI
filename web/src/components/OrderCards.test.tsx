import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderView, ReplyDraftView } from '../api/types';
import { json, mockFetch, renderApp } from '../test/render';
import { DepositCard } from './DepositCard';
import { OrderDraftCard, ReplyDraftCard } from './OrderDraftCard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const order = (over: Partial<OrderView> = {}): OrderView => ({
  id: 'o1',
  code: null,
  status: 'draft',
  customerName: 'Minh',
  phone: null,
  address: null,
  sku: 'SF-021',
  productName: 'Sofa Milan xám',
  quantity: 1,
  unitPriceVnd: 12_000_000,
  totalVnd: 12_000_000,
  depositRequiredVnd: 6_000_000,
  depositPaidVnd: 0,
  flags: [],
  saleEdited: false,
  ...over,
});
const draft: ReplyDraftView = { id: 'd1', orderId: 'o1', kind: 'confirm_order', text: 'Dạ em xác nhận đơn: 1 bộ Sofa Milan xám (SF-021), 12.000.000 ₫.' };
const ok = () => mockFetch(() => json({ ok: true, orderStatus: 'awaiting_deposit', code: 'DH-0001' }));

describe('OrderDraftCard', () => {
  it('trường thiếu có nhãn "Thiếu" (SĐT, địa chỉ) và nhắc AI chỉ điền nháp', () => {
    ok();
    renderApp(<OrderDraftCard order={order()} />);
    expect(screen.getAllByText('Thiếu')).toHaveLength(2);
    expect(screen.getByText(/AI chỉ điền nháp, Sale phải kiểm tra lại/)).toBeTruthy();
    expect(screen.getByText('Sofa Milan xám (SF-021)')).toBeTruthy();
  });

  it('lưu địa chỉ gửi đúng giá trị đã cắt khoảng trắng', async () => {
    const f = ok();
    const user = userEvent.setup();
    renderApp(<OrderDraftCard order={order()} />);
    await user.type(screen.getByLabelText('Địa chỉ nhận hàng'), '  12 Lê Lợi, Q1 ');
    await user.click(screen.getByRole('button', { name: 'Lưu địa chỉ' }));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]?.url).toBe('/api/orders/o1/update');
    expect(f.body(0)).toEqual({ address: '12 Lê Lợi, Q1' });
  });

  it('cờ price_mismatch được giải thích', () => {
    ok();
    renderApp(<OrderDraftCard order={order({ flags: ['price_mismatch'] })} />);
    expect(screen.getByRole('note').textContent).toContain('giá niêm yết');
  });
});

describe('ReplyDraftCard', () => {
  it('nút Gửi gửi đúng văn bản đã sửa, đúng một lần, và ghi rõ demo', async () => {
    const f = ok();
    const user = userEvent.setup();
    renderApp(<ReplyDraftCard draft={draft} conversationId="c1" />);
    expect(screen.getByText('Soạn sẵn từ đơn nháp')).toBeTruthy();
    expect(screen.getByText('Demo: tin chưa gửi tới Facebook')).toBeTruthy();
    const box = screen.getByLabelText('Nội dung tin gửi khách');
    await user.clear(box);
    await user.type(box, 'Dạ em chào anh');
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]?.url).toBe('/api/reply-drafts/d1/send');
    expect(f.body(0)).toEqual({ text: 'Dạ em chào anh' });
    await screen.findByText('Đã gửi.');
  });

  it('ô trống thì nút Gửi bị khóa', async () => {
    ok();
    const user = userEvent.setup();
    renderApp(<ReplyDraftCard draft={draft} conversationId="c1" />);
    await user.clear(screen.getByLabelText('Nội dung tin gửi khách'));
    expect((screen.getByRole('button', { name: 'Gửi' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('gửi lỗi thì hiện lỗi, tin nháp còn nguyên', async () => {
    mockFetch(() => json({ error: { code: 'window_closed', message: 'Đã quá 24 giờ.' } }, 422));
    const user = userEvent.setup();
    renderApp(<ReplyDraftCard draft={draft} conversationId="c1" />);
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    await screen.findByText(/Đã quá 24 giờ/);
    expect((screen.getByLabelText('Nội dung tin gửi khách') as HTMLTextAreaElement).value).toBe(draft.text);
  });
});

describe('DepositCard (Tạo đơn)', () => {
  const ready = order({ status: 'awaiting_deposit', depositPaidVnd: 6_000_000 });

  it('chỉ hiện khi đã đủ cọc', () => {
    ok();
    const { container } = renderApp(<DepositCard order={order({ status: 'awaiting_deposit', depositPaidVnd: 3_000_000 })} />);
    expect(container.textContent).toBe('');
  });

  it('nút khóa tới khi nhập địa chỉ hợp lệ; tạo xong báo mã đơn', async () => {
    const f = ok();
    const user = userEvent.setup();
    renderApp(<DepositCard order={ready} />);
    const btn = screen.getByRole('button', { name: 'Xác nhận tạo đơn' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await user.type(screen.getByLabelText('Địa chỉ nhận hàng'), 'abc');
    expect(btn.disabled).toBe(true);
    await user.type(screen.getByLabelText('Địa chỉ nhận hàng'), 'defg Lê Lợi');
    expect(btn.disabled).toBe(false);
    await user.click(btn);
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]?.url).toBe('/api/orders/o1/confirm');
    expect((await screen.findByRole('status')).textContent).toContain('Đã tạo đơn #DH-0001');
  });
});
