import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../api/types';
import { meHa, meLan } from '../test/fixtures';
import { SessionProvider } from '../state/session';
import { TopBar } from './TopBar';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit & { headers: Record<string, string> } }));
const posts = () => calls().filter((c) => c.init.method === 'POST');

function renderBar(me: Me = meLan) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider me={me}>
        <TopBar />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/now') return json({ now: '2026-11-13T02:30:00.000Z', role: 'sale', roleName: 'Lan' });
    if (url === '/api/clock/advance') return json({ now: '2026-11-13T03:30:00.000Z' });
    if (url === '/api/demo/reset') return json({ now: '2026-11-12T02:00:00.000Z' });
    return json({ error: { code: 'not_found', message: `${init?.method ?? 'GET'} ${url}` } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TopBar', () => {
  it('hiện đồng hồ lấy từ server theo giờ VN', async () => {
    renderBar();
    expect(await screen.findByText('Thứ Sáu 13/11 09:30')).toBeTruthy();
  });

  it('+1 giờ và +24 giờ gửi đúng số phút', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: '+1 giờ' }));
    await user.click(screen.getByRole('button', { name: '+24 giờ' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts().map((p) => JSON.parse(p.init.body as string))).toEqual([{ minutes: 60 }, { minutes: 1440 }]);
  });

  it('Đặt lại demo cần xác nhận: bấm một lần chưa gọi API', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: 'Đặt lại demo' }));
    expect(posts()).toHaveLength(0);
    expect(screen.getByText('Xóa dữ liệu demo?')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(posts()).toHaveLength(0);
    expect(screen.queryByText('Xóa dữ liệu demo?')).toBeNull();
  });

  it('xác nhận thì mới gọi /api/demo/reset', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: 'Đặt lại demo' }));
    await user.click(screen.getByRole('button', { name: 'Đặt lại' }));
    await waitFor(() => expect(posts().map((p) => p.url)).toEqual(['/api/demo/reset']));
  });

  it('vào nhanh (demo): Lan đang được chọn; bấm chị Hà gọi demo-login đúng người', async () => {
    const user = userEvent.setup();
    renderBar();
    expect(screen.getByRole('button', { name: 'Lan (Sale)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Chị Hà (Quản lý)' }).getAttribute('aria-pressed')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Chị Hà (Quản lý)' }));
    await waitFor(() => expect(posts().map((p) => p.url)).toEqual(['/api/auth/demo-login']));
    expect(JSON.parse(posts()[0]!.init.body as string)).toEqual({ as: 'ha' });
    expect(posts()[0]!.init.headers['x-requested-with']).toBe('salesmind');
  });

  it('hiện tên và vai trò người đăng nhập; "Đăng xuất" gọi logout', async () => {
    const user = userEvent.setup();
    renderBar(meHa);
    expect(screen.getByText('chị Hà')).toBeTruthy();
    expect(screen.getByText('Quản lý')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    await waitFor(() => expect(posts().map((p) => p.url)).toEqual(['/api/auth/logout']));
  });

  it('doanh nghiệp thường (không demo): không có đồng hồ, Đặt lại, Giả lập hay vào nhanh', () => {
    renderBar({ ...meLan, demoTenant: false, email: 'chu@shop.vn', displayName: 'Chủ shop', role: 'owner' });
    for (const name of ['+1 giờ', '+24 giờ', 'Đặt lại demo', 'Giả lập', 'Lan (Sale)']) {
      expect(screen.queryByRole('button', { name }), name).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeTruthy();
    expect(screen.getByText('Chủ doanh nghiệp')).toBeTruthy();
  });

  it('hiện lỗi của thao tác ghi', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/now' ? json({ now: '2026-11-13T02:30:00.000Z', role: 'sale', roleName: 'Lan' }) : json({ error: { code: 'invalid', message: 'Không tua lùi được.' } }, 400),
    );
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: '+1 giờ' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Không tua lùi được.');
  });
});
