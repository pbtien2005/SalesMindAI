import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PagesData } from '../api/types';
import { meHa } from '../test/fixtures';
import { json, mockFetch, renderApp } from '../test/render';
import { PagesView } from './PagesView';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
beforeEach(() => window.history.replaceState(null, '', '/'));

const PAGES: PagesData = {
  facebookConfigured: true,
  aiEnabled: false,
  pages: [
    { id: 'p1', fbPageId: 'fb1', name: 'Nội thất Một', status: 'active', webhookSubscribed: true, conversations: 12, lastMessageAt: '2026-11-11T02:00:00Z', connectedBy: 'chị Hà' },
    { id: 'p2', fbPageId: 'fb2', name: 'Nội thất Hai', status: 'token_invalid', webhookSubscribed: false, conversations: 3, lastMessageAt: null, connectedBy: null },
    { id: 'p3', fbPageId: 'fb3', name: 'Nội thất Ba', status: 'disconnected', webhookSubscribed: false, conversations: 1, lastMessageAt: null, connectedBy: 'chị Hà' },
  ],
};

function server(data: PagesData = PAGES) {
  return mockFetch(async (url) => {
    if (url === '/api/pages') return json(data);
    if (url === '/api/pages/connect-url') return json({ url: 'https://facebook.example/dialog?state=x', expiresInSeconds: 600 });
    if (url.endsWith('/disconnect')) return json({ ok: true, metaUnsubscribed: true });
    if (url.endsWith('/backfill')) return json({ queued: true });
    return json({ error: { code: 'not_found', message: url } }, 404);
  });
}

describe('màn Page Facebook', () => {
  it('liệt kê nhiều Page với trạng thái đúng, không hiện token', async () => {
    server();
    renderApp(<PagesView />, meHa);
    await screen.findByText('Nội thất Một');
    expect(screen.getByText('Đang hoạt động')).toBeTruthy();
    expect(screen.getByText('Cần kết nối lại')).toBeTruthy();
    expect(screen.getByText('Đã ngắt kết nối')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/EAA|token_enc/);
  });

  it('trạng thái trống có hướng dẫn', async () => {
    server({ ...PAGES, pages: [] });
    renderApp(<PagesView />, meHa);
    expect(await screen.findByText('Chưa kết nối Page nào')).toBeTruthy();
  });

  it('máy chủ chưa cấu hình Facebook: cảnh báo và khóa nút kết nối', async () => {
    server({ ...PAGES, facebookConfigured: false });
    renderApp(<PagesView />, meHa);
    expect((await screen.findByRole('alert')).textContent).toContain('FB_APP_ID');
    expect((screen.getByRole('button', { name: 'Kết nối Page Facebook' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('kết nối: xin liên kết rồi chuyển sang Facebook', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, search: '' });
    const user = userEvent.setup();
    const f = server();
    renderApp(<PagesView />, meHa);
    await screen.findByText('Nội thất Một');
    await user.click(screen.getByRole('button', { name: 'Kết nối Page Facebook' }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://facebook.example/dialog?state=x'));
    expect(f.posts().map((p) => p.url)).toEqual(['/api/pages/connect-url']);
  });

  it('ngắt kết nối phải xác nhận hai bước', async () => {
    const user = userEvent.setup();
    const f = server();
    renderApp(<PagesView />, meHa);
    await screen.findByText('Nội thất Một');
    await user.click(screen.getByRole('button', { name: 'Ngắt kết nối Nội thất Một' }));
    expect(f.posts()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Ngắt' }));
    await vi.waitFor(() => expect(f.posts().map((p) => p.url)).toEqual(['/api/pages/p1/disconnect']));
  });

  it('Page đã ngắt không có nút Ngắt; có nút Kết nối lại', async () => {
    server();
    renderApp(<PagesView />, meHa);
    await screen.findByText('Nội thất Ba');
    const cards = screen.getAllByRole('listitem');
    const third = cards.find((c) => within(c).queryByText('Nội thất Ba'))!;
    expect(within(third).queryByRole('button', { name: /Ngắt kết nối/ })).toBeNull();
    expect(within(third).getByRole('button', { name: 'Kết nối lại' })).toBeTruthy();
  });

  it('quay về từ Facebook: hiện kết quả (có Page bị bỏ qua) và xóa query khỏi URL', async () => {
    window.history.replaceState(null, '', '/?connected=1&skipped=1&failed=0');
    server();
    renderApp(<PagesView />, meHa);
    const box = await screen.findByText(/Đã kết nối 1 Page/);
    expect(box.textContent).toContain('đang được doanh nghiệp khác sử dụng');
    expect(window.location.search).toBe('');
  });

  it('lỗi từ Facebook hiện thông báo dễ hiểu, không lộ thông báo thô', async () => {
    window.history.replaceState(null, '', '/?connect_error=facebook');
    server();
    renderApp(<PagesView />, meHa);
    expect(await screen.findByText(/Facebook từ chối hoặc không phản hồi/)).toBeTruthy();
  });
});
