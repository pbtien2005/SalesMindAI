import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { TokenCrypto } from '../crypto/token-crypto.js';
import type { Db } from '../db/client.js';
import { GraphApiError, type GraphClient } from '../meta/graph-client.js';
import { connectPages, type PageOutcome } from './connect-pages.js';
import { claimOAuthState, consumeOAuthState, newNonce, NONCE_FORMAT, STATE_TTL_SECONDS } from './oauth-state.js';
import { OAUTH_CALLBACK_PATH, OAUTH_START_PATH } from './paths.js';

export { OAUTH_CALLBACK_PATH, OAUTH_START_PATH } from './paths.js';

export interface OAuthRouteOptions {
  db: Db;
  graph: Pick<GraphClient, 'loginUrl' | 'exchangeCode' | 'exchangeLongLived' | 'listPages' | 'subscribePage'>;
  crypto: TokenCrypto;
  /** URL gốc công khai, không có dấu / cuối. */
  publicBaseUrl: string;
  /**
   * Giới hạn số request mỗi IP cho `/auth/facebook/*`. Mặc định 30 mỗi phút. Hai route này công khai và
   * mỗi request chạm DB (kiểm tra state), nên cần chặn việc gọi dồn dập.
   */
  rateLimit?: { max: number; timeWindowMs: number };
}

/** Cookie gắn luồng kết nối với đúng trình duyệt đã mở liên kết. */
export const OAUTH_COOKIE = 'sm_oauth';

// State do ta sinh luôn là 32 byte base64url (43 ký tự): sai định dạng thì bỏ ngay, không chạm DB.
const stateParam = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const startQuery = z.object({ state: stateParam });
const callbackQuery = z.object({
  code: z.string().min(1).max(2000).optional(),
  state: stateParam.optional(),
  error: z.string().max(200).optional(),
});

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function html(reply: FastifyReply, status: number, title: string, body: string) {
  return reply
    .code(status)
    .header('content-type', 'text/html; charset=utf-8')
    // Trang chứa kết quả kết nối: không cache, và không rò URL (có state) qua Referer.
    .header('cache-control', 'no-store')
    .header('referrer-policy', 'no-referrer')
    .header('x-content-type-options', 'nosniff')
    .send(
      `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem">` +
        `<h1>${escapeHtml(title)}</h1>${body}</body></html>`,
    );
}

const retryHint = '<p>Hãy nhờ quản trị viên tạo liên kết kết nối mới rồi thử lại (mỗi liên kết chỉ dùng được một lần).</p>';

function summarize(outcomes: PageOutcome[]): { title: string; body: string } {
  if (outcomes.length === 0) {
    return {
      title: 'Chưa có Page nào được kết nối',
      body: '<p>Bạn chưa chọn Page nào, hoặc tài khoản chưa quản lý Page nào. Hãy thử lại và chọn ít nhất một Page.</p>' + retryHint,
    };
  }
  const li = (o: PageOutcome, note = '') => `<li><strong>${escapeHtml(o.name)}</strong>${note}</li>`;
  const by = <S extends PageOutcome['status']>(s: S) => outcomes.filter((o): o is Extract<PageOutcome, { status: S }> => o.status === s);
  const ok = by('connected');
  const failed = by('subscribe_failed');
  const other = by('owned_by_other_tenant');
  const saveFailed = by('save_failed');

  let body = '';
  if (ok.length) body += `<p>Đã kết nối ${ok.length} Page:</p><ul>${ok.map((o) => li(o)).join('')}</ul>`;
  if (failed.length) {
    body +=
      `<p>Đã lưu nhưng <strong>chưa nhận được tin</strong> (đăng ký webhook thất bại) cho ${failed.length} Page:</p>` +
      `<ul>${failed.map((o) => li(o, o.graphCode ? ` (mã lỗi Meta ${o.graphCode})` : '')).join('')}</ul>`;
  }
  if (other.length) {
    body += `<p>Không kết nối được ${other.length} Page vì đang thuộc doanh nghiệp khác:</p><ul>${other.map((o) => li(o)).join('')}</ul>`;
  }
  if (saveFailed.length) {
    body += `<p>Không lưu được ${saveFailed.length} Page do lỗi hệ thống:</p><ul>${saveFailed.map((o) => li(o)).join('')}</ul>`;
  }
  const allOk = ok.length === outcomes.length;
  return { title: allOk ? 'Kết nối thành công' : 'Kết nối xong một phần', body: body + (allOk ? '' : retryHint) };
}

/**
 * Luồng Facebook Login để kết nối Page, không cần giao diện:
 * 1) quản trị viên chạy CLI để tạo liên kết `/auth/facebook/start?state=...` (state dùng một lần);
 * 2) người dùng mở liên kết: trình duyệt đó "nhận" state (cookie `sm_oauth`), được chuyển sang
 *    Facebook để cấp quyền;
 * 3) Facebook chuyển về `/auth/facebook/callback`: phải đúng state VÀ đúng cookie của trình duyệt
 *    đã mở liên kết, rồi mới đổi code lấy token, lưu Page (token mã hóa) và đăng ký webhook.
 * Không có state hợp lệ thì không làm được gì, nên chưa cần đăng nhập người dùng ở module này.
 *
 * Giới hạn đã biết: state bị tiêu thụ trước khi gọi Meta (để chống phát lại), nên lỗi tạm thời sau
 * đó (mạng, Meta 5xx) buộc phải tạo liên kết mới.
 */
export const oauthRoutes: FastifyPluginAsync<OAuthRouteOptions> = async (app, opts) => {
  const redirectUri = `${opts.publicBaseUrl}${OAUTH_CALLBACK_PATH}`;

  // Plugin này không bọc bằng fastify-plugin nên giới hạn chỉ áp dụng cho các route /auth/facebook/*.
  // Khóa theo IP: sau proxy hoặc tunnel phải bật trustProxy của Fastify, nếu không mọi request có cùng IP của proxy.
  await app.register(rateLimit, {
    max: opts.rateLimit?.max ?? 30,
    timeWindow: opts.rateLimit?.timeWindowMs ?? 60_000,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Quá nhiều yêu cầu, thử lại sau ${Math.ceil(ctx.ttl / 1000)} giây.`,
    }),
  });
  const secure = opts.publicBaseUrl.startsWith('https://');
  const cookie = (value: string, maxAge: number) =>
    `${OAUTH_COOKIE}=${value}; Path=/auth/facebook; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  app.get(OAUTH_START_PATH, async (req, reply) => {
    const q = startQuery.safeParse(req.query);
    const existing = readCookie(req.headers.cookie, OAUTH_COOKIE);
    const nonce = existing && NONCE_FORMAT.test(existing) ? existing : newNonce();
    if (!q.success || !(await claimOAuthState(opts.db, q.data.state, nonce))) {
      return html(reply, 400, 'Liên kết không hợp lệ', '<p>Liên kết kết nối không đúng, đã dùng, đã hết hạn hoặc đang được mở ở trình duyệt khác.</p>' + retryHint);
    }
    return reply
      .header('set-cookie', cookie(nonce, STATE_TTL_SECONDS))
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .redirect(opts.graph.loginUrl({ redirectUri, state: q.data.state }), 302);
  });

  app.get(OAUTH_CALLBACK_PATH, async (req, reply) => {
    const q = callbackQuery.safeParse(req.query);
    if (!q.success) {
      return html(reply, 400, 'Yêu cầu không hợp lệ', retryHint);
    }
    const { code, state, error } = q.data;

    if (error) {
      // Người dùng bấm Hủy hoặc từ chối quyền. Không tiêu thụ state: có thể thử lại trong hạn.
      req.log.info({ error }, 'đăng nhập Facebook bị hủy hoặc từ chối');
      return html(reply, 400, 'Chưa được cấp quyền', '<p>Bạn đã hủy hoặc từ chối cấp quyền. Hãy mở lại liên kết và cấp đủ quyền được yêu cầu.</p>');
    }
    const nonce = readCookie(req.headers.cookie, OAUTH_COOKIE);
    if (!code || !state || !nonce || !NONCE_FORMAT.test(nonce)) {
      return html(reply, 400, 'Yêu cầu không hợp lệ', '<p>Hãy hoàn tất việc kết nối ngay trong trình duyệt đã mở liên kết (cần bật cookie).</p>' + retryHint);
    }

    // Tiêu thụ state TRƯỚC mọi việc khác để callback không thể bị phát lại.
    const consumed = await consumeOAuthState(opts.db, state, nonce);
    if (!consumed) {
      return html(reply, 400, 'Liên kết không hợp lệ', '<p>Liên kết đã được dùng, đã hết hạn hoặc không khớp với trình duyệt này.</p>' + retryHint);
    }
    reply.header('set-cookie', cookie('', 0)); // xóa cookie

    try {
      const short = await opts.graph.exchangeCode(code, redirectUri);
      const long = await opts.graph.exchangeLongLived(short);
      const outcomes = await connectPages(
        {
          db: opts.db,
          graph: opts.graph,
          crypto: opts.crypto,
          onError: (err, fbPageId) => req.log.error({ err, fbPageId }, 'lỗi khi lưu hoặc đăng ký Page'),
        },
        consumed.tenantId,
        long,
      );
      req.log.info({ pages: outcomes.length, connected: outcomes.filter((o) => o.status === 'connected').length }, 'đã kết nối Page');
      const s = summarize(outcomes);
      return html(reply, 200, s.title, s.body);
    } catch (err) {
      if (err instanceof GraphApiError) {
        // Thông báo của GraphApiError đã được loại token và secret.
        req.log.warn({ httpStatus: err.httpStatus, code: err.code, type: err.type }, 'lỗi khi kết nối Page với Facebook');
        return html(reply, 502, 'Không kết nối được với Facebook', '<p>Facebook từ chối hoặc không phản hồi.</p>' + retryHint);
      }
      // Lỗi hệ thống (DB...): vẫn trả trang HTML dễ hiểu thay vì JSON trống. Không đưa chi tiết lỗi ra ngoài.
      req.log.error({ err }, 'lỗi hệ thống khi kết nối Page');
      return html(reply, 500, 'Có lỗi hệ thống', '<p>Chưa kết nối được. Vui lòng thử lại sau.</p>' + retryHint);
    }
  });
};
