import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeData, Me } from '../api/types';
import { setUnauthorizedHandler } from '../api/client';
import { meLan, summary } from '../test/fixtures';
import { json, mockFetch } from '../test/render';
import { AuthGate } from './AuthGate';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
  window.history.replaceState(null, '', '/');
});
beforeEach(() => window.history.replaceState(null, '', '/'));

const NOW = '2026-11-12T02:00:00.000Z';
const HOME: HomeData = { now: NOW, role: 'sale', p1: [], overdue: [], reminders: [], suggestStop: [], ai: { autoFilled: 0, saleEdited: 0, askedDate: 0, approved: 0 } };
const hung: Me = { ...meLan, id: 'u-hung', email: 'hung@shop.vn', displayName: 'Hùng', demoTenant: false };

interface World {
  user: Me | null;
  config: { signupOpen: boolean; demoLogin: boolean };
  password: string;
  homeStatus: number;
}

function server(w: World) {
  return mockFetch(async (url, init) => {
    if (url === '/api/auth/config') return json(w.config);
    if (url === '/api/auth/me') return w.user ? json({ user: w.user }) : json({ error: { code: 'unauthenticated', message: 'Chưa đăng nhập.' } }, 401);
    if (url === '/api/auth/login') {
      const b = JSON.parse(init.body as string);
      if (b.password !== w.password) return json({ error: { code: 'invalid_credentials', message: 'Email hoặc mật khẩu không đúng.' } }, 401);
      w.user = hung;
      return json({ ok: true });
    }
    if (url === '/api/auth/demo-login') {
      w.user = meLan;
      return json({ ok: true });
    }
    if (url === '/api/auth/logout') {
      w.user = null;
      return json({ ok: true });
    }
    if (!w.user) return json({ error: { code: 'unauthenticated', message: 'Chưa đăng nhập.' } }, 401);
    if (url === '/api/home') return w.homeStatus === 200 ? json(HOME) : json({ error: { code: 'unauthenticated', message: 'Hết phiên.' } }, w.homeStatus);
    if (url.startsWith('/api/inbox')) return json({ now: NOW, conversations: [summary()] });
    if (url === '/api/now') return json({ now: NOW, role: w.user.role, roleName: w.user.displayName });
    return json({ error: { code: 'not_found', message: url } }, 404);
  });
}

const world = (over: Partial<World> = {}): World => ({ user: null, config: { signupOpen: false, demoLogin: false }, password: 'mat-khau-dai-123', homeStatus: 200, ...over });

function renderGate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthGate />
    </QueryClientProvider>,
  );
}

describe('cổng đăng nhập', () => {
  it('chưa đăng nhập: hiện màn đăng nhập, không có nút vào nhanh hay tạo tài khoản khi server không bật', async () => {
    server(world());
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Vào với tư cách/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tạo tài khoản' })).toBeNull();
  });

  it('sai mật khẩu: hiện đúng một thông báo chung và vẫn ở màn đăng nhập', async () => {
    const user = userEvent.setup();
    server(world());
    renderGate();
    await user.type(await screen.findByLabelText('Email'), 'hung@shop.vn');
    await user.type(screen.getByLabelText('Mật khẩu'), 'sai-mat-khau-1');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Email hoặc mật khẩu không đúng.');
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeTruthy();
  });

  it('đăng nhập đúng: gửi email và mật khẩu, vào Trang chủ với tên người dùng', async () => {
    const user = userEvent.setup();
    const f = server(world());
    renderGate();
    await user.type(await screen.findByLabelText('Email'), '  hung@shop.vn ');
    await user.type(screen.getByLabelText('Mật khẩu'), 'mat-khau-dai-123');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByRole('heading', { name: 'Trang chủ của Hùng' })).toBeTruthy();
    expect(f.body(0)).toEqual({ email: 'hung@shop.vn', password: 'mat-khau-dai-123' });
    expect(f.posts()[0]!.init.headers['x-requested-with']).toBe('salesmind');
  });

  it('demo: nút vào nhanh chỉ hiện khi server bật và đưa vào ứng dụng', async () => {
    const user = userEvent.setup();
    server(world({ config: { signupOpen: false, demoLogin: true } }));
    renderGate();
    await user.click(await screen.findByRole('button', { name: 'Vào với tư cách Lan' }));
    expect(await screen.findByRole('heading', { name: 'Trang chủ của Lan' })).toBeTruthy();
  });

  it('đã có phiên: vào thẳng ứng dụng, không thấy màn đăng nhập', async () => {
    server(world({ user: hung }));
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Trang chủ của Hùng' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Đăng nhập' })).toBeNull();
  });

  it('phiên hết hạn giữa chừng (route nghiệp vụ trả 401) thì quay về đăng nhập', async () => {
    const w = world({ user: hung });
    server(w);
    renderGate();
    await screen.findByRole('heading', { name: 'Trang chủ của Hùng' });
    w.user = null; // server thu hồi phiên
    w.homeStatus = 401;
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Trang chủ của Hùng' })).toBeNull(), { timeout: 5000 });
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeTruthy();
  });

  it('đăng xuất rồi đăng nhập người khác: không còn dữ liệu của người trước', async () => {
    const user = userEvent.setup();
    const w = world({ user: hung, config: { signupOpen: false, demoLogin: true } });
    const f = server(w);
    renderGate();
    await screen.findByRole('heading', { name: 'Trang chủ của Hùng' });
    await user.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeTruthy();
    expect(screen.queryByText('Trang chủ của Hùng')).toBeNull();
    const homesBefore = f.calls().filter((c) => c.url === '/api/home').length;
    await user.click(screen.getByRole('button', { name: 'Vào với tư cách Lan' }));
    expect(await screen.findByRole('heading', { name: 'Trang chủ của Lan' })).toBeTruthy();
    // Đọc lại từ server cho người mới (không dùng cache của người trước).
    expect(f.calls().filter((c) => c.url === '/api/home').length).toBeGreaterThan(homesBefore);
  });
});

describe('liên kết trong thư', () => {
  it('?reset=<token>: đặt mật khẩu mới gọi đúng API, rồi quay về đăng nhập và xóa token khỏi URL', async () => {
    const token = 'a'.repeat(43);
    window.history.replaceState(null, '', `/?reset=${token}`);
    const user = userEvent.setup();
    const f = mockFetch(async (url) => {
      if (url === '/api/auth/reset') return json({ ok: true });
      if (url === '/api/auth/config') return json({ signupOpen: false, demoLogin: false });
      return json({ error: { code: 'unauthenticated', message: 'x' } }, 401);
    });
    renderGate();
    await user.type(await screen.findByLabelText(/Mật khẩu mới/), 'mat-khau-moi-456');
    await user.click(screen.getByRole('button', { name: 'Đặt mật khẩu mới' }));
    expect(f.body(0)).toEqual({ token, password: 'mat-khau-moi-456' });
    await user.click(await screen.findByRole('button', { name: 'Đăng nhập' }));
    expect(window.location.search).toBe('');
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeTruthy();
  });

  it('?verify=<token>: gọi xác minh đúng một lần và báo kết quả', async () => {
    const token = 'b'.repeat(43);
    window.history.replaceState(null, '', `/?verify=${token}`);
    const f = mockFetch(async (url) => (url === '/api/auth/verify-email' ? json({ ok: true }) : json({ error: { code: 'unauthenticated', message: 'x' } }, 401)));
    renderGate();
    expect(await screen.findByText(/Đã xác minh email/)).toBeTruthy();
    expect(f.posts().filter((p) => p.url === '/api/auth/verify-email')).toHaveLength(1);
  });

  it('token trong URL sai định dạng thì bỏ qua, không gọi API', async () => {
    window.history.replaceState(null, '', '/?reset=<script>');
    const f = server(world());
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeTruthy();
    expect(f.posts()).toHaveLength(0);
  });
});

describe('lời mời vào doanh nghiệp', () => {
  it('?invite=<token>: hiện tên doanh nghiệp, người nhận đặt tên và mật khẩu rồi vào ứng dụng', async () => {
    const token = 'c'.repeat(43);
    window.history.replaceState(null, '', `/?invite=${token}`);
    const user = userEvent.setup();
    let joined = false;
    const f = mockFetch(async (url) => {
      if (url === '/api/auth/invite-info') return json({ tenantName: 'Nội thất ABC', role: 'sale', email: null });
      if (url === '/api/auth/accept-invite') {
        joined = true;
        return json({ ok: true }, 201);
      }
      if (url === '/api/auth/me') return joined ? json({ user: hung }) : json({ error: { code: 'unauthenticated', message: 'x' } }, 401);
      if (url === '/api/home') return json(HOME);
      if (url.startsWith('/api/inbox')) return json({ now: NOW, conversations: [] });
      return json({ error: { code: 'not_found', message: url } }, 404);
    });
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Tham gia Nội thất ABC' })).toBeTruthy();
    await user.type(screen.getByLabelText('Tên của bạn'), 'Hùng');
    await user.type(screen.getByLabelText('Email'), 'hung@shop.vn');
    await user.type(screen.getByLabelText(/Mật khẩu/), 'mat-khau-dai-123');
    await user.click(screen.getByRole('button', { name: 'Tham gia' }));
    expect(await screen.findByRole('heading', { name: 'Trang chủ của Hùng' })).toBeTruthy();
    expect(JSON.parse(f.posts().find((p) => p.url === '/api/auth/accept-invite')!.init.body as string)).toEqual({ token, displayName: 'Hùng', password: 'mat-khau-dai-123', email: 'hung@shop.vn' });
    expect(window.location.search).toBe('');
  });

  it('lời mời hết hạn hoặc đã dùng: báo rõ, không có form', async () => {
    window.history.replaceState(null, '', `/?invite=${'d'.repeat(43)}`);
    mockFetch(async (url) => (url === '/api/auth/invite-info' ? json({ error: { code: 'invalid_token', message: 'x' } }, 400) : json({ error: { code: 'unauthenticated', message: 'x' } }, 401)));
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Lời mời không dùng được' })).toBeTruthy();
    expect(screen.queryByLabelText('Tên của bạn')).toBeNull();
  });
});
