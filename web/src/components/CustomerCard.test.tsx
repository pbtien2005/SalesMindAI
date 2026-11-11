import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationDetail } from '../api/types';
import { detail, evidenceOf, msg, proposal, summary } from '../test/fixtures';
import { json, mockFetch, renderApp } from '../test/render';
import { CustomerCard } from './CustomerCard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const T1 = 'Chào shop, anh đang tìm sofa phòng khách tầm 15 triệu';

function scene(): ConversationDetail {
  return detail({
    summary: summary({ id: 'c1', displayName: 'Minh' }),
    messages: [msg('m1', T1)],
    autoFill: [
      proposal({ id: 'a1', field: 'product_interest', value: { text: 'sofa phòng khách' }, evidence: [evidenceOf('m1', T1, 'sofa phòng khách')] }),
      proposal({ id: 'a2', field: 'budget', value: { text: 'tầm 15 triệu' }, evidence: [evidenceOf('m1', T1, 'tầm 15 triệu')] }),
    ],
  });
}

const ok = () => mockFetch(() => json({ proposalId: 'x', field: 'budget', status: 'accepted' }));
const show = (d: ConversationDetail) => renderApp(<CustomerCard detail={d} onJump={() => {}} />);

describe('CustomerCard: một nút duyệt chung', () => {
  it('hiện nút kèm số dòng AI điền đang chờ', () => {
    ok();
    show(scene());
    expect(screen.getByRole('button', { name: 'Duyệt thông tin AI điền (2)' })).toBeTruthy();
  });

  it('bấm duyệt gửi accept cho từng dòng chờ, đúng một lần mỗi dòng', async () => {
    const f = ok();
    const user = userEvent.setup();
    show(scene());
    await user.click(screen.getByRole('button', { name: 'Duyệt thông tin AI điền (2)' }));
    await waitFor(() => expect(f.posts()).toHaveLength(2));
    expect(f.posts().map((p) => p.url)).toEqual(['/api/proposals/a1/decide', '/api/proposals/a2/decide']);
    expect(f.body(0)).toEqual({ action: 'accept' });
    expect(f.body(1)).toEqual({ action: 'accept' });
  });

  it('bấm hai lần liên tiếp không gửi trùng', async () => {
    const f = mockFetch(() => new Promise<Response>((resolve) => setTimeout(() => resolve(json({ ok: true })), 40)));
    const user = userEvent.setup();
    show(scene());
    const btn = screen.getByRole('button', { name: 'Duyệt thông tin AI điền (2)' });
    await user.click(btn);
    await user.click(btn);
    await waitFor(() => expect(f.posts()).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 150));
    expect(f.posts()).toHaveLength(2);
  });

  it('lỗi ở dòng đầu thì dừng, hiện lỗi, không gửi dòng sau', async () => {
    const f = mockFetch(() => json({ error: { code: 'not_pending', message: 'Đề xuất đã được xử lý.' } }, 409));
    const user = userEvent.setup();
    show(scene());
    await user.click(screen.getByRole('button', { name: 'Duyệt thông tin AI điền (2)' }));
    await screen.findByText(/Đề xuất đã được xử lý/);
    expect(f.posts()).toHaveLength(1);
  });

  it('không có dòng AI điền chờ duyệt thì không hiện nút', () => {
    ok();
    show(detail({ summary: summary({ id: 'c1', displayName: 'Minh' }), messages: [msg('m1', T1)] }));
    expect(screen.queryByRole('button', { name: /Duyệt thông tin AI điền/ })).toBeNull();
  });

  it('Sửa từng dòng vẫn dùng được', async () => {
    const f = ok();
    const user = userEvent.setup();
    show(scene());
    await user.click(screen.getByRole('button', { name: 'Sửa Ngân sách' }));
    const input = screen.getByLabelText('Giá trị đã sửa của Ngân sách');
    await user.clear(input);
    await user.type(input, '20 triệu');
    await user.click(screen.getByRole('button', { name: 'Lưu và duyệt' }));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]?.url).toBe('/api/proposals/a2/decide');
    expect(f.body(0)).toEqual({ action: 'edit', editedText: '20 triệu' });
  });
});

describe('CustomerCard: căn cứ thu gọn', () => {
  it('mặc định không hiện câu gốc; bấm "Căn cứ" mở, bấm lại đóng', async () => {
    ok();
    const user = userEvent.setup();
    show(scene());
    expect(screen.queryByText(/Câu gốc:/)).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Căn cứ Ngân sách' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const quote = screen.getByText(/Câu gốc:/).closest('div')!;
    expect(within(quote).getByText('tầm 15 triệu').tagName).toBe('MARK');
    await user.click(toggle);
    expect(screen.queryByText(/Câu gốc:/)).toBeNull();
  });

  it('mỗi dòng có nút căn cứ riêng, mở dòng này không mở dòng kia', async () => {
    ok();
    const user = userEvent.setup();
    show(scene());
    await user.click(screen.getByRole('button', { name: 'Căn cứ Sản phẩm quan tâm' }));
    expect(screen.getAllByText(/Câu gốc:/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Căn cứ Ngân sách' }).getAttribute('aria-expanded')).toBe('false');
  });
});
