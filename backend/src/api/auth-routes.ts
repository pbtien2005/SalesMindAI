/** Đăng ký, đăng nhập, đăng xuất, xác minh email, đặt lại và đổi mật khẩu. */
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Mailer } from '../auth/mailer.js';
import { validatePassword } from '../auth/password.js';
import { consumeUserToken, createSession, createUserToken, revokeSession, type SessionOptions } from '../auth/session.js';
import { AuthError, authenticate, createTenantWithOwner, findUserByEmail, setPassword } from '../auth/users.js';
import type { Db } from '../db/client.js';
import { DEMO_USERS } from '../demo/seed.js';
import { auditLog, users } from '../db/schema.js';
import { isDemoTenant } from './scope.js';
import { acceptInvite, inviteInfo, TeamError } from '../auth/invites.js';
import { apiError, cookieName, makeRequireAuth } from './guard.js';

export interface AuthRouteOptions {
  db: Db;
  mailer: Mailer;
  /** Đăng ký tự do (SIGNUP_MODE=open). Đóng thì `POST /api/auth/signup` trả 404. */
  signupOpen: boolean;
  /** Gốc công khai, dùng ghép liên kết trong thư. Cookie `Secure` khi là https. */
  publicBaseUrl: string;
  session?: SessionOptions;
  /** DEMO_MODE: bật `POST /api/auth/demo-login` (vào nhanh bằng tài khoản Lan hoặc chị Hà, không cần mật khẩu). */
  demoMode?: boolean;
  rateLimit?: { max: number; timeWindowMs: number };
  now?: () => Date;
}

const HOUR_MS = 3_600_000;
const credentials = z.object({ email: z.string().max(300), password: z.string().max(1000) });
const signupBody = z.object({ email: z.string().max(300), password: z.string().max(1000), displayName: z.string().max(200), businessName: z.string().max(300) });
const tokenBody = z.object({ token: z.string().max(200) });
const forgotBody = z.object({ email: z.string().max(300) });
const resetBody = z.object({ token: z.string().max(200), password: z.string().max(1000) });
const changeBody = z.object({ currentPassword: z.string().max(1000), newPassword: z.string().max(1000) });

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, opts) => {
  const { db } = opts;
  const now = opts.now ?? (() => new Date());
  const secure = opts.publicBaseUrl.startsWith('https://');
  const name = cookieName(secure);
  const requireAuth = makeRequireAuth({ db, secureCookie: secure, ...(opts.session ? { session: opts.session } : {}), now });

  // Giới hạn theo IP chỉ cho các route trong plugin này (không bọc fastify-plugin).
  await app.register(rateLimit, {
    max: opts.rateLimit?.max ?? 30,
    timeWindow: opts.rateLimit?.timeWindowMs ?? 60_000,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: { code: 'rate_limited', message: `Quá nhiều yêu cầu, thử lại sau ${Math.ceil(ctx.ttl / 1000)} giây.` },
    }),
  });

  const setCookie = (reply: Parameters<typeof apiError>[0], token: string, expiresAt: Date) =>
    reply.setCookie(name, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', expires: expiresAt });

  app.get('/api/auth/config', async () => ({ signupOpen: opts.signupOpen, demoLogin: opts.demoMode === true }));

  if (opts.demoMode) {
    app.post('/api/auth/demo-login', async (req, reply) => {
      const as = z.object({ as: z.enum(['lan', 'ha']) }).safeParse(req.body);
      if (!as.success) return apiError(reply, 422, 'invalid', 'Chọn lan hoặc ha.');
      const u = await findUserByEmail(db, DEMO_USERS[as.data.as].email);
      if (!u) return apiError(reply, 409, 'no_demo_data', 'Chưa có dữ liệu demo. Chạy: npm run cli -- demo:reset');
      const { token, expiresAt } = await createSession(db, u.id, { userAgent: String(req.headers['user-agent'] ?? '') }, now(), opts.session);
      setCookie(reply, token, expiresAt);
      return reply.send({ ok: true });
    });
  }

  app.post('/api/auth/signup', async (req, reply) => {
    if (!opts.signupOpen) return apiError(reply, 404, 'not_found', 'Không có đường dẫn này.');
    const b = signupBody.safeParse(req.body);
    if (!b.success) return apiError(reply, 422, 'invalid', 'Thiếu hoặc sai thông tin đăng ký.');
    try {
      const { userId, tenantId } = await createTenantWithOwner(db, b.data, now());
      await db.insert(auditLog).values({ tenantId, userId, action: 'tenant.signup' });
      const token = await createUserToken(db, userId, 'email_verify', now(), 48 * HOUR_MS);
      await opts.mailer.send(b.data.email, 'Xác minh email SalesMind', `Mở liên kết để xác minh email: ${opts.publicBaseUrl}/?verify=${token}`);
    } catch (e) {
      // Email đã có tài khoản: vẫn trả 202 như thành công để không lộ email nào đã đăng ký.
      if (!(e instanceof AuthError) || e.code === 'email_taken') return reply.code(202).send({ ok: true });
      return apiError(reply, 422, e.code, e.message);
    }
    return reply.code(202).send({ ok: true });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const b = credentials.safeParse(req.body);
    const fail = () => apiError(reply, 401, 'invalid_credentials', 'Email hoặc mật khẩu không đúng.');
    if (!b.success) return fail();
    const r = await authenticate(db, b.data.email, b.data.password, now());
    if (!r.ok) return fail();
    const { token, expiresAt } = await createSession(db, r.userId, { userAgent: String(req.headers['user-agent'] ?? '') }, now(), opts.session);
    setCookie(reply, token, expiresAt);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    await revokeSession(db, req.auth!.sessionId);
    reply.clearCookie(name, { path: '/', secure, httpOnly: true, sameSite: 'lax' });
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const a = req.auth!;
    const demoTenant = opts.demoMode === true && (await isDemoTenant(db, a.tenantId));
    return { user: { id: a.userId, email: a.email, displayName: a.displayName, role: a.role, tenantId: a.tenantId, emailVerified: a.emailVerified, demoTenant } };
  });

  app.post('/api/auth/invite-info', async (req, reply) => {
    const b = tokenBody.safeParse(req.body);
    const info = b.success ? await inviteInfo(db, b.data.token, now()) : null;
    if (!info) return apiError(reply, 400, 'invalid_token', 'Lời mời không hợp lệ hoặc đã hết hạn.');
    return info;
  });

  app.post('/api/auth/accept-invite', async (req, reply) => {
    const b = z.object({ token: z.string().max(200), displayName: z.string().max(200), password: z.string().max(1000), email: z.string().max(300).optional() }).safeParse(req.body);
    if (!b.success) return apiError(reply, 422, 'invalid', 'Thiếu thông tin.');
    try {
      const { userId } = await acceptInvite(db, b.data, now());
      const { token, expiresAt } = await createSession(db, userId, { userAgent: String(req.headers['user-agent'] ?? '') }, now(), opts.session);
      setCookie(reply, token, expiresAt);
      return reply.code(201).send({ ok: true });
    } catch (e) {
      if (e instanceof TeamError) return apiError(reply, 400, e.code, e.message);
      if (e instanceof AuthError) return apiError(reply, e.code === 'email_taken' ? 409 : 422, e.code, e.message);
      throw e;
    }
  });

  app.post('/api/auth/verify-email', async (req, reply) => {
    const b = tokenBody.safeParse(req.body);
    const userId = b.success ? await consumeUserToken(db, b.data.token, 'email_verify', now()) : null;
    if (!userId) return apiError(reply, 400, 'invalid_token', 'Liên kết không hợp lệ hoặc đã hết hạn.');
    await db.update(users).set({ emailVerifiedAt: now() }).where(eq(users.id, userId));
    return reply.send({ ok: true });
  });

  app.post('/api/auth/forgot', async (req, reply) => {
    const b = forgotBody.safeParse(req.body);
    if (b.success) {
      const u = await findUserByEmail(db, b.data.email);
      if (u && u.status === 'active') {
        const token = await createUserToken(db, u.id, 'password_reset', now(), HOUR_MS);
        await opts.mailer.send(u.email, 'Đặt lại mật khẩu SalesMind', `Mở liên kết (hiệu lực 1 giờ): ${opts.publicBaseUrl}/?reset=${token}`);
      }
    }
    return reply.code(202).send({ ok: true });
  });

  app.post('/api/auth/reset', async (req, reply) => {
    const b = resetBody.safeParse(req.body);
    if (!b.success) return apiError(reply, 400, 'invalid_token', 'Liên kết không hợp lệ hoặc đã hết hạn.');
    const early = validatePassword(b.data.password, '');
    if (early) return apiError(reply, 422, 'weak_password', early); // chưa tiêu thụ token khi mật khẩu quá yếu
    const userId = await consumeUserToken(db, b.data.token, 'password_reset', now());
    if (!userId) return apiError(reply, 400, 'invalid_token', 'Liên kết không hợp lệ hoặc đã hết hạn.');
    try {
      await setPassword(db, userId, b.data.password);
    } catch (e) {
      if (e instanceof AuthError) return apiError(reply, 422, e.code, e.message);
      throw e;
    }
    return reply.send({ ok: true });
  });

  app.post('/api/auth/change-password', { preHandler: requireAuth }, async (req, reply) => {
    const b = changeBody.safeParse(req.body);
    if (!b.success) return apiError(reply, 422, 'invalid', 'Thiếu thông tin.');
    const a = req.auth!;
    const ok = await authenticate(db, a.email, b.data.currentPassword, now());
    if (!ok.ok) return apiError(reply, 403, 'invalid_credentials', 'Mật khẩu hiện tại không đúng.');
    try {
      await setPassword(db, a.userId, b.data.newPassword, a.sessionId);
    } catch (e) {
      if (e instanceof AuthError) return apiError(reply, 422, e.code, e.message);
      throw e;
    }
    await db.insert(auditLog).values({ tenantId: a.tenantId, userId: a.userId, action: 'user.password_changed' });
    return reply.send({ ok: true });
  });
};
