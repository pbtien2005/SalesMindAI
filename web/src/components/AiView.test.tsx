import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiStatus } from '../api/types';
import { meHa } from '../test/fixtures';
import { json, mockFetch, renderApp } from '../test/render';
import { AiView } from './AiView';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OFF: AiStatus = { enabled: false, mode: 'live', consentAt: null, cap: 500, today: { calls: 0, inputTokens: 0, outputTokens: 0 } };
const owner = { ...meHa, role: 'owner' as const, displayName: 'Chủ' };

function server(st: AiStatus) {
  return mockFetch(async (url) => {
    if (url === '/api/ai') return json(st);
    if (url === '/api/ai/enable') return json({ enabled: true });
    if (url === '/api/ai/disable') return json({ enabled: false });
    return json({ error: { code: 'not_found', message: url } }, 404);
  });
}

describe('màn AI', () => {
  it('owner: nút Bật khóa cho tới khi tích xác nhận pháp lý, rồi gửi đúng một lần', async () => {
    const user = userEvent.setup();
    const f = server(OFF);
    renderApp(<AiView />, owner);
    const btn = (await screen.findByRole('button', { name: 'Bật AI' })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox'));
    expect(btn.disabled).toBe(false);
    await user.click(btn);
    await vi.waitFor(() => expect(f.posts().map((p) => p.url)).toEqual(['/api/ai/enable']));
  });

  it('manager: thấy trạng thái nhưng không có nút bật', async () => {
    server(OFF);
    renderApp(<AiView />, { ...meHa, role: 'manager' });
    expect(await screen.findByText('Chỉ chủ doanh nghiệp mới bật được AI.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bật AI' })).toBeNull();
  });

  it('hết hạn mức: báo rõ tin vẫn được lưu và AI tiếp tục vào ngày mai', async () => {
    server({ ...OFF, enabled: true, consentAt: '2026-11-10T00:00:00Z', today: { calls: 500, inputTokens: 1234, outputTokens: 56 } });
    renderApp(<AiView />, owner);
    expect((await screen.findByRole('alert')).textContent).toContain('hết hạn mức');
    expect(screen.getByText('500 / 500')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tắt AI' })).toBeTruthy();
  });

  it('chế độ mô phỏng nói rõ không gửi dữ liệu ra ngoài', async () => {
    server({ ...OFF, mode: 'offline', cap: null });
    renderApp(<AiView />, owner);
    expect(await screen.findByText(/không gọi AI bên ngoài/)).toBeTruthy();
  });
});

describe('dữ liệu doanh nghiệp (chỉ chủ)', () => {
  it('manager không thấy phần xóa; owner phải mở form, nhập tên và mật khẩu rồi mới gửi', async () => {
    const user = userEvent.setup();
    const f = server(OFF);
    renderApp(<AiView />, { ...meHa, role: 'manager' });
    await screen.findByText('Chỉ chủ doanh nghiệp mới bật được AI.');
    expect(screen.queryByText('Dữ liệu doanh nghiệp')).toBeNull();
    cleanup();
    renderApp(<AiView />, owner);
    await user.click(await screen.findByRole('button', { name: 'Xóa dữ liệu doanh nghiệp…' }));
    const submit = screen.getByRole('button', { name: 'Xóa vĩnh viễn' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(screen.getByLabelText(/Nhập đúng tên/), 'Nội thất ABC');
    await user.type(screen.getByLabelText('Mật khẩu của bạn'), 'mat-khau-dai-123');
    expect(f.posts()).toHaveLength(0);
    await user.click(submit);
    await vi.waitFor(() => expect(f.posts().map((p) => p.url)).toEqual(['/api/tenant/delete']));
    expect(JSON.parse(f.posts()[0]!.init.body as string)).toEqual({ confirmName: 'Nội thất ABC', password: 'mat-khau-dai-123' });
  });
});
