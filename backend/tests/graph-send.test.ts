import { describe, expect, it } from 'vitest';
import { GraphApiError, GraphClient } from '../src/meta/graph-client.js';
import { API_VERSION, FB_APP_ID, FB_APP_SECRET, makeFakeFetch, metaError, type MetaHandler } from './helpers/fake-meta.js';

const clientWith = (handler: MetaHandler) => {
  const fake = makeFakeFetch(handler);
  return { client: new GraphClient({ apiVersion: API_VERSION, appId: FB_APP_ID, appSecret: FB_APP_SECRET, fetch: fake.fetch }), calls: fake.calls };
};

describe('GraphClient.sendText', () => {
  it('POST me/messages với recipient, message, messaging_type=RESPONSE và appsecret_proof hợp lệ; trả message_id', async () => {
    const { client, calls } = clientWith(() => ({ body: { recipient_id: 'psid-1', message_id: 'm_abc' } }));
    const r = await client.sendText('PAGE_TOKEN', 'psid-1', 'Dạ em chào anh 😀');
    expect(r).toEqual({ messageId: 'm_abc' });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.method).toBe('POST');
    expect(c.path).toBe('me/messages');
    expect(JSON.parse(c.params.get('recipient')!)).toEqual({ id: 'psid-1' });
    expect(JSON.parse(c.params.get('message')!)).toEqual({ text: 'Dạ em chào anh 😀' });
    expect(c.params.get('messaging_type')).toBe('RESPONSE');
    expect(c.params.get('access_token')).toBe('PAGE_TOKEN');
  });

  it('phản hồi thiếu message_id thì ném lỗi (không coi là gửi được)', async () => {
    const { client } = clientWith(() => ({ body: { recipient_id: 'psid-1' } }));
    await expect(client.sendText('T', 'psid-1', 'xin chào')).rejects.toBeInstanceOf(GraphApiError);
  });

  it('lỗi 190 và lỗi cửa sổ giữ nguyên mã để phân loại; nội dung tin dài không lọt vào thông báo lỗi', async () => {
    const secretText = 'Số tài khoản của khách là 123456789';
    const { client } = clientWith(() => ({ ...metaError(190, `Invalid token. Text was: ${secretText}`) }));
    const err = await client.sendText('T', 'psid-1', secretText).then(() => { throw new Error('phải ném lỗi'); }, (e: unknown) => e as GraphApiError);
    expect(err).toBeInstanceOf(GraphApiError);
    expect(err.isTokenInvalid).toBe(true);
    expect(err.message).not.toContain('123456789');
    const w = clientWith(() => ({ ...metaError(10, '(#10) outside window') }));
    expect((await w.client.sendText('T', 'p', 'xin chào').then(() => { throw new Error('phải ném lỗi'); }, (e: unknown) => e as GraphApiError)).code).toBe(10);
  });
});
