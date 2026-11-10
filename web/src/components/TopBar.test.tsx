import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiRole } from '../api/client';
import { SessionProvider } from '../state/session';
import { TopBar } from './TopBar';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit & { headers: Record<string, string> } }));
const posts = () => calls().filter((c) => c.init.method === 'POST');

function renderBar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <TopBar />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setApiRole('lan');
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/now') return json({ now: '2026-11-13T02:30:00.000Z', role: 'lan', roleName: 'Lan' });
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

  it('đổi vai trò: nút aria-pressed và request sau đó mang header ha', async () => {
    const user = userEvent.setup();
    renderBar();
    const lan = screen.getByRole('button', { name: 'Lan (Sale)' });
    const ha = screen.getByRole('button', { name: 'Chị Hà (Quản lý)' });
    expect(lan.getAttribute('aria-pressed')).toBe('true');
    expect(ha.getAttribute('aria-pressed')).toBe('false');

    await user.click(ha);
    expect(ha.getAttribute('aria-pressed')).toBe('true');
    expect(lan.getAttribute('aria-pressed')).toBe('false');

    await user.click(screen.getByRole('button', { name: '+1 giờ' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.init.headers['x-demo-role']).toBe('ha');
  });

  it('hiện lỗi của thao tác ghi', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/now' ? json({ now: '2026-11-13T02:30:00.000Z', role: 'lan', roleName: 'Lan' }) : json({ error: { code: 'invalid', message: 'Không tua lùi được.' } }, 400),
    );
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: '+1 giờ' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Không tua lùi được.');
  });
});
