/**
 * API demo (`/api/*`). Chỉ được đăng ký khi DEMO_MODE=true. KHÔNG có đăng nhập: vai trò (`x-demo-role`: lan hoặc ha)
 * chỉ để ghi "ai duyệt" và đổi màn hình, KHÔNG phải bảo mật. Chỉ dùng trên máy của bạn.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { conversations } from '../db/schema.js';
import type { TokenCrypto } from '../crypto/token-crypto.js';
import { SimError, simulateCustomerMessage, simulatePageMessage } from '../demo/actions.js';
import { advanceClock, advanceClockTo, getNow } from '../demo/clock.js';
import { type DemoContext, getDemoContext, resetDemo } from '../demo/seed.js';
import { PERSONAS, type WebhookPoster } from '../demo/simulator.js';
import { decideProposal, ProposalError } from '../extraction/proposals.js';
import { FollowupError, stopFollowup } from '../followup/followup.js';
import { loadConversationSummaries, loadHome } from '../followup/overview.js';
import { loadConversationDetail, loadHistory } from './read-models.js';

export interface ApiOptions {
  db: Db;
  appSecret: string;
  crypto: TokenCrypto;
  /** Gửi payload đã ký vào `/webhook` của chính server này. */
  poster: WebhookPoster;
  log: { info(o: object, m?: string): void; warn(o: object, m?: string): void };
}

export const ROLES = { lan: 'Lan', ha: 'chị Hà' } as const;
type Role = keyof typeof ROLES;

declare module 'fastify' {
  interface FastifyRequest {
    demoRole: Role;
  }
}

const err = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });

const uuid = z.string().uuid();
const decideBody = z.object({
  action: z.enum(['accept', 'edit', 'dismiss']),
  editedText: z.string().optional(),
  chosenAt: z.string().optional(),
});
const advanceBody = z.object({ minutes: z.number().positive().max(60 * 24 * 30).optional(), to: z.string().datetime({ offset: true }).optional() }).refine((b) => (b.minutes === undefined) !== (b.to === undefined), 'Cần đúng một trong minutes hoặc to');
const customerBody = z.union([
  z.object({ persona: z.string().min(1), text: z.string() }),
  z.object({ conversationId: uuid, text: z.string() }),
]);
const pageBody = z.object({ conversationId: uuid, text: z.string() });

export const apiRoutes: FastifyPluginAsync<ApiOptions> = async (app: FastifyInstance, opts) => {
  const { db } = opts;
  const withNow = () => getNow(db, true);

  app.addHook('preHandler', async (req, reply) => {
    const raw = req.headers['x-demo-role'];
    const role = (typeof raw === 'string' && raw !== '' ? raw : 'lan') as string;
    if (role !== 'lan' && role !== 'ha') return err(reply, 400, 'bad_role', 'x-demo-role chỉ nhận lan hoặc ha.');
    req.demoRole = role;
    return undefined;
  });

  /** Lấy tenant demo; chưa có dữ liệu thì báo cách khắc phục. */
  const needCtx = async (reply: FastifyReply): Promise<DemoContext | null> => {
    const ctx = await getDemoContext(db);
    if (!ctx) {
      await err(reply, 409, 'no_demo_data', 'Chưa có dữ liệu demo. Chạy: npm run cli -- demo:reset');
      return null;
    }
    return ctx;
  };

  const sim = (ctx: DemoContext) => ({ db, poster: opts.poster, appSecret: opts.appSecret, ctx });

  app.get('/api/now', async (req) => ({ now: await withNow(), role: req.demoRole, roleName: ROLES[req.demoRole] }));

  app.get('/api/personas', async () => ({ personas: Object.values(PERSONAS).map((p) => ({ key: p.key, displayName: p.displayName })) }));

  app.post('/api/clock/advance', async (req, reply) => {
    const b = advanceBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, 'invalid', b.error.issues.map((i) => i.message).join('; '));
    try {
      const now = b.data.minutes !== undefined ? await advanceClock(db, b.data.minutes) : await advanceClockTo(db, new Date(b.data.to!));
      return { now };
    } catch (e) {
      return err(reply, 400, 'invalid', e instanceof Error ? e.message : String(e));
    }
  });

  app.post('/api/demo/reset', async () => {
    const r = await resetDemo({ db, crypto: opts.crypto, log: opts.log });
    return { now: r.clockNow };
  });

  app.get('/api/inbox', async (_req, reply) => {
    const ctx = await needCtx(reply);
    if (!ctx) return reply;
    const now = await withNow();
    return { now, conversations: await loadConversationSummaries(db, ctx.tenantId, now) };
  });

  app.get('/api/home', async (req, reply) => {
    const ctx = await needCtx(reply);
    if (!ctx) return reply;
    return { ...(await loadHome(db, ctx.tenantId, await withNow())), role: req.demoRole };
  });

  app.get('/api/overdue', async (_req, reply) => {
    const ctx = await needCtx(reply);
    if (!ctx) return reply;
    return { overdue: (await loadHome(db, ctx.tenantId, await withNow())).overdue };
  });

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    const ctx = await needCtx(reply);
    if (!ctx) return reply;
    if (!uuid.safeParse(req.params.id).success) return err(reply, 400, 'invalid', 'ID hội thoại không hợp lệ.');
    const detail = await loadConversationDetail(db, ctx.tenantId, req.params.id, await withNow());
    if (!detail) return err(reply, 404, 'not_found', 'Không có hội thoại này.');
    return detail;
  });

  app.get<{ Params: { id: string } }>('/api/conversations/:id/history', async (req, reply) => {
    const ctx = await needCtx(reply);
    if (!ctx) return reply;
    if (!uuid.safeParse(req.params.id).success) return err(reply, 400, 'invalid', 'ID hội thoại không hợp lệ.');
    return { history: await loadHistory(db, ctx.tenantId, req.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/proposals/:id/decide', async (req, reply) => {
    const ctx = await needCtx(reply);
    if (!ctx) return reply;
    if (!uuid.safeParse(req.params.id).success) return err(reply, 400, 'invalid', 'ID đề xuất không hợp lệ.');
    const b = decideBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, 'invalid', b.error.issues.map((i) => i.message).join('; '));
    try {
      return await decideProposal(
        db,
        { tenantId: ctx.tenantId, proposalId: req.params.id, action: b.data.action, by: ROLES[req.demoRole], editedText: b.data.editedText, chosenAt: b.data.chosenAt },
        await withNow(),
      );
    } catch (e) {
      if (e instanceof ProposalError) {
        const status = { not_found: 404, not_pending: 409, needs_date: 422, invalid: 400 }[e.code];
        return err(reply, status, e.code, e.message);
      }
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>('/api/conversations/:id/stop-followup', async (req, reply) => {
    const ctx = await needCtx(reply);
    if (!ctx) return reply;
    if (!uuid.safeParse(req.params.id).success) return err(reply, 400, 'invalid', 'ID hội thoại không hợp lệ.');
    const times = await conversationTimes(db, ctx.tenantId, req.params.id);
    if (!times) return err(reply, 404, 'not_found', 'Không có hội thoại này.');
    try {
      await stopFollowup(db, { tenantId: ctx.tenantId, conversationId: req.params.id, by: ROLES[req.demoRole] }, times, await withNow());
      return { stopped: true };
    } catch (e) {
      if (e instanceof FollowupError) return err(reply, 409, e.code, e.message);
      throw e;
    }
  });

  app.post('/api/demo/customer-message', async (req, reply) => {
    const ctx = await needCtx(reply);
    if (!ctx) return reply;
    const b = customerBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, 'invalid', b.error.issues.map((i) => i.message).join('; '));
    try {
      const target = 'persona' in b.data ? { persona: b.data.persona } : { conversationId: b.data.conversationId };
      const r = await simulateCustomerMessage(sim(ctx), target, b.data.text, await withNow());
      return reply.code(202).send({ accepted: true, conversationId: r.conversationId });
    } catch (e) {
      if (e instanceof SimError) return err(reply, 400, 'invalid', e.message);
      throw e;
    }
  });

  app.post('/api/demo/page-message', async (req, reply) => {
    const ctx = await needCtx(reply);
    if (!ctx) return reply;
    const b = pageBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, 'invalid', b.error.issues.map((i) => i.message).join('; '));
    try {
      await simulatePageMessage(sim(ctx), b.data.conversationId, b.data.text, await withNow());
      return reply.code(202).send({ accepted: true });
    } catch (e) {
      if (e instanceof SimError) return err(reply, 400, 'invalid', e.message);
      throw e;
    }
  });
};

async function conversationTimes(db: Db, tenantId: string, conversationId: string) {
  const [c] = await db
    .select({ lastPageMessageAt: conversations.lastPageMessageAt, lastUserInteractionAt: conversations.lastUserInteractionAt })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));
  return c ?? null;
}
