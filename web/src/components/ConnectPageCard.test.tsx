import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PagesData } from '../api/types';
import { meHa, meLan } from '../test/fixtures';
import { json, mockFetch, renderApp } from '../test/render';
import { ConnectPageCard } from './ConnectPageCard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ACTIVE = { id: 'p1', fbPageId: 'fb1', name: 'Nội thất Một', status: 'active', webhookSubscribed: true, conversations: 1, lastMessageAt: null, connectedBy: null } as const;
const base: PagesData = { facebookConfigured: true, aiEnabled: false, pages: [] };

function server(data: PagesData) {
  return mockFetch(async (url) => {
    if (url === '/api/pages') return json(data);
    if (url === '/api/pages/connect-url') return json({ url: 'https://facebook.example/dialog?state=x', expiresInSeconds: 600 });
    return json({ error: { code: 'not_found', message: url } }, 404);
  });
}

describe('thẻ kết nối Page đầu tiên', () => {
  it('chưa có Page: hiện thẻ; bấm mở hộp thoại, chỉ chuyển sang Facebook khi bấm Tiếp tục', async () => {
    const f = server(base);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const user = userEvent.setup();
    renderApp(<ConnectPageCard />, meHa);
    await user.click(await screen.findByRole('button', { name: 'Kết nối Page Facebook' }));
    expect(screen.getByRole('dialog').textContent).toContain('tick đúng các Page');
    expect(f.posts()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Tiếp tục với Facebook' }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://facebook.example/dialog?state=x'));
  });

  it('"Để sau" đóng hộp thoại và không gọi connect-url', async () => {
    const f = server(base);
    const user = userEvent.setup();
    renderApp(<ConnectPageCard />, meHa);
    await user.click(await screen.findByRole('button', { name: 'Kết nối Page Facebook' }));
    await user.click(screen.getByRole('button', { name: 'Để sau' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(f.posts()).toHaveLength(0);
  });

  it('đã có Page đang kết nối: không hiện thẻ', async () => {
    server({ ...base, pages: [ACTIVE] });
    renderApp(<ConnectPageCard />, meHa);
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Kết nối Page Facebook' })).toBeNull());
    expect(screen.queryByText('Kết nối Page Facebook đầu tiên')).toBeNull();
  });

  it('chỉ còn Page đã ngắt: vẫn mời kết nối', async () => {
    server({ ...base, pages: [{ ...ACTIVE, status: 'disconnected' }] });
    renderApp(<ConnectPageCard />, meHa);
    expect(await screen.findByText('Kết nối Page Facebook đầu tiên')).toBeTruthy();
  });

  it('email chưa xác minh: vẫn kết nối được', async () => {
    server(base);
    renderApp(<ConnectPageCard />, { ...meHa, emailVerified: false });
    expect((await screen.findByRole('button', { name: 'Kết nối Page Facebook' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('máy chủ chưa cấu hình Facebook: khóa nút và nói lý do', async () => {
    server({ ...base, facebookConfigured: false });
    renderApp(<ConnectPageCard />, meHa);
    expect((await screen.findByRole('button', { name: 'Kết nối Page Facebook' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/chưa cấu hình ứng dụng Facebook/)).toBeTruthy();
  });

  it('sale không thấy thẻ và không gọi API Page', async () => {
    const f = server(base);
    renderApp(<ConnectPageCard />, meLan);
    expect(screen.queryByText('Kết nối Page Facebook đầu tiên')).toBeNull();
    expect(f.calls().some((c) => c.url === '/api/pages')).toBe(false);
  });
});
