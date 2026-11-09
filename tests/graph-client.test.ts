import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GraphApiError, GraphClient, LOGIN_SCOPES, parseGraphTime } from '../src/meta/graph-client.js';
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

describe('GraphClient: Conversations API (backfill)', () => {
  it('listConversations: một trang, đúng đường dẫn và tham số, kèm after khi còn trang sau', async () => {
    const { client, calls } = clientWith(() => ({
      body: {
        data: [{ id: 't_1', updated_time: '2026-11-09T07:12:30+0000' }, { id: 't_2' }],
        paging: { cursors: { after: 'CUR_A' }, next: 'https://graph.facebook.com/next' },
      },
    }));
    const r = await client.listConversations('PAGE_TOKEN', 'PAGE_9', { after: 'PREV', limit: 10 });
    expect(r).toEqual({
      conversations: [
        { id: 't_1', updatedTime: '2026-11-09T07:12:30+0000' },
        { id: 't_2', updatedTime: null },
      ],
      after: 'CUR_A',
    });
    expect(calls[0]).toMatchObject({ method: 'GET', host: 'graph.facebook.com', path: 'PAGE_9/conversations' });
    expect(calls[0]!.params.get('platform')).toBe('messenger');
    expect(calls[0]!.params.get('after')).toBe('PREV');
    expect(calls[0]!.params.get('limit')).toBe('10');
    expect(calls[0]!.params.get('access_token')).toBe('PAGE_TOKEN');
    expect(calls[0]!.params.get('appsecret_proof')).toBeTruthy();
  });

  it('listConversations: trang cuối (không có paging.next) thì không có after; không đi theo URL next', async () => {
    const { client, calls } = clientWith(() => ({ body: { data: [{ id: 't_1' }], paging: { cursors: { after: 'X' } } } }));
    const r = await client.listConversations('T', 'P');
    expect(r.after).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('listConversationMessages: trả id và thời điểm, bỏ tin có created_time sai', async () => {
    const { client, calls } = clientWith(() => ({
      body: {
        id: 't_1',
        messages: {
          data: [
            { id: 'm_new', created_time: '2026-11-09T07:12:30+0000' },
            { id: 'm_bad', created_time: 'không phải ngày' },
            { id: 'm_old', created_time: '2026-11-08T01:00:00+0000' },
          ],
        },
      },
    }));
    const { messages: r, hasMore } = await client.listConversationMessages('T', 't_1');
    expect(hasMore).toBe(false);
    expect(r.map((m) => m.id)).toEqual(['m_new', 'm_old']);
    expect(r[0]!.createdAt.toISOString()).toBe('2026-11-09T07:12:30.000Z');
    expect(calls[0]).toMatchObject({ method: 'GET', path: 't_1' });
    expect(calls[0]!.params.get('fields')).toBe('messages');
  });

  it('listConversationMessages: hội thoại chưa có messages thì trả mảng rỗng', async () => {
    const { client } = clientWith(() => ({ body: { id: 't_1' } }));
    expect(await client.listConversationMessages('T', 't_1')).toEqual({ messages: [], hasMore: false });
  });

  it('listConversationMessages: Meta báo còn trang sau thì hasMore=true (không tự đi tiếp vì tài liệu không mô tả cách phân trang)', async () => {
    const { client, calls } = clientWith(() => ({
      body: { id: 't_1', messages: { data: [{ id: 'm_1', created_time: '2026-11-09T07:12:30+0000' }], paging: { next: 'https://graph.facebook.com/next' } } },
    }));
    const r = await client.listConversationMessages('T', 't_1');
    expect(r.hasMore).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('getMessage: chỉ xin các field có trong tài liệu và bỏ qua field thừa như tên hay email', async () => {
    const { client, calls } = clientWith(() => ({
      body: {
        id: 'm_1',
        created_time: '2026-11-09T07:12:30+0000',
        from: { id: 'PSID_1', name: 'Nguyễn Văn A', email: 'a@example.com' },
        message: 'Anh muốn mua 20 bộ',
      },
    }));
    const m = await client.getMessage('T', 'm_1');
    expect(m).toEqual({ id: 'm_1', createdAt: new Date('2026-11-09T07:12:30.000Z'), fromId: 'PSID_1', text: 'Anh muốn mua 20 bộ' });
    expect(JSON.stringify(m)).not.toContain('example.com'); // không giữ dữ liệu cá nhân không cần
    expect(calls[0]!.params.get('fields')).toBe('id,created_time,from,message');
    expect(calls[0]!.params.get('fields')).not.toContain('attachments'); // tài liệu không nêu field này
  });

  it('getMessage: tin chỉ có ảnh (không có message) thì text null; mid có ký tự đặc biệt được mã hóa trong đường dẫn', async () => {
    const { client, calls } = clientWith(() => ({ body: { id: 'mid.$cAAJ', created_time: '2026-11-09T07:12:30+0000', from: { id: 'U' } } }));
    const m = await client.getMessage('T', 'mid.$cAAJ');
    expect(m.text).toBeNull();
    expect(calls[0]!.path).toBe('mid.%24cAAJ');
  });

  it('getMessage: thiếu created_time hợp lệ hoặc sai dạng thì ném GraphApiError', async () => {
    const { client } = clientWith(() => ({ body: { id: 'm', created_time: 'xyz' } }));
    await expect(client.getMessage('T', 'm')).rejects.toBeInstanceOf(GraphApiError);
  });

  it('parseGraphTime: chuẩn hóa độ lệch múi giờ kiểu +0000 và nhận ISO chuẩn', () => {
    expect(parseGraphTime('2026-11-09T07:12:30+0000')!.toISOString()).toBe('2026-11-09T07:12:30.000Z');
    expect(parseGraphTime('2026-11-09T14:12:30+0700')!.toISOString()).toBe('2026-11-09T07:12:30.000Z');
    expect(parseGraphTime('2026-11-09T07:12:30-0530')!.toISOString()).toBe('2026-11-09T12:42:30.000Z');
    expect(parseGraphTime('2026-11-09T07:12:30.123Z')!.toISOString()).toBe('2026-11-09T07:12:30.123Z');
    expect(parseGraphTime('hôm qua')).toBeNull();
  });

  it('GraphApiError.isRateLimited nhận các mã giới hạn tốc độ và không nhầm với lỗi khác', () => {
    for (const code of [4, 17, 32, 613, 80001]) expect(new GraphApiError('x', 400, code, null, null).isRateLimited).toBe(true);
    for (const code of [100, 190, 200, null]) expect(new GraphApiError('x', 400, code, null, null).isRateLimited).toBe(false);
  });
});
