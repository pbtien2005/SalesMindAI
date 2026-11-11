import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../api/types';
import { evidenceOf, msg } from '../test/fixtures';
import { json, mockFetch, renderApp } from '../test/render';
import { HistoryPanel } from './HistoryPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const T1 = 'Chào shop, anh đang tìm sofa phòng khách tầm 15 triệu';
const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  kind: 'proposal',
  field: 'budget',
  proposedValue: { text: 'tầm 15 triệu' },
  decidedValue: { text: 'tầm 15 triệu' },
  status: 'accepted',
  decidedBy: 'Lan',
  at: '2026-11-11T03:00:00.000Z',
  evidence: [evidenceOf('m1', T1, 'tầm 15 triệu')],
  ...over,
});

function show(history: HistoryEntry[], onJump = vi.fn()) {
  mockFetch(() => json({ history }));
  renderApp(<HistoryPanel conversationId="c1" messages={[msg('m1', T1)]} onJump={onJump} />);
  return onJump;
}

describe('HistoryPanel: căn cứ thu gọn', () => {
  it('giá trị đã duyệt vẫn truy được về câu gốc, mặc định đóng', async () => {
    const user = userEvent.setup();
    show([entry()]);
    expect(await screen.findByText(/đã duyệt/)).toBeTruthy();
    expect(screen.getByText(/bởi Lan/)).toBeTruthy();
    expect(screen.queryByText(/Câu gốc:/)).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Căn cứ Ngân sách' });
    await user.click(toggle);
    expect(screen.getByText(/Câu gốc:/)).toBeTruthy();
    expect(screen.getByText('tầm 15 triệu', { selector: 'mark' })).toBeTruthy();
    await user.click(toggle);
    expect(screen.queryByText(/Câu gốc:/)).toBeNull();
  });

  it('"xem trong chat" nhảy tới đúng tin', async () => {
    const user = userEvent.setup();
    const onJump = show([entry()]);
    await user.click(await screen.findByRole('button', { name: 'Căn cứ Ngân sách' }));
    await user.click(screen.getByRole('button', { name: 'xem trong chat' }));
    expect(onJump).toHaveBeenCalledWith('m1');
  });

  it('mục không có câu gốc thì không có nút Căn cứ', async () => {
    show([entry({ evidence: [] })]);
    await screen.findByText(/đã duyệt/);
    expect(screen.queryByRole('button', { name: /Căn cứ/ })).toBeNull();
  });
});
