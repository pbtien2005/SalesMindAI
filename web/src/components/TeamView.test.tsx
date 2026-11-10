import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamData } from '../api/types';
import { meHa, meLan } from '../test/fixtures';
import { json, mockFetch, renderApp } from '../test/render';
import { SideNav } from './SideNav';
import { TeamView } from './TeamView';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TEAM: TeamData = {
  me: 'u-ha',
  members: [
    { id: 'u-ha', email: 'ha@shop.vn', displayName: 'chị Hà', role: 'manager', createdAt: '2026-11-01T00:00:00Z' },
    { id: 'u-own', email: 'chu@shop.vn', displayName: 'Chủ', role: 'owner', createdAt: '2026-10-01T00:00:00Z' },
    { id: 'u-lan', email: 'lan@shop.vn', displayName: 'Lan', role: 'sale', createdAt: '2026-11-02T00:00:00Z' },
  ],
  invites: [{ id: 'i1', email: null, role: 'sale', expiresAt: '2026-11-17T00:00:00Z' }],
};

function server() {
  return mockFetch(async (url) => {
    if (url === '/api/team') return json(TEAM);
    if (url === '/api/team/invites') return json({ id: 'i2', link: 'http://x/?invite=' + 'a'.repeat(43), expiresAt: '2026-11-17T00:00:00Z', emailed: false }, 201);
    return json({ ok: true });
  });
}

describe('màn Đội', () => {
  it('sale không thấy mục Đội trên thanh bên; quản lý thì thấy', () => {
    server();
    renderApp(<SideNav />, meLan);
    expect(screen.queryByRole('button', { name: 'Đội' })).toBeNull();
    cleanup();
    renderApp(<SideNav />, meHa);
    expect(screen.getByRole('button', { name: 'Đội' })).toBeTruthy();
  });

  it('quản lý: không chọn được vai trò chủ khi mời, không đổi hay gỡ được chủ', async () => {
    server();
    renderApp(<TeamView />, meHa);
    await screen.findByText('Chủ');
    const role = screen.getByLabelText('Vai trò') as HTMLSelectElement;
    expect([...role.options].map((o) => o.value)).toEqual(['sale', 'manager']);
    expect((screen.getByLabelText('Vai trò của Chủ') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Gỡ Chủ' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('tạo lời mời: gửi đúng vai trò và email, hiện liên kết một lần để sao chép', async () => {
    const user = userEvent.setup();
    const f = server();
    renderApp(<TeamView />, meHa);
    await screen.findByText('Lan');
    await user.type(screen.getByLabelText(/Email/), 'nam@shop.vn');
    await user.selectOptions(screen.getByLabelText('Vai trò'), 'manager');
    await user.click(screen.getByRole('button', { name: 'Tạo liên kết mời' }));
    const box = await screen.findByRole('status');
    expect((within(box).getByLabelText('Liên kết mời') as HTMLInputElement).value).toContain('?invite=');
    expect(JSON.parse(f.posts().find((p) => p.url === '/api/team/invites')!.init.body as string)).toEqual({ role: 'manager', email: 'nam@shop.vn' });
  });

  it('gỡ thành viên phải bấm hai lần (xác nhận)', async () => {
    const user = userEvent.setup();
    const f = server();
    renderApp(<TeamView />, meHa);
    await screen.findByText('Lan');
    await user.click(screen.getByRole('button', { name: 'Gỡ Lan' }));
    expect(f.calls().some((c) => c.init.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Gỡ' }));
    await vi.waitFor(() => expect(f.calls().some((c) => c.init.method === 'DELETE' && c.url === '/api/team/members/u-lan')).toBe(true));
  });

  it('đổi vai trò gọi PATCH đúng người', async () => {
    const user = userEvent.setup();
    const f = server();
    renderApp(<TeamView />, meHa);
    await screen.findByText('Lan');
    await user.selectOptions(screen.getByLabelText('Vai trò của Lan'), 'manager');
    await vi.waitFor(() => expect(f.calls().some((c) => c.init.method === 'PATCH' && c.url === '/api/team/members/u-lan')).toBe(true));
    expect(JSON.parse(f.calls().find((c) => c.init.method === 'PATCH')!.init.body as string)).toEqual({ role: 'manager' });
  });
});
