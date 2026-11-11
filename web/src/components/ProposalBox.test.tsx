import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEEDS_CLARIFICATION, type BoxItem } from '../api/types';
import { evidenceOf, msg, proposal } from '../test/fixtures';
import { json, mockFetch, renderApp } from '../test/render';
import { ProposalBox } from './ProposalBox';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PHONE_TEXT = 'Số mình là 0912 345 678. Cuối tuần này mình ghé xem được không?';
const messages = [msg('m3', PHONE_TEXT, { sentAt: '2026-11-13T02:40:00.000Z' })];

const phone: BoxItem = {
  kind: 'proposal',
  ...proposal({ id: 'p-phone', field: 'phone', value: { text: '0912 345 678' }, evidence: [evidenceOf('m3', PHONE_TEXT, '0912 345 678')] }),
};
const vague: BoxItem = {
  kind: 'proposal',
  ...proposal({
    id: 'p-time',
    field: 'timeline',
    value: { text: 'cuối tuần này', kind: 'vague', sentAt: '2026-11-13T02:40:00.000Z' },
    evidence: [evidenceOf('m3', PHONE_TEXT, 'Cuối tuần này')],
    flags: [NEEDS_CLARIFICATION],
  }),
};

const ok = () => mockFetch(() => json({ proposalId: 'x', field: 'x', status: 'accepted' }));
const show = (items: BoxItem[]) => renderApp(<ProposalBox conversationId="c1" items={items} messages={messages} onJump={() => {}} />);

describe('Hộp đề xuất: mốc hẹn mơ hồ', () => {
  it('ô chọn ngày để TRỐNG và nút Duyệt bị khóa (không tự điền ngày)', () => {
    ok();
    show([vague]);
    const input = screen.getByLabelText('Ngày giờ hẹn') as HTMLInputElement;
    expect(input.value).toBe('');
    const accept = screen.getByRole('button', { name: 'Duyệt (chọn ngày trước)' }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
  });

  it('hiện câu gốc và thời điểm khách nhắn, nhắc AI không tự suy ra ngày', () => {
    ok();
    show([vague]);
    expect(screen.getByText(/AI không tự suy ra ngày/).textContent).toContain('Khách nhắn Thứ Sáu 13/11 09:40');
    expect(screen.getByText('“cuối tuần này”')).toBeTruthy();
  });

  it('bấm Duyệt khi khóa không gọi API', async () => {
    const f = ok();
    const user = userEvent.setup();
    show([vague]);
    await user.click(screen.getByRole('button', { name: 'Duyệt (chọn ngày trước)' }));
    expect(f.posts()).toHaveLength(0);
  });

  it('chọn nhanh chỉ điền khi bấm, rồi Duyệt gửi đúng chosenAt', async () => {
    const f = ok();
    const user = userEvent.setup();
    show([vague]);
    await user.click(screen.getByRole('button', { name: 'Thứ Bảy 14/11 10:00' }));
    expect((screen.getByLabelText('Ngày giờ hẹn') as HTMLInputElement).value).toBe('2026-11-14T10:00');

    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]?.url).toBe('/api/proposals/p-time/decide');
    expect(f.body(0)).toEqual({ action: 'accept', chosenAt: '2026-11-14T10:00:00+07:00' });
  });

  it('xóa ô chọn thì nút Duyệt khóa lại', async () => {
    ok();
    const user = userEvent.setup();
    show([vague]);
    await user.click(screen.getByRole('button', { name: 'Chủ Nhật 15/11 10:00' }));
    expect((screen.getByRole('button', { name: 'Duyệt' }) as HTMLButtonElement).disabled).toBe(false);
    await user.clear(screen.getByLabelText('Ngày giờ hẹn'));
    expect((screen.getByRole('button', { name: 'Duyệt (chọn ngày trước)' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('server từ chối 422 needs_date thì hiện lỗi tại chỗ', async () => {
    mockFetch(() => json({ error: { code: 'needs_date', message: 'Phải chọn ngày hẹn.' } }, 422));
    const user = userEvent.setup();
    show([vague]);
    await user.click(screen.getByRole('button', { name: 'Thứ Bảy 14/11 10:00' }));
    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Phải chọn ngày hẹn.');
  });

  it('Bỏ qua gửi dismiss, không kèm ngày', async () => {
    const f = ok();
    const user = userEvent.setup();
    show([vague]);
    await user.click(screen.getByRole('button', { name: 'Bỏ qua' }));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.body(0)).toEqual({ action: 'dismiss' });
  });

  it('mốc hẹn rõ ràng (không cờ) không bắt chọn ngày', async () => {
    const f = ok();
    const user = userEvent.setup();
    const clear: BoxItem = { kind: 'proposal', ...proposal({ id: 'p-clear', field: 'timeline', value: { text: '14/11 lúc 10h', kind: 'absolute' } }) };
    show([clear]);
    expect(screen.queryByLabelText('Ngày giờ hẹn')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.body(0)).toEqual({ action: 'accept' });
  });
});

describe('Hộp đề xuất: SĐT', () => {
  it('hiện số, câu gốc có đoạn tô vàng và lời nhắc đã kiểm tra định dạng', () => {
    ok();
    show([phone]);
    expect(screen.getByText('0912 345 678', { selector: 'div' })).toBeTruthy();
    const mark = document.querySelector('mark');
    expect(mark?.textContent).toBe('0912 345 678');
    expect(screen.getByText(/đã kiểm tra định dạng số di động/)).toBeTruthy();
  });

  it('Duyệt gửi accept', async () => {
    const f = ok();
    const user = userEvent.setup();
    show([phone]);
    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]?.url).toBe('/api/proposals/p-phone/decide');
    expect(f.body(0)).toEqual({ action: 'accept' });
  });

  it('ô Sửa điền sẵn đúng dạng đang hiển thị (có chia nhóm), không phải dạng thô', async () => {
    ok();
    const user = userEvent.setup();
    const raw: BoxItem = { kind: 'proposal', ...proposal({ id: 'p-raw', field: 'phone', value: { text: '0912345678' } }) };
    show([raw]);
    expect(screen.getByText('0912 345 678', { selector: 'div' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sửa' }));
    expect((screen.getByLabelText('Giá trị đã sửa của Số điện thoại') as HTMLInputElement).value).toBe('0912 345 678');
  });

  it('Sửa rồi Lưu gửi edit kèm editedText; Hủy không gọi API', async () => {
    const f = ok();
    const user = userEvent.setup();
    show([phone]);
    await user.click(screen.getByRole('button', { name: 'Sửa' }));
    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(f.posts()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Sửa' }));
    const input = screen.getByLabelText('Giá trị đã sửa của Số điện thoại');
    await user.clear(input);
    await user.type(input, '0912 345 679');
    await user.click(screen.getByRole('button', { name: 'Lưu và duyệt' }));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.body(0)).toEqual({ action: 'edit', editedText: '0912 345 679' });
  });

  it('không cho lưu giá trị sửa rỗng', async () => {
    ok();
    const user = userEvent.setup();
    show([phone]);
    await user.click(screen.getByRole('button', { name: 'Sửa' }));
    await user.clear(screen.getByLabelText('Giá trị đã sửa của Số điện thoại'));
    expect((screen.getByRole('button', { name: 'Lưu và duyệt' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('409 not_pending hiện thông báo và làm mới dữ liệu', async () => {
    mockFetch(() => json({ error: { code: 'not_pending', message: 'Đề xuất đã được xử lý.' } }, 409));
    const user = userEvent.setup();
    show([phone]);
    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Đề xuất đã được xử lý.');
  });
});

describe('Hộp đề xuất: ngừng bám và trạng thái rỗng', () => {
  it('đề xuất ngừng bám: chỉ gọi stop-followup khi Sale bấm xác nhận', async () => {
    const f = mockFetch(() => json({ stopped: true }));
    const user = userEvent.setup();
    show([{ kind: 'stop_followup', reason: '5/5 lượt bám, khách không phản hồi', count: 5, max: 5 }]);
    expect(screen.getByText('Hệ thống chỉ đề xuất, việc bỏ bám do Sale xác nhận.')).toBeTruthy();
    expect(f.posts()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Xác nhận ngừng bám' }));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]?.url).toBe('/api/conversations/c1/stop-followup');
  });

  it('không có đề xuất: báo rỗng, không có số chờ duyệt', () => {
    ok();
    show([]);
    expect(screen.getByText('Chưa có đề xuất nào cần duyệt.')).toBeTruthy();
    expect(screen.queryByText(/chờ duyệt/)).toBeNull();
  });

  it('đếm số mục chờ duyệt', () => {
    ok();
    show([phone, vague]);
    expect(screen.getByText('2 chờ duyệt')).toBeTruthy();
  });
});

describe('Hộp đề xuất: Duyệt nhiều mục', () => {
  it('khóa tới khi chọn ngày hẹn, rồi gửi mốc hẹn trước và SĐT sau', async () => {
    const f = ok();
    const user = userEvent.setup();
    show([phone, vague]);
    const bulk = screen.getByRole('button', { name: /Duyệt 2 mục/ }) as HTMLButtonElement;
    expect(bulk.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Thứ Bảy 14/11 10:00' }));
    const ready = screen.getByRole('button', { name: 'Duyệt 2 mục' }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    await user.click(ready);
    await waitFor(() => expect(f.posts()).toHaveLength(2));
    expect(f.posts()[0]?.url).toBe('/api/proposals/p-time/decide');
    expect(f.body(0)).toEqual({ action: 'accept', chosenAt: '2026-11-14T10:00:00+07:00' });
    expect(f.posts()[1]?.url).toBe('/api/proposals/p-phone/decide');
    expect(f.body(1)).toEqual({ action: 'accept' });
  });

  it('dừng ở mục đầu tiên thất bại và báo lỗi', async () => {
    const f = mockFetch(() => json({ error: { code: 'past_date', message: 'Ngày giờ hẹn đã qua.' } }, 422));
    const user = userEvent.setup();
    show([phone, vague]);
    await user.click(screen.getByRole('button', { name: 'Thứ Bảy 14/11 10:00' }));
    await user.click(screen.getByRole('button', { name: 'Duyệt 2 mục' }));
    await screen.findByText(/Ngày giờ hẹn đã qua/);
    expect(f.posts()).toHaveLength(1);
  });
});
