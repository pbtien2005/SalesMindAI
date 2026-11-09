import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GraphApiError, GraphClient, LOGIN_SCOPES } from '../src/meta/graph-client.js';
import { API_VERSION, FB_APP_ID, FB_APP_SECRET, makeFakeFetch, metaError, type MetaHandler } from './helpers/fake-meta.js';

const clientWith = (handler: MetaHandler, extra: { timeoutMs?: number } = {}) => {
  const fake = makeFakeFetch(handler);
  const client = new GraphClient({ apiVersion: API_VERSION, appId: FB_APP_ID, appSecret: FB_APP_SECRET, fetch: fake.fetch, ...extra });
  return { client, calls: fake.calls };
};

const rawFetchClient = (f: typeof fetch, timeoutMs?: number) =>
  new GraphClient({ apiVersion: API_VERSION, appId: FB_APP_ID, appSecret: FB_APP_SECRET, fetch: f, ...(timeoutMs ? { timeoutMs } : {}) });

describe('GraphClient.loginUrl', () => {
  it('tạo URL hộp thoại Facebook Login đúng tham số', () => {
    const { client } = clientWith(() => ({ body: {} }));
    const url = new URL(client.loginUrl({ redirectUri: 'https://x.example/cb', state: 'STATE123' }));
    expect(url.origin + url.pathname).toBe(`https://www.facebook.com/${API_VERSION}/dialog/oauth`);
    expect(url.searchParams.get('client_id')).toBe(FB_APP_ID);
    expect(url.searchParams.get('redirect_uri')).toBe('https://x.example/cb');
    expect(url.searchParams.get('state')).toBe('STATE123');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')!.split(',')).toEqual([...LOGIN_SCOPES]);
  });

  it('có loginConfigId: dùng config_id + override_default_response_type, KHÔNG gửi scope', () => {
    const client = new GraphClient({ apiVersion: API_VERSION, appId: FB_APP_ID, appSecret: FB_APP_SECRET, loginConfigId: 'CFG_42' });
    const url = new URL(client.loginUrl({ redirectUri: 'https://x/cb', state: 'S' }));
    expect(url.searchParams.get('config_id')).toBe('CFG_42');
    expect(url.searchParams.get('override_default_response_type')).toBe('true');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.searchParams.get('state')).toBe('S');
  });

  it('không có loginConfigId: dùng scope, không có config_id', () => {
    const { client } = clientWith(() => ({ body: {} }));
    const url = new URL(client.loginUrl({ redirectUri: 'https://x/cb', state: 'S' }));
    expect(url.searchParams.has('config_id')).toBe(false);
    expect(url.searchParams.has('scope')).toBe(true);
  });

  it('không đưa app secret vào URL (URL này đi qua trình duyệt)', () => {
    const { client } = clientWith(() => ({ body: {} }));
    expect(client.loginUrl({ redirectUri: 'https://x/cb', state: 's' })).not.toContain(FB_APP_SECRET);
  });
});

describe('GraphClient: đổi token', () => {
  it('exchangeCode gửi đúng tham số tới oauth/access_token và trả access_token', async () => {
    const { client, calls } = clientWith(() => ({ body: { access_token: 'SHORT', token_type: 'bearer', expires_in: 3600 } }));
    await expect(client.exchangeCode('CODE_1', 'https://x/cb')).resolves.toBe('SHORT');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', host: 'graph.facebook.com', path: 'oauth/access_token' });
    expect(Object.fromEntries(calls[0]!.params)).toEqual({
      client_id: FB_APP_ID,
      client_secret: FB_APP_SECRET,
      redirect_uri: 'https://x/cb',
      code: 'CODE_1',
    });
  });

  it('exchangeLongLived dùng grant_type=fb_exchange_token', async () => {
    const { client, calls } = clientWith(() => ({ body: { access_token: 'LONG' } }));
    await expect(client.exchangeLongLived('SHORT')).resolves.toBe('LONG');
    expect(Object.fromEntries(calls[0]!.params)).toEqual({
      grant_type: 'fb_exchange_token',
      client_id: FB_APP_ID,
      client_secret: FB_APP_SECRET,
      fb_exchange_token: 'SHORT',
    });
  });
});

describe('GraphClient.listPages', () => {
  it('phân trang bằng cursor và gộp kết quả; bỏ Page không có token', async () => {
    const { client, calls } = clientWith((req) => {
      if (!req.params.get('after')) {
        return {
          body: {
            data: [
              { id: '1', name: 'A', access_token: 'TA' },
              { id: '2', name: 'Không quyền' }, // thiếu access_token
            ],
            paging: { cursors: { after: 'CUR1' }, next: 'https://evil.example/steal?access_token=x' },
          },
        };
      }
      return { body: { data: [{ id: '3', name: 'C', access_token: 'TC' }], paging: { cursors: { after: 'CUR2' } } } };
    });
    const pages = await client.listPages('USER_TOKEN');
    expect(pages).toEqual([
      { id: '1', name: 'A', accessToken: 'TA' },
      { id: '3', name: 'C', accessToken: 'TC' },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.params.get('after')).toBe('CUR1');
  });

  it('không bao giờ đi theo URL paging.next do server trả (tránh rò token sang host khác)', async () => {
    const { client, calls } = clientWith(() => ({
      body: { data: [], paging: { cursors: { after: 'C' }, next: 'https://evil.example/steal' } },
    }));
    // server trả cursor mãi mãi: client tự dừng ở giới hạn trang và BÁO LỖI (không trả danh sách thiếu)
    await expect(client.listPages('T')).rejects.toBeInstanceOf(GraphApiError);
    expect(calls.every((c) => c.host === 'graph.facebook.com')).toBe(true);
    expect(calls).toHaveLength(20);
  });

  it('dừng khi không còn paging.next', async () => {
    const { client, calls } = clientWith(() => ({ body: { data: [{ id: '1', name: 'A', access_token: 'T' }] } }));
    await client.listPages('U');
    expect(calls).toHaveLength(1);
  });

  it('gửi access_token kèm appsecret_proof đúng (HMAC-SHA256 hex)', async () => {
    const { client, calls } = clientWith(() => ({ body: { data: [] } }));
    await client.listPages('USER_TOKEN');
    const expected = createHmac('sha256', FB_APP_SECRET).update('USER_TOKEN').digest('hex');
    expect(calls[0]!.params.get('access_token')).toBe('USER_TOKEN');
    expect(calls[0]!.params.get('appsecret_proof')).toBe(expected);
  });
});

describe('GraphClient.subscribePage', () => {
  it('POST subscribed_apps với subscribed_fields=messages, Page token và appsecret_proof', async () => {
    const { client, calls } = clientWith(() => ({ body: { success: true } }));
    await client.subscribePage('PAGE_9', 'PAGE_TOKEN');
    expect(calls[0]).toMatchObject({ method: 'POST', path: 'PAGE_9/subscribed_apps' });
    expect(calls[0]!.params.get('subscribed_fields')).toBe('messages');
    expect(calls[0]!.params.get('access_token')).toBe('PAGE_TOKEN');
    expect(calls[0]!.params.get('appsecret_proof')).toBeTruthy();
  });

  it('mã hóa ID Page trong đường dẫn', async () => {
    const { client, calls } = clientWith(() => ({ body: { success: true } }));
    await client.subscribePage('a/b?c', 'T');
    expect(calls[0]!.path).toBe('a%2Fb%3Fc/subscribed_apps');
  });

  it('success=false thì ném lỗi', async () => {
    const { client } = clientWith(() => ({ body: { success: false } }));
    await expect(client.subscribePage('P', 'T')).rejects.toBeInstanceOf(GraphApiError);
  });
});

describe('GraphClient: xử lý lỗi', () => {
  it('lỗi Meta mã 190: GraphApiError với isTokenInvalid', async () => {
    const { client } = clientWith(() => metaError(190, 'Error validating access token: Session has expired'));
    const err = await client.listPages('T').catch((e) => e);
    expect(err).toBeInstanceOf(GraphApiError);
    expect(err.isTokenInvalid).toBe(true);
    expect(err).toMatchObject({ httpStatus: 400, code: 190, type: 'OAuthException' });
  });

  it('mã lỗi khác 190 thì không phải token hỏng', async () => {
    const { client } = clientWith(() => metaError(200, 'Permissions error', 403));
    const err = await client.subscribePage('P', 'T').catch((e) => e);
    expect(err.isTokenInvalid).toBe(false);
    expect(err.code).toBe(200);
  });

  it('loại token và secret khỏi thông báo lỗi dù Meta lỡ chép lại chúng', async () => {
    const { client } = clientWith(() =>
      metaError(100, `Invalid code CODE_SECRET_9 for token USER_SECRET_TOKEN and secret ${FB_APP_SECRET}`),
    );
    const err = await client.exchangeCode('CODE_SECRET_9', 'https://x/cb').catch((e) => e);
    expect(err.message).not.toContain('CODE_SECRET_9');
    expect(err.message).not.toContain(FB_APP_SECRET);
    const err2 = await clientWith(() => metaError(190, 'bad USER_SECRET_TOKEN')).client.listPages('USER_SECRET_TOKEN').catch((e) => e);
    expect(err2.message).not.toContain('USER_SECRET_TOKEN');
  });

  it('phản hồi không phải JSON (HTML 502 của proxy): GraphApiError, không lộ nội dung', async () => {
    const f = (async () => new Response('<html>Bad Gateway SECRET_BODY</html>', { status: 502 })) as typeof fetch;
    const err = await rawFetchClient(f).listPages('T').catch((e) => e);
    expect(err).toBeInstanceOf(GraphApiError);
    expect(err.httpStatus).toBe(502);
    expect(err.message).not.toContain('SECRET_BODY');
  });

  it('lỗi mạng: GraphApiError không chứa URL hay token từ message gốc', async () => {
    const f = (async () => {
      throw new TypeError('fetch failed: https://graph.facebook.com/x?access_token=LEAKED_TOKEN');
    }) as typeof fetch;
    const err = await rawFetchClient(f).listPages('LEAKED_TOKEN').catch((e) => e);
    expect(err).toBeInstanceOf(GraphApiError);
    expect(err.httpStatus).toBeNull();
    expect(err.message).not.toContain('LEAKED_TOKEN');
    expect(err.message).not.toContain('graph.facebook.com');
  });

  it('hết thời gian chờ: GraphApiError thay vì treo mãi', async () => {
    const f = ((_url: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))) as typeof fetch;
    const t0 = Date.now();
    const err = await rawFetchClient(f, 80).listPages('T').catch((e) => e);
    expect(err).toBeInstanceOf(GraphApiError);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('server gửi header rồi treo lúc đọc body: GraphApiError, không phải DOMException thô', async () => {
    const f = ((_url: unknown, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;
    const t0 = Date.now();
    const err = await rawFetchClient(f, 80).listPages('T').catch((e) => e);
    expect(err).toBeInstanceOf(GraphApiError);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('phản hồi thành công nhưng sai dạng: GraphApiError, không phải ZodError và không lộ nội dung', async () => {
    const { client } = clientWith(() => ({ body: { access_token: 12345, secret_field: 'SECRET_BODY' } }));
    const err = await client.exchangeCode('c', 'https://x/cb').catch((e) => e);
    expect(err).toBeInstanceOf(GraphApiError);
    expect(err.message).not.toContain('SECRET_BODY');
  });

  it('HTTP 200 nhưng thân là lỗi (Meta đôi khi làm vậy) vẫn là lỗi', async () => {
    const { client } = clientWith(() => ({ status: 200, body: { error: { message: 'oops', code: 1 } } }));
    await expect(client.listPages('T')).rejects.toBeInstanceOf(GraphApiError);
  });
});
