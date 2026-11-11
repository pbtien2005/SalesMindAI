import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PagesData } from '../api/types';
import { meHa, meLan } from '../test/fixtures';
import { json, mockFetch, renderApp } from '../test/render';
import { PageSwitcher } from './PageSwitcher';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PAGES: PagesData = {
  facebookConfigured: true,
  aiEnabled: false,
  pages: [
    { id: 'p1', fbPageId: 'fb1', name: 'Nội thất Một', status: 'active', webhookSubscribed: true, conversations: 12, lastMessageAt: null, connectedBy: null },
    { id: 'p2', fbPageId: 'fb2', name: 'Nội thất Hai', status: 'token_invalid', webhookSubscribed: false, conversations: 3, lastMessageAt: null, connectedBy: null },
    { id: 'p3', fbPageId: 'fb3', name: 'Nội thất Ba', status: 'disconnected', webhookSubscribed: false, conversations: 1, lastMessageAt: null, connectedBy: null },
  ],
};

function server(data: PagesData = PAGES) {
  return mockFetch(async (url) => {
    if (url === '/api/pages') return json(data);
    if (url === '/api/pages/connect-url') return json({ url: 'https://facebook.example/dialog?state=x', expiresInSeconds: 600 });
    return json({ error: { code: 'not_found', message: url } }, 404);
  });
}

describe('bộ chuyển Page', () => {
  it('sale không thấy và không gọi API Page (sẽ bị 403)', async () => {
    const f = server();
    renderApp(<PageSwitcher />, meLan);
    expect(screen.queryByRole('button', { name: /Page Facebook/ })).toBeNull();
    expect(f.posts()).toEqual([]);
    expect(f.calls().some((c) => c.url === '/api/pages')).toBe(false);
  });

  it('chưa có Page: nút "+" mời kết nối Page đầu tiên và bấm thì gọi connect-url', async () => {
    const f = server({ ...PAGES, pages: [] });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const user = userEvent.setup();
    renderApp(<PageSwitcher />, meHa);
    await user.click(await screen.findByRole('button', { name: 'Thêm Page Facebook' }));
    await user.click(screen.getByRole('menuitem', { name: /Kết nối Page đầu tiên/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(f.posts()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Tiếp tục với Facebook' }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://facebook.example/dialog?state=x'));
    expect(f.posts().map((p) => p.url)).toEqual(['/api/pages/connect-url']);
  });

  it('đã có Page: liệt kê Page đang kết nối (bỏ Page đã ngắt), có "Thêm Page" và "Quản lý Page"', async () => {
    server();
    const user = userEvent.setup();
    renderApp(<PageSwitcher />, meHa);
    await user.click(await screen.findByRole('button', { name: 'Page Facebook' }));
    expect(screen.getByText('Nội thất Một')).toBeTruthy();
    expect(screen.getByText('Nội thất Hai')).toBeTruthy();
    expect(screen.getByText('Cần kết nối lại')).toBeTruthy();
    expect(screen.queryByText('Nội thất Ba')).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Thêm Page/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Quản lý Page/ })).toBeTruthy();
  });

  it('email chưa xác minh: vẫn thêm Page được', async () => {
    server();
    const user = userEvent.setup();
    renderApp(<PageSwitcher />, { ...meHa, emailVerified: false });
    await user.click(await screen.findByRole('button', { name: 'Page Facebook' }));
    expect((screen.getByRole('menuitem', { name: /Thêm Page/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Esc đóng menu', async () => {
    server();
    const user = userEvent.setup();
    renderApp(<PageSwitcher />, meHa);
    await user.click(await screen.findByRole('button', { name: 'Page Facebook' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
