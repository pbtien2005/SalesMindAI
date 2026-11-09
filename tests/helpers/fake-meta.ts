import { createHmac } from 'node:crypto';

export const FB_APP_ID = '1234567890';
export const FB_APP_SECRET = 'fb-app-secret-for-tests';
export const API_VERSION = 'v26.0';

export interface MetaRequest {
  method: string;
  host: string;
  /** Đường dẫn sau `/v26.0/`. */
  path: string;
  params: URLSearchParams;
}

export interface MetaReply {
  status?: number;
  body: unknown;
}

export type MetaHandler = (req: MetaRequest) => MetaReply | Promise<MetaReply>;

/**
 * `fetch` giả đóng vai Graph API. Ghi lại mọi lời gọi và tự kiểm tra `appsecret_proof`
 * (HMAC-SHA256 của access_token bằng app secret) trên các lời gọi có access_token.
 */
export function makeFakeFetch(handler: MetaHandler) {
  const calls: MetaRequest[] = [];
  const fakeFetch = (async (input: URL | string | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init?.method ?? 'GET';
    const params = new URLSearchParams(method === 'GET' ? url.search : String(init?.body ?? ''));
    const req: MetaRequest = {
      method,
      host: url.host,
      path: url.pathname.replace(`/${API_VERSION}/`, ''),
      params,
    };
    calls.push(req);

    const token = params.get('access_token');
    if (token) {
      const expected = createHmac('sha256', FB_APP_SECRET).update(token).digest('hex');
      if (params.get('appsecret_proof') !== expected) {
        return json(400, { error: { message: 'Incorrect signature', type: 'GraphMethodException', code: 104 } });
      }
    }
    const reply = await handler(req);
    return json(reply.status ?? 200, reply.body);
  }) as typeof fetch;
  return { fetch: fakeFetch, calls };
}

const json = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export const metaError = (code: number, message: string, status = 400, type = 'OAuthException') => ({
  status,
  body: { error: { message, type, code } },
});
