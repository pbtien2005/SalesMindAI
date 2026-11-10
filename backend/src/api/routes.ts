/**
 * API nghiệp vụ (`/api/*`). Mọi route yêu cầu phiên đăng nhập; tenant lấy từ phiên (`req.auth.tenantId`),
 * KHÔNG bao giờ từ dữ liệu client gửi lên. Tài nguyên của tenant khác trả 404.
 * Route demo (đồng hồ, giả lập, đặt lại) chỉ tồn tại khi DEMO_MODE=true và chỉ dùng được với tenant demo.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { conversations } from '../db/schema.js';
import type { TokenCrypto } from '../crypto/token-crypto.js';
import { SimError, simulateCustomerMessage, simulatePageMessage } from '../demo/actions.js';
import { advanceClock, advanceClockTo } from '../demo/clock.js';
import { type DemoContext, getDemoContext, resetDemo } from '../demo/seed.js';
import { PERSONAS, type WebhookPoster } from '../demo/simulator.js';
import { decideProposal, ProposalError } from '../extraction/proposals.js';
import { FollowupError, stopFollowup } from '../followup/followup.js';
import { loadConversationSummaries, loadHome } from '../followup/overview.js';
import { apiError as err, makeRequireAuth, type AuthGuardOptions } from './guard.js';
import { loadConversationDetail, loadHistory } from './read-models.js';
import { nowFor } from './scope.js';

export interface ApiOptions {
  db: Db;
  appSecret: string;
  crypto: TokenCrypto;
  /** Gửi payload đã ký vào `/webhook` của chính server này (chỉ route demo dùng). */
  poster: WebhookPoster;
  log: { info(o: object, m?: string): void; warn(o: object, m?: string): void };
  /** Bật route demo (đồng hồ tua, giả lập, đặt lại). Chỉ khi DEMO_MODE=true. */
  demoMode: boolean;
  guard: AuthGuardOptions;
}

const uuid = z.string().uuid();
const decideBody = z.object({
  action: z.enum(['accept', 'edit', 'dismiss']),
  editedText: z.string().optional(),
  chosenAt: z.string().optional(),
});
const advanceBody = z
  .object({ minutes: z.number().positive().max(60 * 24 * 30).optional(), to: z.string().datetime({ offset: true }).optional() })
  .refine((b) => (b.minutes === undefined) !== (b.to === undefined), 'Cần đúng một trong minutes hoặc to');
const customerBody = z.union([
  z.object({ persona: z.string().min(1), text: z.string() }),
  z.object({ conversationId: uuid, text: z.string() }),
]);
const pageBody = z.object({ conversationId: uuid, text: z.string() });

export const apiRoutes: FastifyPluginAsync<ApiOptions> = async (app: FastifyInstance, opts) => {
  const { db } = opts;
  app.addHook('preHandler', makeRequireAuth(opts.guard));

  const nowOf = (tenantId: string) => nowFor(db, tenantId, opts.demoMode);

  app.get('/api/now', async (req) => ({ now: await nowOf(req.auth!.tenantId), role: req.auth!.role, roleName: req.auth!.displayName }));

  app.get('/api/inbox', async (req) => {
    const tenantId = req.auth!.tenantId;
    const now = await nowOf(tenantId);
    return { now, conversations: await loadConversationSummaries(db, tenantId, now) };
  });

  app.get('/api/home', async (req) => {
    const tenantId = req.auth!.tenantId;
    return { ...(await loadHome(db, tenantId, await nowOf(tenantId))), role: req.auth!.role };
  });

  app.get('/api/overdue', async (req) => {
    const tenantId = req.auth!.tenantId;
    return { overdue: (await loadHome(db, tenantId, await nowOf(tenantId))).overdue };
  });

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return err(reply, 404, 'not_found', 'Không có hội thoại này.');
    const tenantId = req.auth!.tenantId;
    const detail = await loadConversationDetail(db, tenantId, req.params.id, await nowOf(tenantId));
    if (!detail) return err(reply, 404, 'not_found', 'Không có hội thoại này.');
    return detail;
  });

  app.get<{ Params: { id: string } }>('/api/conversations/:id/history', async (req, reply) => {
    const tenantId = req.auth!.tenantId;
    if (!uuid.safeParse(req.params.id).success || !(await conversationTimes(db, tenantId, req.params.id))) return err(reply, 404, 'not_found', 'Không có hội thoại này.');
    return { history: await loadHistory(db, tenantId, req.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/proposals/:id/decide', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return err(reply, 404, 'not_found', 'Không có đề xuất này.');
    const b = decideBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, 'invalid', b.error.issues.map((i) => i.message).join('; '));
    const a = req.auth!;
    try {
      return await decideProposal(
        db,
        { tenantId: a.tenantId, proposalId: req.params.id, action: b.data.action, by: a.displayName, editedText: b.data.editedText, chosenAt: b.data.chosenAt },
        await nowOf(a.tenantId),
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
    const a = req.auth!;
    const times = uuid.safeParse(req.params.id).success ? await conversationTimes(db, a.tenantId, req.params.id) : null;
    if (!times) return err(reply, 404, 'not_found', 'Không có hội thoại này.');
    try {
      await stopFollowup(db, { tenantId: a.tenantId, conversationId: req.params.id, by: a.displayName }, times, await nowOf(a.tenantId));
      return { stopped: true };
    } catch (e) {
      if (e instanceof FollowupError) return err(reply, 409, e.code, e.message);
      throw e;
    }
  });

  if (!opts.demoMode) return;

  // ---- Route demo: chỉ DEMO_MODE, chỉ với thành viên của tenant demo. ----
  const demoCtx = async (req: { auth?: { tenantId: string } }, reply: FastifyReply): Promise<DemoContext | null> => {
    const ctx = await getDemoContext(db);
    if (!ctx) {
      await err(reply, 409, 'no_demo_data', 'Chưa có dữ liệu demo. Chạy: npm run cli -- demo:reset');
      return null;
    }
    if (ctx.tenantId !== req.auth!.tenantId) {
      await err(reply, 403, 'not_demo_tenant', 'Chỉ dùng được với doanh nghiệp demo.');
      return null;
    }
    return ctx;
  };
  const sim = (ctx: DemoContext) => ({ db, poster: opts.poster, appSecret: opts.appSecret, ctx });

  app.get('/api/personas', async () => ({ personas: Object.values(PERSONAS).map((p) => ({ key: p.key, displayName: p.displayName })) }));

  app.post('/api/clock/advance', async (req, reply) => {
    if (!(await demoCtx(req, reply))) return reply;
    const b = advanceBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, 'invalid', b.error.issues.map((i) => i.message).join('; '));
    try {
      const now = b.data.minutes !== undefined ? await advanceClock(db, b.data.minutes) : await advanceClockTo(db, new Date(b.data.to!));
      return { now };
    } catch (e) {
      return err(reply, 400, 'invalid', e instanceof Error ? e.message : String(e));
    }
  });

  app.post('/api/demo/reset', async (req, reply) => {
    const existing = await getDemoContext(db);
    if (!existing || existing.tenantId !== req.auth!.tenantId) return err(reply, 403, 'not_demo_tenant', 'Chỉ dùng được với doanh nghiệp demo.');
    const r = await resetDemo({ db, crypto: opts.crypto, log: opts.log });
    return { now: r.clockNow };
  });

  app.post('/api/demo/customer-message', async (req, reply) => {
    const ctx = await demoCtx(req, reply);
    if (!ctx) return reply;
    const b = customerBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, 'invalid', b.error.issues.map((i) => i.message).join('; '));
    try {
      const target = 'persona' in b.data ? { persona: b.data.persona } : { conversationId: b.data.conversationId };
      const r = await simulateCustomerMessage(sim(ctx), target, b.data.text, await nowOf(ctx.tenantId));
      return reply.code(202).send({ accepted: true, conversationId: r.conversationId });
    } catch (e) {
      if (e instanceof SimError) return err(reply, e.code === 'not_found' ? 404 : 400, e.code, e.message);
      throw e;
    }
  });

  app.post('/api/demo/page-message', async (req, reply) => {
    const ctx = await demoCtx(req, reply);
    if (!ctx) return reply;
    const b = pageBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, 'invalid', b.error.issues.map((i) => i.message).join('; '));
    try {
      await simulatePageMessage(sim(ctx), b.data.conversationId, b.data.text, await nowOf(ctx.tenantId));
      return reply.code(202).send({ accepted: true });
    } catch (e) {
      if (e instanceof SimError) return err(reply, e.code === 'not_found' ? 404 : 400, e.code, e.message);
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
