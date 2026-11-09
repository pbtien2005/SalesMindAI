import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { oauthRoutes, type OAuthRouteOptions } from './auth/oauth-routes.js';
import type { WebhookQueue } from './queue/boss.js';
import { webhookRoutes } from './webhook/routes.js';

export interface AppDeps {
  appSecret: string;
  verifyToken: string;
  queue: WebhookQueue;
  enqueueTimeoutMs?: number;
  /** Có thì bật luồng kết nối Page qua Facebook Login (`/auth/facebook/*`). */
  oauth?: OAuthRouteOptions;
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
 * Gắn serializer an toàn vào cấu hình logger (`true` hoặc object cấu hình pino).
 * Fastify 5 nhận logger dựng sẵn qua `loggerInstance`, trường hợp đó ta không sửa được serializer:
 * người gọi phải tự dùng `safeRequestSerializer` khi tạo pino, nếu không URL (gồm query) sẽ bị ghi.
 */
function withSafeLogging(opts: FastifyServerOptions): FastifyServerOptions {
  const logger = opts.logger;
  if (!logger) return opts;
  // `true` hoặc object cấu hình pino. Logger đã dựng sẵn (có .info) thì không đụng vào.
  const isConfig = logger === true || (typeof logger === 'object' && !('info' in logger));
  if (!isConfig) return opts;
  const base = logger === true ? {} : (logger as Exclude<typeof logger, boolean | FastifyBaseLogger>);
  return {
    ...opts,
    logger: { ...base, serializers: { ...base.serializers, req: safeRequestSerializer } },
  };
}

/**
 * Tạo app Fastify. Tách khỏi server.ts để test bằng app.inject().
 * Không truyền `deps` thì chỉ có /healthz (đủ cho test nhẹ).
 */
export function buildApp(opts: FastifyServerOptions = {}, deps?: AppDeps): FastifyInstance {
  const app = Fastify(withSafeLogging(opts));

  app.get('/healthz', async () => ({ status: 'ok' }));

  if (deps) {
    const { oauth, ...webhook } = deps;
    void app.register(webhookRoutes, webhook);
    if (oauth) void app.register(oauthRoutes, oauth);
  }

  return app;
}
