import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEEDS_CLARIFICATION, type ConversationDetail } from '../api/types';
import { detail, evidenceOf, meLan, msg, proposal, summary } from '../test/fixtures';
import { json, mockFetch, renderApp } from '../test/render';
import { ChatView } from './ChatView';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const T1 = 'Chào shop, mình đang tìm sofa cho phòng khách, màu xám bên shop có mẫu nào không?';
const T2 = 'Khoảng tầm 15 triệu thôi bạn.';
const T3 = 'Số mình là 0912 345 678. Cuối tuần này mình ghé xem được không?';

function scene3(): ConversationDetail {
  return detail({
    summary: summary({ id: 'c-minh', displayName: 'Minh', followup: { count: 0, max: 5, stopped: false, suggestStop: false } }),
    messages: [
      msg('m1', T1, { sentAt: '2026-11-12T02:12:00.000Z' }),
      msg('m2', 'Dạ chào anh, bên em có mẫu sofa góc Oslo màu xám ạ.', { direction: 'outbound', senderKind: 'page_inbox', sentAt: '2026-11-12T02:15:00.000Z' }),
      msg('m3', T2, { sentAt: '2026-11-12T02:20:00.000Z' }),
      msg('m4', T3, { sentAt: '2026-11-13T02:40:00.000Z' }),
    ],
    autoFill: [
      proposal({ id: 'a1', field: 'product_interest', value: { text: 'Sofa phòng khách, màu xám' }, evidence: [evidenceOf('m1', T1, 'phòng khách, màu xám')] }),
      proposal({ id: 'a2', field: 'budget', value: { text: '15 triệu' }, evidence: [evidenceOf('m3', T2, 'tầm 15 triệu')] }),
    ],
    box: [
      { kind: 'proposal', ...proposal({ id: 'b1', field: 'phone', value: { text: '0912 345 678' }, evidence: [evidenceOf('m4', T3, '0912 345 678')] }) },
      {
        kind: 'proposal',
        ...proposal({ id: 'b2', field: 'timeline', value: { text: 'cuối tuần này', kind: 'vague', sentAt: '2026-11-13T02:40:00.000Z' }, evidence: [evidenceOf('m4', T3, 'Cuối tuần này')], flags: [NEEDS_CLARIFICATION] }),
      },
    ],
  });
}

function serve(d: ConversationDetail) {
  return mockFetch((url) => {
    if (url.startsWith('/api/inbox')) return json({ now: '2026-11-13T02:45:00.000Z', conversations: [d.summary] });
    if (url.startsWith('/api/conversations/') && !url.endsWith('stop-followup')) return json(d);
    if (url === '/api/demo/page-message') return json({ accepted: true }, 202);
    if (url.endsWith('stop-followup')) return json({ stopped: true });
    return json({ error: { code: 'not_found', message: url } }, 404);
  });
}

describe('ChatView: sửa giá trị AI điền', () => {
  it('Sale sửa sản phẩm AI điền sai: gửi action edit với giá trị mới', async () => {
    const d = scene3();
    const f = mockFetch((url) => {
      if (url.startsWith('/api/inbox')) return json({ now: '2026-11-13T02:45:00.000Z', conversations: [d.summary] });
      if (url.startsWith('/api/conversations/')) return json(d);
      return json({ proposalId: 'a1', field: 'product_interest', status: 'edited' });
    });
    const user = userEvent.setup();
    renderApp(<ChatView />);
    await screen.findByRole('heading', { name: 'Minh' });
    await user.click(screen.getByRole('button', { name: 'Sửa Sản phẩm quan tâm' }));
    const input = screen.getByLabelText('Giá trị đã sửa của Sản phẩm quan tâm');
    await user.clear(input);
    await user.type(input, 'Tủ giày');
    await user.click(screen.getByRole('button', { name: 'Lưu và duyệt' }));
    await waitFor(() => expect(f.posts().some((p) => p.url === '/api/proposals/a1/decide')).toBe(true));
    const i = f.posts().findIndex((p) => p.url === '/api/proposals/a1/decide');
    expect(f.body(i)).toEqual({ action: 'edit', editedText: 'Tủ giày' });
  });
});

describe('ChatView: tệp đính kèm', () => {
  it('hiện ảnh khách gửi và dùng nhãn cho tệp không có URL an toàn', async () => {
    const d = detail({
      summary: summary({ id: 'c-a', displayName: 'Hoa' }),
      messages: [
        msg('m1', '', { text: null, hasAttachment: true, attachments: [{ type: 'image', url: 'https://scontent.xx.fbcdn.net/a.jpg' }, { type: 'file', url: null }] }),
      ],
    });
    serve(d);
    renderApp(<ChatView />);
    await screen.findByRole('heading', { name: 'Hoa' });
    const img = screen.getByAltText('Ảnh khách gửi');
    expect(img.getAttribute('src')).toBe('https://scontent.xx.fbcdn.net/a.jpg');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.closest('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('[Tệp]')).toBeTruthy();
  });
});

describe('ChatView (cảnh 3)', () => {
  it('mở hội thoại đầu tiên và tô câu gốc trong tin của khách', async () => {
    serve(scene3());
    renderApp(<ChatView />);
    await screen.findByRole('heading', { name: 'Minh' });
    const chat = screen.getByRole('region', { name: 'Cuộc trò chuyện' });
    const marks = Array.from(chat.querySelectorAll('mark')).map((m) => m.textContent);
    expect(marks).toEqual(['phòng khách, màu xám', 'tầm 15 triệu', '0912 345 678', 'Cuối tuần này']);
  });

  it('tin do Lan gõ ở Page Inbox có nhãn Page Inbox và không bị tô', async () => {
    serve(scene3());
    renderApp(<ChatView />);
    await screen.findByRole('heading', { name: 'Minh' });
    const chat = screen.getByRole('region', { name: 'Cuộc trò chuyện' });
    expect(within(chat).getByText('Page Inbox')).toBeTruthy();
    expect(within(chat).queryAllByText('Khách, 09:12').length).toBe(1);
  });

  it('thẻ khách: trường nhẹ "AI điền, chưa duyệt", SĐT chờ duyệt, ngày hẹn "Cần xác nhận"', async () => {
    serve(scene3());
    renderApp(<ChatView />);
    await screen.findByRole('heading', { name: 'Minh' });
    const card = screen.getByRole('heading', { name: 'Thẻ khách' }).parentElement as HTMLElement;
    expect(within(card).getByText('Sofa phòng khách, màu xám')).toBeTruthy();
    expect(within(card).getByText('15 triệu')).toBeTruthy();
    expect(within(card).getAllByText('AI điền, chưa duyệt').length).toBe(2);
    expect(within(card).getByText('Chưa có, đang chờ duyệt đề xuất')).toBeTruthy();
    expect(within(card).getByText('Cần xác nhận')).toBeTruthy();
    expect(within(card).getByText('Chưa có ngày')).toBeTruthy();
    expect(within(card).getAllByText('Thiếu')).toHaveLength(3); // tên, số lượng, địa chỉ còn thiếu
  });

  it('Hộp đề xuất có 2 mục và nút Duyệt mốc hẹn đang khóa', async () => {
    serve(scene3());
    renderApp(<ChatView />);
    expect(await screen.findByText('2 chờ duyệt')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Duyệt (chọn ngày trước)' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Lan gõ tin giả lập: gọi page-message rồi xóa ô nhập', async () => {
    const f = serve(scene3());
    const user = userEvent.setup();
    renderApp(<ChatView />);
    await screen.findByRole('heading', { name: 'Minh' });
    const input = screen.getByLabelText('Tin trả lời của Lan (giả lập Page Inbox)') as HTMLInputElement;
    await user.type(input, 'Dạ vâng ạ');
    await user.click(screen.getByRole('button', { name: 'Gửi (giả lập)' }));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]?.url).toBe('/api/demo/page-message');
    expect(f.body(0)).toEqual({ conversationId: 'c-minh', text: 'Dạ vâng ạ' });
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('nút Gửi khóa khi ô nhập rỗng hoặc chỉ có khoảng trắng', async () => {
    serve(scene3());
    const user = userEvent.setup();
    renderApp(<ChatView />);
    await screen.findByRole('heading', { name: 'Minh' });
    const send = screen.getByRole('button', { name: 'Gửi (giả lập)' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.type(screen.getByLabelText('Tin trả lời của Lan (giả lập Page Inbox)'), '   ');
    expect(send.disabled).toBe(true);
  });

  it('"Ngừng bám" ở đầu khung chat cần xác nhận mới gọi API', async () => {
    const d = scene3();
    d.summary = { ...d.summary, followup: { count: 2, max: 5, stopped: false, suggestStop: false } };
    const f = serve(d);
    const user = userEvent.setup();
    renderApp(<ChatView />);
    await screen.findByRole('heading', { name: 'Minh' });
    await user.click(screen.getByRole('button', { name: 'Ngừng bám' }));
    expect(f.posts()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(f.posts()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Ngừng bám' }));
    await user.click(screen.getByRole('button', { name: 'Xác nhận ngừng bám' }));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]?.url).toBe('/api/conversations/c-minh/stop-followup');
  });

  it('đổi sang hội thoại đã có trong bộ nhớ đệm thì bản nháp và hộp xác nhận "Ngừng bám" không rò sang', async () => {
    const a = scene3();
    a.summary = { ...a.summary, id: 'c-a', displayName: 'Khách A', lastMessageAt: '2026-11-13T02:45:00.000Z', followup: { count: 2, max: 5, stopped: false, suggestStop: false } };
    const b = scene3();
    b.summary = { ...b.summary, id: 'c-b', displayName: 'Khách B', lastMessageAt: '2026-11-13T02:00:00.000Z', followup: { count: 2, max: 5, stopped: false, suggestStop: false } };
    const f = mockFetch((url) => {
      if (url.startsWith('/api/inbox')) return json({ now: '2026-11-13T02:45:00.000Z', conversations: [a.summary, b.summary] });
      if (url === '/api/conversations/c-a') return json(a);
      if (url === '/api/conversations/c-b') return json(b);
      return json({ error: { code: 'not_found', message: url } }, 404);
    });
    const user = userEvent.setup();
    renderApp(<ChatView />);
    await screen.findByRole('heading', { name: 'Khách A', level: 2 });
    // Mở B một lần để cả hai đã nằm trong bộ nhớ đệm.
    await user.click(screen.getByRole('button', { name: /Khách B/ }));
    await screen.findByRole('heading', { name: 'Khách B', level: 2 });
    await user.click(screen.getByRole('button', { name: /Khách A/ }));
    await screen.findByRole('heading', { name: 'Khách A', level: 2 });

    // Nay A -> B đều có dữ liệu sẵn, khung chat không bị gỡ ra giữa chừng.
    await user.type(screen.getByLabelText('Tin trả lời của Lan (giả lập Page Inbox)'), 'bản nháp cho A');
    await user.click(screen.getByRole('button', { name: 'Ngừng bám' }));
    expect(screen.getByText('Ngừng bám khách này?')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Khách B/ }));
    await screen.findByRole('heading', { name: 'Khách B', level: 2 });
    expect(screen.queryByText('Ngừng bám khách này?')).toBeNull();
    expect((screen.getByLabelText('Tin trả lời của Lan (giả lập Page Inbox)') as HTMLInputElement).value).toBe('');
    expect(f.posts()).toHaveLength(0);
  });

  it('cấu trúc: một h1, và Hộp đề xuất, Thẻ khách là h2', async () => {
    serve(scene3());
    renderApp(<ChatView />);
    await screen.findByRole('heading', { name: 'Minh' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: /Hộp đề xuất/ })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Thẻ khách' })).toBeTruthy();
  });

  it('hiện "Chưa ai trả lời" khi khách đang chờ Page', async () => {
    const d = scene3();
    d.summary = { ...d.summary, waitingOn: 'page', waitingMinutes: 8 };
    serve(d);
    renderApp(<ChatView />);
    expect((await screen.findByRole('status')).textContent).toBe('Chưa ai trả lời 8 phút');
  });

  it('không có dữ liệu demo (409): hướng dẫn chạy demo:reset', async () => {
    mockFetch(() => json({ error: { code: 'no_demo_data', message: 'Chưa có dữ liệu demo. Chạy: npm run cli -- demo:reset' } }, 409));
    renderApp(<ChatView />);
    expect(await screen.findByText('Chưa có dữ liệu demo')).toBeTruthy();
    expect(screen.getByText(/demo:reset/, { selector: 'div.mt-2' })).toBeTruthy();
  });

  it('hộp thư rỗng', async () => {
    mockFetch(() => json({ now: '2026-11-13T02:45:00.000Z', conversations: [] }));
    renderApp(<ChatView />);
    expect(await screen.findByText('Chưa có hội thoại nào.')).toBeTruthy();
    expect(screen.getByText('Khi có khách nhắn tới, cuộc trò chuyện sẽ hiện ở đây.')).toBeTruthy();
  });
});

describe('khung trả lời của doanh nghiệp thật (không demo)', () => {
  const real = { ...meLan, demoTenant: false, role: 'owner' as const, displayName: 'Chủ shop', email: 'chu@shop.vn' };

  function serverFor(reply: { open: boolean; closesAt: string | null; pageActive: boolean }) {
    const d = detail({ reply });
    return mockFetch(async (url) => {
      if (url.startsWith('/api/inbox')) return json({ now: '2026-11-13T02:45:00.000Z', conversations: [d.summary], nextCursor: null });
      if (url.startsWith('/api/conversations/') && url.endsWith('/send')) return json({ ok: true, messageId: 'm1' });
      if (url.startsWith('/api/conversations/')) return json(d);
      return json({ error: { code: 'not_found', message: url } }, 404);
    });
  }

  it('cửa sổ còn mở: gửi tin thật tới /send kèm khóa chống gửi trùng, rồi xóa ô nhập', async () => {
    const user = userEvent.setup();
    const f = serverFor({ open: true, closesAt: '2026-11-14T02:00:00.000Z', pageActive: true });
    renderApp(<ChatView />, real);
    await screen.findByRole('heading', { name: 'Anh Minh', level: 2 });
    const box = screen.getByLabelText('Tin trả lời cho khách') as HTMLInputElement;
    await user.type(box, 'Dạ em chào anh ạ');
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    await waitFor(() => expect(f.posts().some((p) => p.url.endsWith('/send'))).toBe(true));
    const post = f.posts().find((p) => p.url.endsWith('/send'))!;
    expect(JSON.parse(post.init.body as string)).toEqual({ text: 'Dạ em chào anh ạ' });
    expect(post.init.headers['idempotency-key']).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(post.init.headers['x-requested-with']).toBe('salesmind');
    await waitFor(() => expect(box.value).toBe(''));
    expect(f.posts().some((p) => p.url.endsWith('/page-message'))).toBe(false);
  });

  it('quá 24 giờ: không có ô gửi, báo rõ lý do', async () => {
    serverFor({ open: false, closesAt: '2026-11-12T02:00:00.000Z', pageActive: true });
    renderApp(<ChatView />, real);
    await screen.findByRole('heading', { name: 'Anh Minh', level: 2 });
    expect(screen.queryByLabelText('Tin trả lời cho khách')).toBeNull();
    expect(screen.getByText(/quá 24 giờ kể từ tin cuối/)).toBeTruthy();
  });

  it('Page cần kết nối lại: không có ô gửi, báo cách khắc phục', async () => {
    serverFor({ open: true, closesAt: null, pageActive: false });
    renderApp(<ChatView />, real);
    await screen.findByRole('heading', { name: 'Anh Minh', level: 2 });
    expect(screen.queryByLabelText('Tin trả lời cho khách')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('kết nối lại');
  });
});
