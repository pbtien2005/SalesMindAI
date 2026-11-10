import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setApiRole } from './client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
// Mỗi lần gọi tạo Response mới: thân Response chỉ đọc được một lần.
const reply = (body: unknown, status = 200) => fetchMock.mockImplementation(async () => json(body, status));

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setApiRole('lan');
});
afterEach(() => vi.unstubAllGlobals());

const lastInit = () => fetchMock.mock.calls.at(-1)?.[1] as RequestInit & { headers: Record<string, string> };

describe('api client', () => {
  it('gửi header x-demo-role theo vai trò hiện tại', async () => {
    reply({ now: 'x', role: 'lan', roleName: 'Lan' });
    await api.now();
    expect(lastInit().headers['x-demo-role']).toBe('lan');

    setApiRole('ha');
    await api.now();
    expect(lastInit().headers['x-demo-role']).toBe('ha');
  });

  it('POST gửi JSON và content-type; GET không có body', async () => {
    reply({ now: '2026-11-12T03:00:00Z' });
    await api.advanceMinutes(60);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/clock/advance');
    expect(lastInit().method).toBe('POST');
    expect(lastInit().headers['content-type']).toBe('application/json');
    expect(JSON.parse(lastInit().body as string)).toEqual({ minutes: 60 });

    await api.inbox();
    expect(lastInit().method).toBe('GET');
    expect(lastInit().body).toBeUndefined();
  });

  it('decide gửi đúng chosenAt và mã đề xuất được mã hóa trong URL', async () => {
    reply({ proposalId: 'p', field: 'timeline', status: 'accepted' });
    await api.decide('abc-123', { action: 'accept', chosenAt: '2026-11-14T10:00:00+07:00' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/proposals/abc-123/decide');
    expect(JSON.parse(lastInit().body as string)).toEqual({ action: 'accept', chosenAt: '2026-11-14T10:00:00+07:00' });
  });

  it('customerMessage nhận persona hoặc conversationId', async () => {
    reply({ accepted: true, conversationId: 'c' }, 202);
    await api.customerMessage({ persona: 'minh' }, 'xin chào');
    expect(JSON.parse(lastInit().body as string)).toEqual({ persona: 'minh', text: 'xin chào' });
    await api.customerMessage({ conversationId: 'c1' }, 'hi');
    expect(JSON.parse(lastInit().body as string)).toEqual({ conversationId: 'c1', text: 'hi' });
  });

  it('chuyển {error:{code,message}} thành ApiError', async () => {
    reply({ error: { code: 'needs_date', message: 'Cần chọn ngày.' } }, 422);
    const err = await api.decide('p', { action: 'accept' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'needs_date', message: 'Cần chọn ngày.', status: 422 });
  });

  it('nhận ra no_demo_data (409)', async () => {
    reply({ error: { code: 'no_demo_data', message: 'Chưa có dữ liệu demo.' } }, 409);
    await expect(api.inbox()).rejects.toMatchObject({ code: 'no_demo_data', status: 409 });
  });

  it('thân lỗi không phải JSON vẫn thành ApiError có mã HTTP', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api.home()).rejects.toMatchObject({ code: 'http_error', status: 502 });
  });

  it('mất kết nối thành ApiError code network, status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.now()).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('phản hồi 202 có thân JSON được đọc bình thường', async () => {
    reply({ accepted: true }, 202);
    await expect(api.pageMessage('c1', 'Dạ còn ạ')).resolves.toEqual({ accepted: true });
  });
});
