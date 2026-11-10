/** Đội: chỉ `manager` và `owner`. Đăng ký bên trong `apiRoutes` nên kế thừa `requireAuth`. */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Mailer } from '../auth/mailer.js';
import { changeRole, createInvite, listTeam, removeMember, revokeInvite, TeamError, type Actor } from '../auth/invites.js';
import type { Db } from '../db/client.js';
import { apiError, requireRole } from './guard.js';

export interface TeamRouteOptions {
  db: Db;
  mailer: Mailer;
  publicBaseUrl: string;
  now: () => Date;
}

const uuid = z.string().uuid();
const role = z.enum(['owner', 'manager', 'sale']);
const inviteBody = z.object({ role, email: z.string().max(300).optional() });
const roleBody = z.object({ role });

const STATUS = { forbidden: 403, not_found: 404, last_owner: 409, invalid_token: 400, invalid: 422 } as const;

export const teamRoutes: FastifyPluginAsync<TeamRouteOptions> = async (app, opts) => {
  const { db } = opts;
  const guard = { preHandler: requireRole('manager', 'owner') };
  const actor = (req: { auth?: { tenantId: string; userId: string; role: Actor['role'] } }): Actor => ({ tenantId: req.auth!.tenantId, userId: req.auth!.userId, role: req.auth!.role });
  const fail = (reply: Parameters<typeof apiError>[0], e: unknown) => {
    if (e instanceof TeamError) return apiError(reply, STATUS[e.code], e.code, e.message);
    throw e;
  };

  app.get('/api/team', guard, async (req) => ({ ...(await listTeam(db, req.auth!.tenantId, opts.now())), me: req.auth!.userId }));

  app.post('/api/team/invites', guard, async (req, reply) => {
    const b = inviteBody.safeParse(req.body);
    if (!b.success) return apiError(reply, 422, 'invalid', 'Thiếu hoặc sai thông tin lời mời.');
    try {
      const inv = await createInvite(db, actor(req), { role: b.data.role, ...(b.data.email ? { email: b.data.email } : {}) }, opts.now());
      const link = `${opts.publicBaseUrl}/?invite=${inv.token}`;
      let emailed = false;
      if (b.data.email) {
        try {
          await opts.mailer.send(b.data.email, 'Lời mời tham gia SalesMind', `${req.auth!.displayName} mời bạn tham gia doanh nghiệp trên SalesMind. Mở liên kết (hiệu lực 7 ngày): ${link}`);
          emailed = true;
        } catch {
          emailed = false; // không gửi được thư không làm hỏng lời mời: người mời vẫn sao chép được liên kết
        }
      }
      return reply.code(201).send({ id: inv.id, link, expiresAt: inv.expiresAt, emailed });
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { id: string } }>('/api/team/invites/:id/revoke', guard, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return apiError(reply, 404, 'not_found', 'Không có lời mời này.');
    try {
      await revokeInvite(db, actor(req), req.params.id, opts.now());
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.patch<{ Params: { userId: string } }>('/api/team/members/:userId', guard, async (req, reply) => {
    const b = roleBody.safeParse(req.body);
    if (!uuid.safeParse(req.params.userId).success) return apiError(reply, 404, 'not_found', 'Không có thành viên này.');
    if (!b.success) return apiError(reply, 422, 'invalid', 'Vai trò không hợp lệ.');
    try {
      await changeRole(db, actor(req), req.params.userId, b.data.role);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { userId: string } }>('/api/team/members/:userId', guard, async (req, reply) => {
    if (!uuid.safeParse(req.params.userId).success) return apiError(reply, 404, 'not_found', 'Không có thành viên này.');
    try {
      await removeMember(db, actor(req), req.params.userId);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });
};
