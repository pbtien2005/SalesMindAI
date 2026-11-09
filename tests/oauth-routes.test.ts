import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { connectPages } from '../src/auth/connect-pages.js';
import { OAUTH_COOKIE, type OAuthRouteOptions } from '../src/auth/oauth-routes.js';
import { createOAuthState } from '../src/auth/oauth-state.js';
import { createTenant } from '../src/auth/tenants.js';
import { createTokenCrypto, type TokenCrypto } from '../src/crypto/token-crypto.js';
import { pages } from '../src/db/schema.js';
import { GraphApiError, GraphClient } from '../src/meta/graph-client.js';
import type { WebhookQueue } from '../src/queue/boss.js';
import { API_VERSION, FB_APP_ID, FB_APP_SECRET, makeFakeFetch, metaError, type MetaHandler } from './helpers/fake-meta.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';
import { APP_SECRET, VERIFY_TOKEN } from './helpers/webhook.js';

const BASE = 'https://salesmind.example.com';
const CALLBACK = `${BASE}/auth/facebook/callback`;

const handle = openTestDb();
const { db } = handle;
const realCrypto = createTokenCrypto(randomBytes(32).toString('base64'));
const nullQueue: WebhookQueue = { enqueue: async () => {} };

afterAll(() => handle.close());

/** Hành vi mặc định của Meta giả: đổi code, đổi token dài hạn, liệt kê 2 Page, đăng ký webhook. */
const happyMeta: MetaHandler = (req) => {
  if (req.path === 'oauth/access_token') {
    if (req.params.get('grant_type') === 'fb_exchange_token') {
      return req.params.get('fb_exchange_token') === 'SHORT_TOKEN'
        ? { body: { access_token: 'LONG_TOKEN' } }
        : metaError(190, 'bad short token');
    }
    return req.params.get('code') === 'GOOD_CODE' && req.params.get('redirect_uri') === CALLBACK
      ? { body: { access_token: 'SHORT_TOKEN' } }
      : metaError(100, 'Invalid verification code format.');
  }
  if (req.path === 'me/accounts') {
    return req.params.get('access_token') === 'LONG_TOKEN'
      ? {
          body: {
            data: [
              { id: 'P_A', name: 'Cửa hàng A', access_token: 'PAGE_TOKEN_A' },
              { id: 'P_B', name: '<b>Shop</b> "B"', access_token: 'PAGE_TOKEN_B' },
            ],
          },
        }
      : metaError(190, 'bad user token');
  }
  if (req.path.endsWith('/subscribed_apps')) return { body: { success: true } };
  return metaError(100, `không hỗ trợ ${req.path}`, 404);
};

let logLines: string[];
let meta: ReturnType<typeof makeFakeFetch>;
let app: ReturnType<typeof buildApp>;

interface SetupOpts {
  handler?: MetaHandler;
  crypto?: TokenCrypto;
  graph?: OAuthRouteOptions['graph'];
  publicBaseUrl?: string;
}

async function setup(o: SetupOpts = {}) {
  meta = makeFakeFetch(o.handler ?? happyMeta);
  logLines = [];
  const realGraph = new GraphClient({ apiVersion: API_VERSION, appId: FB_APP_ID, appSecret: FB_APP_SECRET, fetch: meta.fetch });
  app = buildApp(
    { logger: { level: 'debug', stream: { write: (s: string) => void logLines.push(s) } } },
    {
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
      queue: nullQueue,
      oauth: { db, graph: o.graph ?? realGraph, crypto: o.crypto ?? realCrypto, publicBaseUrl: o.publicBaseUrl ?? BASE },
    },
  );
  await app.ready();
}

beforeEach(async () => {
  await truncateAll(handle);
  await setup();
});

const start = (state?: string, cookie?: string) =>
  app.inject({
    method: 'GET',
    url: '/auth/facebook/start',
    query: state === undefined ? {} : { state },
    ...(cookie ? { headers: { cookie } } : {}),
  });

const callback = (q: Record<string, string>, cookie?: string) =>
  app.inject({ method: 'GET', url: '/auth/facebook/callback', query: q, ...(cookie ? { headers: { cookie } } : {}) });

/** Lấy phần `sm_oauth=...` từ Set-Cookie của /start để gửi lại như trình duyệt. */
const cookieFrom = (res: { headers: Record<string, unknown> }): string => {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first).split(';')[0]!;
};

async function newState(name = 'Công ty A') {
  const tenant = await createTenant(db, name);
  return { tenant, state: await createOAuthState(db, tenant.id) };
}

/** Một lần kết nối đầy đủ như người dùng thật: mở liên kết (nhận cookie) rồi callback từ Facebook. */
async function complete(state: string, extra: Record<string, string> = { code: 'GOOD_CODE' }) {
  const s = await start(state);
  expect(s.statusCode).toBe(302);
  return callback({ state, ...extra }, cookieFrom(s));
}

describe('GET /auth/facebook/start', () => {
  it('state hợp lệ: 302 sang hộp thoại Facebook với đúng tham số', async () => {
    const { state } = await newState();
    const res = await start(state);
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.origin + loc.pathname).toBe(`https://www.facebook.com/${API_VERSION}/dialog/oauth`);
    expect(loc.searchParams.get('client_id')).toBe(FB_APP_ID);
    expect(loc.searchParams.get('redirect_uri')).toBe(CALLBACK);
    expect(loc.searchParams.get('state')).toBe(state);
    expect(loc.searchParams.get('scope')).toContain('pages_messaging');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers.location).not.toContain(FB_APP_SECRET);
  });

  it('đặt cookie gắn trình duyệt: HttpOnly, SameSite=Lax, Secure (HTTPS), giới hạn đường dẫn và thời gian', async () => {
    const { state } = await newState();
    const res = await start(state);
    const sc = String(res.headers['set-cookie']);
    expect(sc).toMatch(new RegExp(`^${OAUTH_COOKIE}=[A-Za-z0-9_-]{43};`));
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Lax');
    expect(sc).toContain('Secure');
    expect(sc).toContain('Path=/auth/facebook');
    expect(sc).toContain('Max-Age=600');
  });

  it('chạy trên http://localhost (dev) thì cookie không có Secure để trình duyệt vẫn nhận', async () => {
    await setup({ publicBaseUrl: 'http://localhost:3000' });
    const { state } = await newState();
    expect(String((await start(state)).headers['set-cookie'])).not.toContain('Secure');
  });

  it('người dùng thật tải lại trang (cùng cookie) vẫn được chuyển hướng', async () => {
    const { state } = await newState();
    const first = await start(state);
    const cookie = cookieFrom(first);
    expect((await start(state, cookie)).statusCode).toBe(302);
  });

  it('CHIẾM LUỒNG: trình duyệt khác mở cùng state sau khi người dùng thật đã mở thì bị từ chối', async () => {
    const { state } = await newState();
    expect((await start(state)).statusCode).toBe(302); // người dùng thật (nhận nonce A)
    const attacker = await start(state, `${OAUTH_COOKIE}=${randomBytes(32).toString('base64url')}`);
    expect(attacker.statusCode).toBe(400);
    expect(attacker.headers.location).toBeUndefined();
    expect(attacker.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    ['thiếu state', undefined],
    ['state quá ngắn', 'abc'],
    ['state không tồn tại', 'x'.repeat(43)],
    ['state đủ dài nhưng sai ký tự', '!'.repeat(43)],
    ['state dài quá mức', 'x'.repeat(44)],
  ])('%s: 400, không chuyển hướng, không đặt cookie', async (_n, state) => {
    const res = await start(state);
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('state đã dùng hoặc hết hạn: 400', async () => {
    const tenant = await createTenant(db, 'A');
    expect((await start(await createOAuthState(db, tenant.id, -1))).statusCode).toBe(400);

    const used = await createOAuthState(db, tenant.id);
    await complete(used);
    expect((await start(used)).statusCode).toBe(400);
  });
});

describe('GET /auth/facebook/callback: kết nối thành công', () => {
  it('lưu Page với token mã hóa, đăng ký webhook, trả trang tóm tắt, xóa cookie', async () => {
    const { tenant, state } = await newState();
    const res = await complete(state);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(String(res.headers['set-cookie'])).toMatch(new RegExp(`^${OAUTH_COOKIE}=;.*Max-Age=0`));
    expect(res.body).toContain('Kết nối thành công');
    expect(res.body).toContain('Cửa hàng A');

    const rows = await db.select().from(pages).where(eq(pages.tenantId, tenant.id));
    expect(rows.map((r) => r.fbPageId).sort()).toEqual(['P_A', 'P_B']);
    for (const r of rows) {
      expect(r.status).toBe('active');
      expect(r.subscribedAt).not.toBeNull();
      expect(r.tokenEnc.startsWith('v1:')).toBe(true);
      expect(r.tokenEnc).not.toContain('PAGE_TOKEN');
    }
    const a = rows.find((r) => r.fbPageId === 'P_A')!;
    expect(realCrypto.decrypt(a.tokenEnc, 'P_A')).toBe('PAGE_TOKEN_A');
    expect(() => realCrypto.decrypt(a.tokenEnc, 'P_B')).toThrow(); // gắn với đúng Page
  });

  it('gọi Meta đúng thứ tự: đổi code, đổi token dài hạn, liệt kê Page, đăng ký từng Page bằng Page token', async () => {
    const { state } = await newState();
    await complete(state);
    expect(meta.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET oauth/access_token',
      'GET oauth/access_token',
      'GET me/accounts',
      'POST P_A/subscribed_apps',
      'POST P_B/subscribed_apps',
    ]);
    const sub = meta.calls.filter((c) => c.path.endsWith('subscribed_apps'));
    expect(sub[0]!.params.get('access_token')).toBe('PAGE_TOKEN_A');
    expect(sub[1]!.params.get('access_token')).toBe('PAGE_TOKEN_B');
    expect(sub[0]!.params.get('subscribed_fields')).toBe('messages');
  });

  it('LƯU TRƯỚC, ĐĂNG KÝ SAU: lúc đăng ký webhook thì Page đã có trong DB', async () => {
    const seenInDb: boolean[] = [];
    await setup({
      handler: async (req) => {
        if (req.path.endsWith('/subscribed_apps')) {
          const id = req.path.split('/')[0]!;
          seenInDb.push((await db.select().from(pages).where(eq(pages.fbPageId, id))).length === 1);
        }
        return happyMeta(req);
      },
    });
    const { state } = await newState();
    await complete(state);
    expect(seenInDb).toEqual([true, true]);
  });

  it('thoát HTML: tên Page chứa ký tự đặc biệt không thành mã HTML', async () => {
    const { state } = await newState();
    const res = await complete(state);
    expect(res.body).not.toContain('<b>Shop</b>');
    expect(res.body).toContain('&lt;b&gt;Shop&lt;/b&gt; &quot;B&quot;');
  });

  it('không có Page nào: 200 kèm hướng dẫn, không lỗi', async () => {
    await setup({ handler: (req) => (req.path === 'me/accounts' ? { body: { data: [] } } : happyMeta(req)) });
    const { state } = await newState();
    const res = await complete(state);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Chưa có Page nào');
  });

  it('kết nối lại cùng tenant: làm mới token và đặt lại status active, không nhân đôi dòng', async () => {
    const { tenant, state } = await newState();
    await db.insert(pages).values({
      tenantId: tenant.id,
      fbPageId: 'P_A',
      name: 'Tên cũ',
      tokenEnc: realCrypto.encrypt('OLD_TOKEN', 'P_A'),
      status: 'token_invalid',
    });
    await complete(state);
    const [a] = await db.select().from(pages).where(eq(pages.fbPageId, 'P_A'));
    expect(a!.status).toBe('active');
    expect(a!.name).toBe('Cửa hàng A');
    expect(realCrypto.decrypt(a!.tokenEnc, 'P_A')).toBe('PAGE_TOKEN_A');
    expect(await db.select().from(pages)).toHaveLength(2);
  });
});

describe('GET /auth/facebook/callback: từ chối và lỗi', () => {
  it('state sai, thiếu hoặc giả: 400 và KHÔNG gọi Meta', async () => {
    const { state } = await newState();
    const cookie = cookieFrom(await start(state));
    const fake = 'x'.repeat(43);
    expect((await callback({ code: 'GOOD_CODE', state: fake }, cookie)).statusCode).toBe(400);
    expect((await callback({ code: 'GOOD_CODE' }, cookie)).statusCode).toBe(400);
    expect((await callback({ state }, cookie)).statusCode).toBe(400);
    expect((await callback({}, cookie)).statusCode).toBe(400);
    expect(meta.calls).toHaveLength(0);
  });

  it('thiếu cookie hoặc sai cookie (ví dụ state bị lộ cho người khác): 400, không gọi Meta, state không bị đốt', async () => {
    const { state } = await newState();
    const good = cookieFrom(await start(state));
    expect((await callback({ code: 'GOOD_CODE', state })).statusCode).toBe(400); // không cookie
    const wrong = `${OAUTH_COOKIE}=${randomBytes(32).toString('base64url')}`;
    expect((await callback({ code: 'GOOD_CODE', state }, wrong)).statusCode).toBe(400);
    expect((await callback({ code: 'GOOD_CODE', state }, `${OAUTH_COOKIE}=rac`)).statusCode).toBe(400); // sai dạng
    expect(meta.calls).toHaveLength(0);
    // người dùng thật vẫn hoàn tất được
    expect((await callback({ code: 'GOOD_CODE', state }, good)).statusCode).toBe(200);
  });

  it('phát lại callback với cùng state và cookie: lần hai bị từ chối, không gọi Meta thêm', async () => {
    const { state } = await newState();
    const cookie = cookieFrom(await start(state));
    expect((await callback({ code: 'GOOD_CODE', state }, cookie)).statusCode).toBe(200);
    const after = meta.calls.length;
    expect((await callback({ code: 'GOOD_CODE', state }, cookie)).statusCode).toBe(400);
    expect(meta.calls).toHaveLength(after);
  });

  it('state hết hạn: 400', async () => {
    const tenant = await createTenant(db, 'A');
    const state = await createOAuthState(db, tenant.id, -1);
    expect((await callback({ code: 'GOOD_CODE', state }, `${OAUTH_COOKIE}=${randomBytes(32).toString('base64url')}`)).statusCode).toBe(400);
    expect(meta.calls).toHaveLength(0);
  });

  it('người dùng hủy (error=access_denied): 400, không gọi Meta, thử lại được trong hạn', async () => {
    const { state } = await newState();
    const cookie = cookieFrom(await start(state));
    const res = await callback({ error: 'access_denied', error_reason: 'user_denied', state }, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Chưa được cấp quyền');
    expect(meta.calls).toHaveLength(0);
    expect((await callback({ code: 'GOOD_CODE', state }, cookie)).statusCode).toBe(200);
  });

  it('Meta từ chối đổi code: 502, không lưu Page nào, không lộ code', async () => {
    const { state } = await newState();
    const res = await complete(state, { code: 'BAD_CODE_ABC' });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('BAD_CODE_ABC');
    expect(await db.select().from(pages)).toHaveLength(0);
  });

  it('lỗi hệ thống không phải của Meta (ví dụ DB): trang HTML 500, không lộ chi tiết lỗi', async () => {
    const graph: OAuthRouteOptions['graph'] = {
      loginUrl: () => 'https://www.facebook.com/x',
      exchangeCode: async () => 'S',
      exchangeLongLived: async () => 'L',
      listPages: async () => {
        throw new Error('connection to server at "10.0.0.5" failed: password=SUPERSECRET');
      },
      subscribePage: async () => {},
    };
    await setup({ graph });
    const { state } = await newState();
    const res = await complete(state);
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toContain('Có lỗi hệ thống');
    expect(res.body).not.toContain('SUPERSECRET');
    expect(res.body).not.toContain('10.0.0.5');
  });

  it('đăng ký webhook lỗi cho một Page: Page vẫn được lưu, báo rõ "chưa nhận được tin", Page kia vẫn kết nối', async () => {
    await setup({ handler: (req) => (req.path === 'P_B/subscribed_apps' ? metaError(200, 'Permissions error', 403) : happyMeta(req)) });
    const { state } = await newState();
    const res = await complete(state);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Kết nối xong một phần');
    expect(res.body).toContain('chưa nhận được tin');
    expect(res.body).toContain('200'); // mã lỗi Meta
    const rows = await db.select().from(pages);
    expect(rows.find((r) => r.fbPageId === 'P_A')!.subscribedAt).not.toBeNull();
    const b = rows.find((r) => r.fbPageId === 'P_B')!;
    expect(b.subscribedAt).toBeNull();
    expect(b.status).toBe('active');
  });

  it('đăng ký webhook gặp lỗi 190 (token hỏng): đánh dấu token_invalid', async () => {
    await setup({ handler: (req) => (req.path === 'P_A/subscribed_apps' ? metaError(190, 'Session invalid') : happyMeta(req)) });
    const { state } = await newState();
    await complete(state);
    const [a] = await db.select().from(pages).where(eq(pages.fbPageId, 'P_A'));
    expect(a!.status).toBe('token_invalid');
  });

  it('Page đang thuộc tenant khác: KHÔNG ghi đè token hay chủ sở hữu, không đăng ký webhook, báo rõ', async () => {
    const other = await createTenant(db, 'Công ty B');
    const otherToken = realCrypto.encrypt('OTHER_TENANT_TOKEN', 'P_A');
    await db.insert(pages).values({ tenantId: other.id, fbPageId: 'P_A', name: 'Của B', tokenEnc: otherToken });
    const { tenant, state } = await newState();
    const res = await complete(state);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('thuộc doanh nghiệp khác');

    const [a] = await db.select().from(pages).where(eq(pages.fbPageId, 'P_A'));
    expect(a!.tenantId).toBe(other.id);
    expect(a!.name).toBe('Của B');
    expect(a!.tokenEnc).toBe(otherToken);
    expect(meta.calls.some((c) => c.path === 'P_A/subscribed_apps')).toBe(false);
    const [b] = await db.select().from(pages).where(eq(pages.fbPageId, 'P_B'));
    expect(b!.tenantId).toBe(tenant.id);
  });
});

describe('kết nối lại Page đã có', () => {
  it('đăng ký mới thất bại thì KHÔNG giữ subscribed_at của lần trước (không được nói dối rằng đang nhận tin)', async () => {
    await setup({ handler: (req) => (req.path === 'P_A/subscribed_apps' ? metaError(200, 'Permissions error', 403) : happyMeta(req)) });
    const { tenant, state } = await newState();
    await db.insert(pages).values({
      tenantId: tenant.id,
      fbPageId: 'P_A',
      name: 'Cũ',
      tokenEnc: realCrypto.encrypt('OLD', 'P_A'),
      subscribedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await complete(state);
    const [a] = await db.select().from(pages).where(eq(pages.fbPageId, 'P_A'));
    expect(a!.subscribedAt).toBeNull();
    expect(a!.status).toBe('active');
  });

  it('đăng ký mới thành công thì subscribed_at được đặt lại thành mốc mới', async () => {
    const { tenant, state } = await newState();
    const old = new Date('2026-01-01T00:00:00Z');
    await db.insert(pages).values({ tenantId: tenant.id, fbPageId: 'P_A', name: 'Cũ', tokenEnc: realCrypto.encrypt('OLD', 'P_A'), subscribedAt: old });
    await complete(state);
    const [a] = await db.select().from(pages).where(eq(pages.fbPageId, 'P_A'));
    expect(a!.subscribedAt!.getTime()).toBeGreaterThan(old.getTime());
  });
});

describe('connectPages: lỗi của một Page không làm mất các Page còn lại', () => {
  const fbPages = ['P1', 'P2', 'P3'].map((id) => ({ id, name: `Page ${id}`, accessToken: `TOKEN_${id}` }));

  it('lỗi không phải của Meta khi đăng ký một Page: Page đó báo lỗi, các Page khác vẫn kết nối', async () => {
    const tenant = await createTenant(db, 'A');
    const errors: string[] = [];
    const outcomes = await connectPages(
      {
        db,
        crypto: realCrypto,
        graph: {
          listPages: async () => fbPages,
          subscribePage: async (id) => {
            if (id === 'P2') throw new TypeError('lỗi bất ngờ');
          },
        },
        onError: (_e, id) => errors.push(id),
      },
      tenant.id,
      'USER',
    );
    expect(outcomes.map((o) => [o.fbPageId, o.status])).toEqual([
      ['P1', 'connected'],
      ['P2', 'subscribe_failed'],
      ['P3', 'connected'],
    ]);
    expect(errors).toEqual(['P2']);
    expect(await db.select().from(pages)).toHaveLength(3);
  });

  it('lỗi khi lưu (mã hóa) một Page: save_failed, các Page khác vẫn được lưu và đăng ký', async () => {
    const tenant = await createTenant(db, 'A');
    const subscribed: string[] = [];
    const flaky: TokenCrypto = {
      encrypt: (plain, aad) => {
        if (aad === 'P2') throw new Error('lỗi mã hóa giả lập');
        return realCrypto.encrypt(plain, aad);
      },
      decrypt: realCrypto.decrypt,
    };
    const outcomes = await connectPages(
      {
        db,
        crypto: flaky,
        graph: { listPages: async () => fbPages, subscribePage: async (id) => void subscribed.push(id) },
      },
      tenant.id,
      'USER',
    );
    expect(outcomes.map((o) => [o.fbPageId, o.status])).toEqual([
      ['P1', 'connected'],
      ['P2', 'save_failed'],
      ['P3', 'connected'],
    ]);
    expect(subscribed).toEqual(['P1', 'P3']); // Page không lưu được thì không đăng ký
    expect((await db.select().from(pages)).map((p) => p.fbPageId).sort()).toEqual(['P1', 'P3']);
  });

  it('mã hóa một lần cho mỗi Page: ciphertext trong DB giải mã đúng', async () => {
    const tenant = await createTenant(db, 'A');
    await connectPages({ db, crypto: realCrypto, graph: { listPages: async () => fbPages, subscribePage: async () => {} } }, tenant.id, 'USER');
    const [p1] = await db.select().from(pages).where(eq(pages.fbPageId, 'P1'));
    expect(realCrypto.decrypt(p1!.tokenEnc, 'P1')).toBe('TOKEN_P1');
  });

  it('Meta đã đăng ký thành công nhưng ghi subscribed_at vào DB lỗi: vẫn báo connected (đúng thực tế) và ghi lỗi', async () => {
    const tenant = await createTenant(db, 'A');
    const errors: string[] = [];
    const flakyDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'update') {
          return (table: typeof pages) => ({
            set: (values: Record<string, unknown>) => {
              if (values.subscribedAt) throw new Error('db down khi ghi subscribed_at');
              return target.update(table).set(values);
            },
          });
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const outcomes = await connectPages(
      { db: flakyDb, crypto: realCrypto, graph: { listPages: async () => [fbPages[0]!], subscribePage: async () => {} }, onError: (_e, id) => errors.push(id) },
      tenant.id,
      'USER',
    );
    expect(outcomes.map((o) => o.status)).toEqual(['connected']); // không bị báo nhầm là đăng ký thất bại
    expect(errors).toEqual(['P1']); // lỗi được ghi lại chứ không biến mất
  });

  it('lỗi DB khi đánh dấu token_invalid không bị nuốt: được báo qua onError', async () => {
    const tenant = await createTenant(db, 'A');
    const errors: string[] = [];
    const flakyDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'update') {
          return (table: typeof pages) => ({
            set: (values: Record<string, unknown>) => {
              if (values.status === 'token_invalid') throw new Error('db down khi đổi status');
              return target.update(table).set(values);
            },
          });
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const outcomes = await connectPages(
      {
        db: flakyDb,
        crypto: realCrypto,
        graph: {
          listPages: async () => [fbPages[0]!],
          subscribePage: async () => {
            throw new GraphApiError('token hết hạn', 400, 190, null, 'OAuthException');
          },
        },
        onError: (_e, id) => errors.push(id),
      },
      tenant.id,
      'USER',
    );
    expect(outcomes.map((o) => o.status)).toEqual(['subscribe_failed']);
    expect(errors).toEqual(['P1']);
  });

  it('lỗi Meta 190 được nhận diện qua GraphApiError.isTokenInvalid', () => {
    expect(new GraphApiError('x', 400, 190, null, 'OAuthException').isTokenInvalid).toBe(true);
    expect(new GraphApiError('x', 400, 200, null, null).isTokenInvalid).toBe(false);
  });
});

describe('bí mật không lọt ra ngoài', () => {
  it('log và phản hồi không chứa code, state, nonce, user token, Page token hay app secret', async () => {
    const { state } = await newState();
    const startRes = await start(state);
    const cookie = cookieFrom(startRes);
    const nonce = cookie.split('=')[1]!;
    const ok = await callback({ code: 'GOOD_CODE', state }, cookie);

    const s2 = (await newState('B')).state;
    const bad = await complete(s2, { code: 'BAD_CODE_ABC' });

    const logs = logLines.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    const secrets = ['GOOD_CODE', 'BAD_CODE_ABC', state, s2, nonce, 'SHORT_TOKEN', 'LONG_TOKEN', 'PAGE_TOKEN_A', 'PAGE_TOKEN_B', FB_APP_SECRET, APP_SECRET];
    for (const s of secrets) {
      expect(logs).not.toContain(s);
      expect(ok.body).not.toContain(s);
      expect(bad.body).not.toContain(s);
      expect(startRes.body).not.toContain(s);
    }
  });
});
