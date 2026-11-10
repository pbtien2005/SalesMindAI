import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import cookie from '@fastify/cookie';
import { authRoutes, type AuthRouteOptions } from './api/auth-routes.js';
import { registerCsrfGuard } from './api/guard.js';
import { apiRoutes, type ApiOptions } from './api/routes.js';
import { oauthRoutes, type OAuthRouteOptions } from './auth/oauth-routes.js';
import type { WebhookPoster } from './demo/simulator.js';
import { healthRoutes, type ReadinessCheck } from './health.js';
import type { WebhookQueue } from './queue/boss.js';
import { privacyRoutes } from './privacy/routes.js';
import { hasWebBuild, registerWebStatic } from './web-static.js';
import { webhookRoutes } from './webhook/routes.js';

export interface AppDeps {
  appSecret: string;
  verifyToken: string;
  queue: WebhookQueue;
  enqueueTimeoutMs?: number;
  /** Có thì bật luồng kết nối Page qua Facebook Login (`/auth/facebook/*`). */
  oauth?: OAuthRouteOptions;
  /** Các kiểm tra cho `/readyz` (ví dụ DB, hàng đợi). Không có thì `/readyz` luôn trả sẵn sàng. */
  readiness?: ReadinessCheck[];
  readinessTimeoutMs?: number;
  /**
   * Có thì bật API demo `/api/*` (KHÔNG có đăng nhập; chỉ dùng khi DEMO_MODE=true, xem `src/api/routes.ts`).
   * `appSecret` dùng chung với webhook để ký tin giả lập.
   */
  api?: Pick<ApiOptions, 'db' | 'crypto' | 'log' | 'demoMode' | 'facebook' | 'sender' | 'ai'>;
  /** Có thì bật tài khoản: `/api/auth/*`, cookie phiên và chống CSRF cho mọi `/api/*`. */
  auth?: AuthRouteOptions;
  /** Thư mục bản build của `web/`. Có `index.html` thì backend phục vụ luôn giao diện (cùng origin). */
  webDist?: string;
}

/**
 * Serializer log cho request: chỉ ghi đường dẫn, bỏ query string.
 * Query string mang bí mật: `hub.verify_token` của Meta ở GET /webhook, và `code`/`state`
 * của OAuth (mốc 4). Fastify mặc định ghi nguyên URL nên phải thay.
 */
export function safeRequestSerializer(req: FastifyRequest) {
  return {
    method: req.method,
    url: req.url.split('?')[0],
    host: req.host,
    remoteAddress: req.ip,
  };
}

/**
 * Đường dẫn pino sẽ bị che trong log, phòng thủ thêm: code hiện không ghi các trường này, nhưng một
 * dòng log `{ err }` hay `{ payload }` sau này cũng không được làm lộ token, secret hay nội dung tin.
 * (`*.x` chỉ khớp một cấp lồng; `x` ở đầu khớp cấp trên cùng.)
 *
 * Đây là lưới an toàn, KHÔNG thay thế quy tắc "không đưa nội dung tin, token vào log": nó che theo TÊN
 * trường nên không bắt được nội dung lồng sâu hơn một cấp (ví dụ `{ payload: { entry: [...] } }`), và
 * ngược lại sẽ che cả log vô hại có trường tên `text` hoặc `token`. Đánh đổi có chủ ý để an toàn mặc định.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-hub-signature-256"]',
  'res.headers["set-cookie"]',
  ...['token', 'accessToken', 'access_token', 'tokenEnc', 'client_secret', 'appSecret', 'apiKey', 'ANTHROPIC_API_KEY', 'password', 'text'].flatMap((k) => [k, `*.${k}`]),
];

/** `x-request-id` do client gửi chỉ được tin khi đúng dạng an toàn (không có xuống dòng, độ dài hợp lý). */
const REQUEST_ID_FORMAT = /^[A-Za-z0-9._-]{1,64}$/;

function genReqId(req: { headers: Record<string, unknown> }): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID_FORMAT.test(incoming) ? incoming : randomUUID();
}

/**
 * Gắn serializer an toàn và redact vào cấu hình logger (`true` hoặc object cấu hình pino).
 * Fastify 5 nhận logger dựng sẵn qua `loggerInstance`, trường hợp đó ta không sửa được:
 * người gọi phải tự dùng `safeRequestSerializer` và `LOG_REDACT_PATHS` khi tạo pino.
 */
function withSafeLogging(opts: FastifyServerOptions): FastifyServerOptions {
  const logger = opts.logger;
  if (!logger) return opts;
  // `true` hoặc object cấu hình pino. Logger đã dựng sẵn (có .info) thì không đụng vào.
  const isConfig = logger === true || (typeof logger === 'object' && !('info' in logger));
  if (!isConfig) return opts;
  const base = logger === true ? {} : (logger as Exclude<typeof logger, boolean | FastifyBaseLogger>);
  const existing = base.redact;
  const existingPaths = Array.isArray(existing) ? existing : (existing?.paths ?? []);
  return {
    ...opts,
    logger: {
      ...base,
      serializers: { ...base.serializers, req: safeRequestSerializer },
      redact: { paths: [...LOG_REDACT_PATHS, ...existingPaths], censor: '[đã ẩn]' },
    },
  };
}

/**
 * Tạo app Fastify. Tách khỏi server.ts để test bằng app.inject().
 * Không truyền `deps` thì chỉ có /healthz và /readyz (đủ cho test nhẹ).
 *
 * Mọi request có `x-request-id` (lấy từ client nếu hợp lệ, nếu không thì sinh mới); id này có trong log
 * (`reqId`) và trong header phản hồi để đối chiếu log với một request cụ thể.
 */
export function buildApp(opts: FastifyServerOptions = {}, deps?: AppDeps): FastifyInstance {
  const app = Fastify({ genReqId, ...withSafeLogging(opts) });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  void app.register(healthRoutes, {
    ...(deps?.readiness ? { readiness: deps.readiness } : {}),
    ...(deps?.readinessTimeoutMs ? { checkTimeoutMs: deps.readinessTimeoutMs } : {}),
  });

  if (deps) {
    // Chọn rõ từng trường: thêm cấu hình mới vào AppDeps sẽ không vô tình lọt vào webhook.
    void app.register(webhookRoutes, {
      appSecret: deps.appSecret,
      verifyToken: deps.verifyToken,
      queue: deps.queue,
      ...(deps.enqueueTimeoutMs ? { enqueueTimeoutMs: deps.enqueueTimeoutMs } : {}),
    });
    if (deps.auth) void app.register(privacyRoutes, { db: deps.auth.db, appSecret: deps.appSecret, publicBaseUrl: deps.auth.publicBaseUrl });
    if (deps.api && !deps.auth) throw new Error('API nghiệp vụ cần cấu hình đăng nhập (deps.auth).');
    if (deps.oauth) void app.register(oauthRoutes, deps.oauth);
    if (deps.auth) {
      void app.register(cookie);
      registerCsrfGuard(app);
      void app.register(authRoutes, deps.auth);
    }
    if (deps.api) {
      // Tin giả lập đi vào đúng POST /webhook của chính server này (có ký chữ ký, qua hàng đợi và worker).
      const poster: WebhookPoster = {
        async post(rawBody, signature) {
          const res = await app.inject({
            method: 'POST',
            url: '/webhook',
            headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
            payload: rawBody,
          });
          return { status: res.statusCode };
        },
      };
      const a = deps.auth!;
      void app.register(apiRoutes, {
        ...deps.api,
        appSecret: deps.appSecret,
        poster,
        mailer: a.mailer,
        publicBaseUrl: a.publicBaseUrl,
        guard: { db: deps.api.db, secureCookie: a.publicBaseUrl.startsWith('https://'), ...(a.session ? { session: a.session } : {}), ...(a.now ? { now: a.now } : {}) },
      });
    }
  }

  if (deps?.webDist && hasWebBuild(deps.webDist)) registerWebStatic(app, deps.webDist);

  return app;
}
