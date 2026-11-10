/**
 * Chốt chặn cho `/api/*`: chống CSRF (cookie phiên) và xác thực phiên.
 *
 * - Mọi `POST/PUT/PATCH/DELETE` dưới `/api` phải có `x-requested-with: salesmind` (header tùy chỉnh không thể gửi
 *   chéo trang nếu không có CORS, mà ta không bật CORS) và, nếu có `Origin`, phải cùng host với `Host`.
 * - `requireAuth` đặt `req.auth` từ cookie phiên; `requireRole` kiểm vai trò.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import type { MemberRole } from '../db/schema.js';
import { resolveSession, type AuthContext, type SessionOptions } from '../auth/session.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'salesmind';

export function cookieName(secure: boolean): string {
  return secure ? '__Host-sm_session' : 'sm_session';
}

export function apiError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerCsrfGuard(app: FastifyInstance, prefix = '/api/'): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith(prefix) || !UNSAFE.has(req.method)) return;
    if (req.headers[CSRF_HEADER] !== CSRF_VALUE) return apiError(reply, 403, 'csrf', 'Thiếu header chống giả mạo yêu cầu.');
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin !== 'null') {
      let host: string | null = null;
      try {
        host = new URL(origin).host;
      } catch {
        host = null;
      }
      if (host === null || host !== req.headers.host) return apiError(reply, 403, 'csrf', 'Nguồn yêu cầu không hợp lệ.');
    } else if (origin === 'null') {
      return apiError(reply, 403, 'csrf', 'Nguồn yêu cầu không hợp lệ.');
    }
  });
}

export interface AuthGuardOptions {
  db: Db;
  secureCookie: boolean;
  session?: SessionOptions;
  now?: () => Date;
}

export function makeRequireAuth(opts: AuthGuardOptions) {
  const name = cookieName(opts.secureCookie);
  return async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    const token = req.cookies?.[name];
    const ctx = token ? await resolveSession(opts.db, token, (opts.now ?? (() => new Date()))(), opts.session) : null;
    if (!ctx) return apiError(reply, 401, 'unauthenticated', 'Chưa đăng nhập hoặc phiên đã hết hạn.');
    req.auth = ctx;
    return undefined;
  };
}

export function requireRole(...roles: MemberRole[]) {
  return async function check(req: FastifyRequest, reply: FastifyReply) {
    if (!req.auth || !roles.includes(req.auth.role)) return apiError(reply, 403, 'forbidden', 'Bạn không có quyền thực hiện việc này.');
    return undefined;
  };
}
