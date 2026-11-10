import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { summary } from '../test/fixtures';
import { InboxList } from './InboxList';

afterEach(cleanup);

const NOW = '2026-11-12T02:00:00.000Z';
const list = [
  summary({ id: 'thu', displayName: 'Chị Thu', isP1: true, isNew: false, waitingMinutes: 22, lastMessageText: 'Mình chuyển khoản luôn được không bạn?' }),
  summary({ id: 'minh', displayName: 'Anh Minh', isNew: true, waitingMinutes: 8 }),
  summary({ id: 'duc', displayName: 'Anh Đức', isNew: false, waitingOn: 'customer', waitingMinutes: 1500, lastMessageAt: '2026-11-11T02:00:00Z', lastMessageText: 'Để mình hỏi vợ rồi báo lại nhé', followup: { count: 3, max: 5, stopped: false, suggestStop: false } }),
  summary({ id: 'mai', displayName: 'Cô Mai', isNew: false, waitingOn: 'customer', followup: { count: 5, max: 5, stopped: false, suggestStop: true } }),
  summary({ id: 'ngoc', displayName: 'Chị Ngọc', isNew: false, waitingOn: 'customer', followup: { count: 5, max: 5, stopped: true, suggestStop: false } }),
];

const show = (selectedId: string | null = null, onSelect = vi.fn()) => {
  render(<InboxList conversations={list} now={NOW} selectedId={selectedId} onSelect={onSelect} />);
  return onSelect;
};

describe('InboxList', () => {
  it('đếm đúng ở ba bộ lọc', () => {
    show();
    expect(screen.getByRole('button', { name: 'Tất cả 5' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chưa trả lời 2' })).toBeTruthy(); // thu, minh chờ Page
    expect(screen.getByRole('button', { name: 'Ưu tiên P1 1' })).toBeTruthy();
  });

  it('hiện P1, Mới, thời gian chờ và bộ đếm bám', () => {
    show();
    const thu = screen.getByRole('button', { name: /Chị Thu/ });
    expect(within(thu).getByText('P1')).toBeTruthy();
    expect(within(thu).getByText('chờ 22 phút')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /Anh Minh/ })).getByText('Mới')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /Anh Đức/ })).getByText('Bám 3/5')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /Cô Mai/ })).getByText('Bám 5/5, đề xuất ngừng')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /Chị Ngọc/ })).getByText('Đã ngừng bám')).toBeTruthy();
  });

  it('lọc P1 và Chưa trả lời', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Ưu tiên P1 1' }));
    expect(screen.getAllByRole('button', { name: /^(Chị|Anh|Cô)/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Chưa trả lời 2' }));
    expect(screen.getByRole('button', { name: /Anh Minh/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cô Mai/ })).toBeNull();
  });

  it('tìm không dấu: "duc" ra Anh Đức', async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText('Tìm khách'), 'duc');
    expect(screen.getByRole('button', { name: /Anh Đức/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Chị Thu/ })).toBeNull();
  });

  it('không khớp thì báo rỗng', async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText('Tìm khách'), 'zzz');
    expect(screen.getByText('Không có hội thoại khớp.')).toBeTruthy();
  });

  it('chọn hội thoại gọi onSelect với id; mục đang chọn có aria-current', async () => {
    const user = userEvent.setup();
    const onSelect = show('minh');
    expect(screen.getByRole('button', { name: /Anh Minh/ }).getAttribute('aria-current')).toBe('true');
    await user.click(screen.getByRole('button', { name: /Chị Thu/ }));
    expect(onSelect).toHaveBeenCalledWith('thu');
  });
});
