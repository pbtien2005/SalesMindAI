import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { HomeData } from './api/types';
import { detail, meHa, summary } from './test/fixtures';
import { json, mockFetch, renderApp, type Handler } from './test/render';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Thứ Năm 12/11/2026 09:00 giờ VN, đúng cảnh 0.
const NOW = '2026-11-12T02:00:00.000Z';

const thu = summary({ id: 'thu', displayName: 'Chị Thu', isP1: true, isNew: false, waitingMinutes: 22, lastMessageText: 'Mình chuyển khoản luôn được không bạn?' });
const duc = summary({ id: 'duc', displayName: 'Anh Đức', isNew: false, waitingOn: 'customer' });
const mai = summary({ id: 'mai', displayName: 'Cô Mai', isNew: false, waitingOn: 'customer', followup: { count: 4, max: 5, stopped: false, suggestStop: false, due: false, dueAt: null } });

const HOME: HomeData = {
  now: NOW,
  role: 'sale',
  p1: [thu],
  overdue: [
    { taskId: 't1', conversationId: 'duc', displayName: 'Anh Đức', title: 'Gọi lại báo giá', dueAt: '2026-11-09T08:00:00.000Z' },
    { taskId: 't2', conversationId: 'ngoc', displayName: 'Chị Ngọc', title: 'Nhắc thanh toán', dueAt: '2026-11-11T10:00:00.000Z' },
  ],
  reminders: [
    { kind: 'overdue', conversationId: 'duc', displayName: 'Anh Đức', title: 'Gọi lại báo giá', dueAt: '2026-11-09T08:00:00.000Z' },
    { kind: 'overdue', conversationId: 'ngoc', displayName: 'Chị Ngọc', title: 'Nhắc thanh toán', dueAt: '2026-11-11T10:00:00.000Z' },
    { kind: 'followup', conversationId: 'mai', displayName: 'Cô Mai', title: 'Bám 4/5', dueAt: null },
    { kind: 'upcoming', conversationId: 'minh', displayName: 'Anh Minh', title: 'Khách hẹn ghé xem', dueAt: '2026-11-14T03:00:00.000Z' },
  ],
  suggestStop: [],
  ai: { autoFilled: 3, saleEdited: 1, askedDate: 1, approved: 3 },
};

/** Trả Response để thay câu trả lời mặc định, hoặc undefined để dùng mặc định. */
type Override = (url: string, init: Parameters<Handler>[1]) => Response | undefined | Promise<Response | undefined>;

function server(over: Partial<{ home: HomeData; conversations: unknown[] }> = {}, extra?: Override) {
  return mockFetch(async (url, init) => {
    const custom = await extra?.(url, init);
    if (custom) return custom;
    if (url === '/api/now') return json({ now: NOW, role: 'sale', roleName: 'Lan' });
    if (url === '/api/home') return json(over.home ?? HOME);
    if (url.startsWith('/api/inbox')) return json({ now: NOW, conversations: over.conversations ?? [thu, duc, mai] });
    if (url === '/api/personas') return json({ personas: [{ key: 'minh', displayName: 'Facebook: anh Minh' }, { key: 'thu', displayName: 'Chị Thu' }] });
    if (url.startsWith('/api/conversations/')) return json(detail({ summary: thu }));
    if (url === '/api/demo/customer-message') return json({ accepted: true, conversationId: 'c' }, 202);
    if (url === '/api/demo/page-message') return json({ accepted: true }, 202);
    if (url === '/api/clock/advance') return json({ now: NOW });
    return json({ error: { code: 'not_found', message: url } }, 404);
  });
}

describe('Trang chủ (cảnh 0)', () => {
  it('hiện bốn thẻ: P1, quá hạn, lịch nhắc và tiền cọc hôm nay', async () => {
    server();
    renderApp(<App />);
    expect(await screen.findByRole('heading', { name: 'Trang chủ của Lan' })).toBeTruthy();
    const main = screen.getByRole('main');
    expect(within(main).getByText('Khách ưu tiên P1').nextElementSibling?.textContent).toBe('1');
    expect(within(main).getByText('Chờ lâu nhất: Chị Thu, 22 phút')).toBeTruthy();
    expect(within(main).queryByRole('button', { name: /Xem tất cả/ })).toBeNull(); // chỉ 1 khách P1: không cần "Xem tất cả"
    expect(within(main).getByText('Việc quá hạn', { selector: 'div' }).nextElementSibling?.textContent).toBe('2');
    expect(within(main).getByText('Anh Đức, Chị Ngọc')).toBeTruthy();
    expect(within(main).getByText('Lịch nhắc sắp tới').nextElementSibling?.textContent).toBe('2');
    expect(within(main).getByText('1 việc sắp đến hạn, 0 khách đến hạn bám, 1 khách đang được bám')).toBeTruthy();
    expect(within(main).getByText('Tiền cọc hôm nay').nextElementSibling?.textContent).toBe('0 ₫');
  });

  it('danh sách nhắc: quá hạn tính theo ngày lịch, bám, sắp tới', async () => {
    server();
    renderApp(<App />);
    const list = await screen.findByRole('region', { name: 'Việc quá hạn và lịch nhắc' });
    expect(within(list).getByText('Quá hạn 3 ngày')).toBeTruthy(); // hạn Thứ Hai 09/11 15:00, nay Thứ Năm 12/11
    expect(within(list).getByText('Hạn Thứ Hai 09/11 15:00')).toBeTruthy();
    expect(within(list).getByText('Quá hạn 1 ngày')).toBeTruthy();
    expect(within(list).getByText('Bám 4/5')).toBeTruthy();
    expect(within(list).getByText('Sắp tới')).toBeTruthy();
    expect(within(list).getByText('Thứ Bảy 14/11 10:00')).toBeTruthy();
  });

  it('dòng nhắc bám: đến hạn thì nói rõ "đến hạn bám lại", chưa đến hạn thì nói lúc nào đến hạn', async () => {
    server({
      home: {
        ...HOME,
        reminders: [
          { kind: 'followup', conversationId: 'lua', displayName: 'Chị Lụa', title: 'Đến hạn bám lần 1/5', dueAt: '2026-11-11T02:00:00.000Z' },
          { kind: 'followup', conversationId: 'mai', displayName: 'Cô Mai', title: 'Bám 2/5', dueAt: '2026-11-12T10:00:00.000Z' },
        ],
      },
    });
    renderApp(<App />);
    const list = await screen.findByRole('region', { name: 'Việc quá hạn và lịch nhắc' });
    expect(within(list).getByText('Đến hạn bám lần 1/5')).toBeTruthy();
    expect(within(list).getByText('Đã quá 24 giờ kể từ tin cuối, khách chưa phản hồi: đến hạn bám lại')).toBeTruthy();
    expect(within(list).getByText('Bám 2/5')).toBeTruthy();
    expect(within(list).getByText(/Đang được bám, đến hạn lần tiếp theo lúc/)).toBeTruthy();
  });

  it('bấm một dòng nhắc mở hội thoại tương ứng', async () => {
    server();
    const user = userEvent.setup();
    renderApp(<App />);
    const list = await screen.findByRole('region', { name: 'Việc quá hạn và lịch nhắc' });
    await user.click(within(list).getByRole('button', { name: /Cô Mai: bám lại khách/ }));
    expect(await screen.findByRole('region', { name: 'Cuộc trò chuyện' })).toBeTruthy();
  });

  it('"Mở hội thoại" ở thẻ P1 mở khách P1', async () => {
    const f = server();
    const user = userEvent.setup();
    renderApp(<App />);
    await user.click(await screen.findByRole('button', { name: 'Mở hội thoại' }));
    await screen.findByRole('region', { name: 'Cuộc trò chuyện' });
    expect(f.calls().some((c) => c.url === '/api/conversations/thu')).toBe(true);
  });

  it('không có gì: các thẻ báo rỗng', async () => {
    server({ home: { ...HOME, p1: [], overdue: [], reminders: [], ai: { autoFilled: 0, saleEdited: 0, askedDate: 0, approved: 0 } } });
    renderApp(<App />);
    expect(await screen.findByText('Không có khách nào chờ quá lâu')).toBeTruthy();
    expect(screen.getByText('Không có việc quá hạn')).toBeTruthy();
    expect(screen.getByText('Chưa có lịch nhắc')).toBeTruthy();
    expect(screen.getByText('Không có việc nào cần nhắc.')).toBeTruthy();
  });

  it('chưa có dữ liệu demo: hướng dẫn thay vì màn trống', async () => {
    mockFetch((url) => (url === '/api/now' ? json({ now: NOW, role: 'sale', roleName: 'Lan' }) : json({ error: { code: 'no_demo_data', message: 'Chưa có dữ liệu demo.' } }, 409)));
    renderApp(<App />);
    expect(await screen.findByText('Chưa có dữ liệu demo')).toBeTruthy();
  });
});

describe('Trợ năng cơ bản', () => {
  it('có liên kết bỏ qua tới nội dung chính và vùng main khớp', async () => {
    server();
    renderApp(<App />);
    await screen.findByRole('heading', { name: 'Trang chủ của Lan' });
    const skip = screen.getByRole('link', { name: 'Bỏ qua tới nội dung chính' });
    expect(skip.getAttribute('href')).toBe('#main');
    expect(screen.getByRole('main').id).toBe('main');
  });

  it('nút điều hướng chỉ trang hiện tại bằng aria-current', async () => {
    server();
    renderApp(<App />);
    await screen.findByRole('heading', { name: 'Trang chủ của Lan' });
    expect(screen.getByRole('button', { name: 'Trang chủ' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Hội thoại' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('Trang chủ (cảnh 6): chị Hà và số liệu AI', () => {
  it('quản lý (chị Hà): tiêu đề "đội của", hiện 4 số liệu AI', async () => {
    server();
    renderApp(<App />, meHa);
    expect(await screen.findByRole('heading', { name: 'Trang chủ, đội của chị Hà' })).toBeTruthy();
    const ai = screen.getByRole('region', { name: 'Số liệu AI' });
    const stat = (label: string) => within(ai).getByText(label).previousElementSibling?.textContent;
    expect(stat('Trường AI tự điền')).toBe('3');
    expect(stat('Lần Sale phải sửa')).toBe('1');
    expect(stat('Mốc hẹn AI hỏi lại ngày')).toBe('1');
    expect(stat('Đề xuất đã được duyệt')).toBe('3');
  });
});

describe('Bảng Giả lập', () => {
  const open = async () => {
    const user = userEvent.setup();
    renderApp(<App />);
    await screen.findByRole('heading', { name: 'Trang chủ của Lan' });
    await user.click(screen.getByRole('button', { name: 'Giả lập' }));
    return { user, panel: await screen.findByRole('complementary', { name: 'Bảng Giả lập' }) };
  };

  it('ẩn mặc định, mở bằng nút Giả lập và đóng bằng nút × hoặc Esc', async () => {
    server();
    const { user, panel } = await open();
    expect(screen.getByRole('button', { name: 'Giả lập' }).getAttribute('aria-expanded')).toBe('true');
    await user.click(within(panel).getByRole('button', { name: 'Đóng bảng Giả lập' }));
    expect(screen.queryByRole('complementary', { name: 'Bảng Giả lập' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Giả lập' }));
    const again = await screen.findByRole('complementary', { name: 'Bảng Giả lập' });
    await user.type(within(again).getByLabelText('Nội dung tin', { selector: '#sim-customer-text' }), '{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Bảng Giả lập' })).toBeNull();
  });

  it('mở thì focus vào bảng, đóng bằng Esc thì focus về nút Giả lập', async () => {
    server();
    const { panel } = await open();
    expect(document.activeElement).toBe(panel);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Bảng Giả lập' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Giả lập' }));
  });

  it('Esc trong danh sách chọn không đóng cả bảng', async () => {
    server();
    const { panel } = await open();
    const select = within(panel).getByLabelText('Khách');
    select.focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Bảng Giả lập' })).not.toBeNull();
  });

  it('gửi như khách: câu mẫu cảnh 3 được điền khi bấm, gửi đúng persona và nội dung, rồi xóa ô', async () => {
    const f = server();
    const { user, panel } = await open();
    const text = within(panel).getByLabelText('Nội dung tin', { selector: '#sim-customer-text' }) as HTMLTextAreaElement;
    expect(text.value).toBe('');
    expect((within(panel).getByRole('button', { name: 'Gửi như khách' }) as HTMLButtonElement).disabled).toBe(true);

    await user.selectOptions(within(panel).getByLabelText('Khách'), 'minh');
    await user.click(within(panel).getByRole('button', { name: 'Cảnh 3' }));
    expect(text.value).toContain('0912 345 678');
    await user.click(within(panel).getByRole('button', { name: 'Gửi như khách' }));
    await waitFor(() => expect(f.posts().filter((p) => p.url === '/api/demo/customer-message')).toHaveLength(1));
    expect(f.body(0)).toEqual({ persona: 'minh', text: 'Anh Minh đây, hôm qua bận quá. SĐT anh 0912 345 678. Cuối tuần này anh ghé shop xem được không?' });
    await waitFor(() => expect(text.value).toBe(''));
    expect(await within(panel).findByText('Đã gửi. AI trích xuất sau vài giây.')).toBeTruthy();
  });

  it('Lan trả lời: gửi đúng hội thoại được chọn tới page-message', async () => {
    const f = server();
    const { user, panel } = await open();
    await user.selectOptions(within(panel).getByLabelText('Hội thoại'), 'mai');
    await user.type(within(panel).getByLabelText('Nội dung tin', { selector: '#sim-page-text' }), 'Dạ em chào cô ạ');
    await user.click(within(panel).getByRole('button', { name: 'Gửi như Lan' }));
    await waitFor(() => expect(f.posts().filter((p) => p.url === '/api/demo/page-message')).toHaveLength(1));
    expect(f.body(0)).toEqual({ conversationId: 'mai', text: 'Dạ em chào cô ạ' });
  });

  it('tua đồng hồ tới mốc cảnh 2 gửi đúng thời điểm có múi giờ +07:00', async () => {
    const f = server();
    const { user, panel } = await open();
    await user.click(within(panel).getByRole('button', { name: 'Cảnh 2: Thứ Sáu 13/11 09:30' }));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]?.url).toBe('/api/clock/advance');
    expect(f.body(0)).toEqual({ to: '2026-11-13T09:30:00+07:00' });
  });

  it('tua lùi bị server từ chối thì hiện lỗi', async () => {
    server({}, (url) => (url === '/api/clock/advance' ? json({ error: { code: 'invalid', message: 'Đồng hồ demo không tua lùi được.' } }, 400) : undefined));
    const { user, panel } = await open();
    await user.click(within(panel).getByRole('button', { name: 'Cảnh 1: Thứ Năm 12/11 09:05' }));
    expect((await within(panel).findByRole('alert')).textContent).toContain('không tua lùi được');
  });
});

describe('Việc quá hạn và lịch sử duyệt (cảnh 6)', () => {
  const overdueServer = () =>
    server({}, (url) => {
      if (url === '/api/overdue') return json({ now: NOW, overdue: HOME.overdue });
      if (url.endsWith('/history'))
        return json({
          history: [
            { kind: 'proposal', field: 'budget', proposedValue: { text: '≈ 15.000.000 ₫' }, decidedValue: { text: '15.000.000 ₫' }, status: 'accepted', decidedBy: 'Lan', at: '2026-11-11T03:00:00.000Z', evidence: [] },
          ],
        });
      return undefined;
    });

  it('bấm thẻ "Việc quá hạn" hiện đúng 2 việc kèm số ngày quá hạn', async () => {
    overdueServer();
    const user = userEvent.setup();
    renderApp(<App />);
    await user.click(await screen.findByRole('button', { name: /Việc quá hạn: 2/ }));
    const main = screen.getByRole('main');
    expect(await within(main).findByText('Anh Đức')).toBeTruthy();
    expect(within(main).getByText('Chị Ngọc')).toBeTruthy();
    expect(within(main).getByText('Quá hạn 3 ngày')).toBeTruthy();
    expect(within(main).getByText('Quá hạn 1 ngày')).toBeTruthy();
  });

  it('bấm một việc mở hội thoại và hiện lịch sử duyệt với người duyệt', async () => {
    overdueServer();
    const user = userEvent.setup();
    renderApp(<App />);
    await user.click(await screen.findByRole('button', { name: /Việc quá hạn: 2/ }));
    await user.click(await screen.findByRole('button', { name: /Anh Đức/ }));
    const history = await screen.findByRole('region', { name: 'Lịch sử duyệt' });
    expect(await within(history).findByText(/AI đề xuất Ngân sách: ≈ 15.000.000 ₫ · đã duyệt/)).toBeTruthy();
    expect(within(history).getByText(/bởi Lan/)).toBeTruthy();
  });
});

describe('Tiền cọc hôm nay và màn Đơn hàng (cảnh 6)', () => {
  it('Trang chủ hiện số tiền cọc đã xác nhận; bấm thẻ mở màn Đơn hàng với đúng số liệu', async () => {
    server({ home: { ...HOME, depositToday: 6_000_000 } }, (url) => {
      if (url === '/api/orders')
        return json({
          orders: [{ id: 'o1', conversationId: 'minh', code: 'DH-0001', status: 'confirmed', customerName: 'Anh Minh', productName: 'Sofa Milan xám', sku: 'SF-021', quantity: 1, totalVnd: 12_000_000, depositPaidVnd: 6_000_000, remainingVnd: 6_000_000, createdAt: '2026-11-13T03:20:00.000Z' }],
        });
      return undefined;
    });
    const user = userEvent.setup();
    renderApp(<App />);
    const card = await screen.findByRole('button', { name: /Tiền cọc hôm nay: 6\.000\.000/ });
    expect(within(card).getByText('6.000.000 ₫')).toBeTruthy();
    await user.click(card);
    const table = await screen.findByRole('table', { name: 'Danh sách đơn hàng' });
    const row = within(table).getByText('#DH-0001').closest('tr')!;
    expect(within(row).getByText('Anh Minh')).toBeTruthy();
    expect(within(row).getByText('1 × Sofa Milan xám (SF-021)')).toBeTruthy();
    expect(within(row).getAllByText('6.000.000 ₫')).toHaveLength(2); // đã cọc và còn lại
    expect(within(row).getByText('12.000.000 ₫')).toBeTruthy();
    expect(within(row).getByText('Đã tạo')).toBeTruthy();
  });
});
