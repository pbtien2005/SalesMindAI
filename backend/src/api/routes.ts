/**
 * API nghiệp vụ (`/api/*`). Mọi route yêu cầu phiên đăng nhập; tenant lấy từ phiên (`req.auth.tenantId`),
 * KHÔNG bao giờ từ dữ liệu client gửi lên. Tài nguyên của tenant khác trả 404.
 * Route demo (đồng hồ, giả lập, đặt lại) chỉ tồn tại khi DEMO_MODE=true và chỉ dùng được với tenant demo.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { conversations, pages } from '../db/schema.js';
import type { TokenCrypto } from '../crypto/token-crypto.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEMO_IMAGE_FILES, SimError, simulateCustomerImage, simulateCustomerMessage, simulatePageMessage } from '../demo/actions.js';
import { advanceClock, advanceClockTo } from '../demo/clock.js';
import { type DemoContext, getDemoContext, resetDemo } from '../demo/seed.js';
import { PERSONAS, type WebhookPoster } from '../demo/simulator.js';
import { decideProposal, ProposalError } from '../extraction/proposals.js';
import { FollowupError, stopFollowup } from '../followup/followup.js';
import { loadHome, loadOrders } from '../followup/overview.js';
import { loadInboxPage } from '../followup/inbox.js';
import { apiError as err, makeRequireAuth, type AuthGuardOptions } from './guard.js';
import { loadConversationDetail, loadHistory } from './read-models.js';
import { OrderError, sendReplyDraft, updateDraftOrder, type SendReply } from '../orders/service.js';
import { confirmDeposit, confirmOrder, rejectPayment } from '../orders/payments.js';
import { nowFor } from './scope.js';
import { teamRoutes } from './team.js';
import { aiRoutes } from './ai.js';
import { tenantRoutes } from './tenant.js';
import { SendError, type MessageSender } from '../send/sender.js';
import { isDemoTenant } from './scope.js';
import { pageRoutes, type PageRouteOptions } from './pages.js';
import type { Mailer } from '../auth/mailer.js';

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
  mailer: Mailer;
  publicBaseUrl: string;
  /** Gửi tin thật qua Send API (không có thì route gửi trả 503). */
  sender?: MessageSender;
  /** `FB_APP_ID`: tin gửi từ SalesMind mang app_id này nên hiện là "SalesMind" (page_app). */
  ownAppId?: string;
  /** Thư mục ảnh demo (`demo-assets/`). Mặc định: cạnh `src/` (hoặc `dist/`). */
  assetDir?: string;
  /** Chế độ AI và hạn mức mặc định (hiển thị ở màn AI). */
  ai?: { mode: 'offline' | 'live'; defaultCap: number };
  /** Kết nối Page Facebook (chưa cấu hình thì các route kết nối trả 503). */
  facebook?: Pick<PageRouteOptions, 'facebookConfigured' | 'graph' | 'backfill'>;
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
  await app.register(pageRoutes, { db, crypto: opts.crypto, publicBaseUrl: opts.publicBaseUrl, facebookConfigured: opts.facebook?.facebookConfigured ?? false, ...(opts.facebook?.graph ? { graph: opts.facebook.graph } : {}), ...(opts.facebook?.backfill ? { backfill: opts.facebook.backfill } : {}) });
  await app.register(tenantRoutes, { db, crypto: opts.crypto, ...(opts.facebook?.graph ? { graph: opts.facebook.graph } : {}), now: opts.guard.now ?? (() => new Date()) });
  await app.register(aiRoutes, { db, mode: opts.ai?.mode ?? 'offline', defaultCap: opts.ai?.defaultCap ?? 500, now: opts.guard.now ?? (() => new Date()) });
  await app.register(teamRoutes, { db, mailer: opts.mailer, publicBaseUrl: opts.publicBaseUrl, now: opts.guard.now ?? (() => new Date()) });

  app.get('/api/now', async (req) => ({ now: await nowOf(req.auth!.tenantId), role: req.auth!.role, roleName: req.auth!.displayName }));

  const inboxQuery = z.object({ pageId: z.string().uuid().optional(), cursor: z.string().max(300).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
  app.get('/api/inbox', async (req, reply) => {
    const tenantId = req.auth!.tenantId;
    const q = inboxQuery.safeParse(req.query);
    if (!q.success) return err(reply, 400, 'invalid', 'Tham số hộp thư không hợp lệ.');
    if (q.data.pageId) {
      const [own] = await db.select({ id: pages.id }).from(pages).where(and(eq(pages.id, q.data.pageId), eq(pages.tenantId, tenantId)));
      if (!own) return err(reply, 404, 'not_found', 'Không có Page này.');
    }
    const now = await nowOf(tenantId);
    try {
      return { now, ...(await loadInboxPage(db, tenantId, now, q.data)) };
    } catch (e) {
      if (e instanceof RangeError) return err(reply, 400, 'invalid_cursor', 'Con trỏ phân trang không hợp lệ.');
      throw e;
    }
  });

  app.get('/api/home', async (req) => {
    const tenantId = req.auth!.tenantId;
    return { ...(await loadHome(db, tenantId, await nowOf(tenantId))), role: req.auth!.role };
  });

  app.get('/api/overdue', async (req) => {
    const tenantId = req.auth!.tenantId;
    const now = await nowOf(tenantId);
    return { now, overdue: (await loadHome(db, tenantId, now)).overdue };
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
        const status = { not_found: 404, not_pending: 409, needs_date: 422, past_date: 422, invalid: 400 }[e.code];
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

  // ---- Gửi tin cho khách: chỉ khi người dùng bấm. Tenant demo chỉ ghi giả lập; tenant thật gửi qua Send API. ----
  const sendBody = z.object({ text: z.string().max(5000) });
  const recent = new Map<string, { at: number; result: { messageId: string; sentAt: Date } }>();
  const SEND_STATUS: Record<string, number> = { not_found: 404, page_inactive: 409, window_closed: 422, token_invalid: 409, rate_limited: 429, user_unavailable: 422, meta_error: 502, network: 502, invalid: 422 };
  app.post<{ Params: { id: string } }>('/api/conversations/:id/send', async (req, reply) => {
    const a = req.auth!;
    if (!uuid.safeParse(req.params.id).success || !(await conversationTimes(db, a.tenantId, req.params.id))) return err(reply, 404, 'not_found', 'Không có hội thoại này.');
    const b = sendBody.safeParse(req.body);
    if (!b.success) return err(reply, 422, 'invalid', 'Thiếu nội dung tin nhắn.');
    const now = await nowOf(a.tenantId);
    // Khóa chống gửi trùng khi client thử lại cùng một lần bấm.
    const idem = req.headers['idempotency-key'];
    const key = typeof idem === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(idem) ? `${a.userId}:${req.params.id}:${idem}` : null;
    if (key) {
      for (const [k, v] of recent) if (Date.now() - v.at > 120_000) recent.delete(k);
      const hit = recent.get(key);
      if (hit) return { ok: true, ...hit.result, repeated: true };
    }
    try {
      if (opts.demoMode && (await isDemoTenant(db, a.tenantId))) {
        const ctx = await getDemoContext(db);
        if (!ctx) return err(reply, 409, 'no_demo_data', 'Chưa có dữ liệu demo.');
        await simulatePageMessage({ db, poster: opts.poster, appSecret: opts.appSecret, ctx }, req.params.id, b.data.text, now);
        return { ok: true, messageId: 'demo', sentAt: now, demo: true };
      }
      if (!opts.sender) return err(reply, 503, 'sender_unavailable', 'Chưa cấu hình gửi tin.');
      const result = await opts.sender.send({ tenantId: a.tenantId, conversationId: req.params.id, text: b.data.text, byUserId: a.userId }, now);
      if (key) recent.set(key, { at: Date.now(), result });
      return { ok: true, ...result };
    } catch (e) {
      if (e instanceof SendError) return err(reply, SEND_STATUS[e.code] ?? 502, e.code, e.message);
      if (e instanceof SimError) return err(reply, 422, 'invalid', e.message);
      throw e;
    }
  });

  // ---- Đơn nháp và tin nháp (cảnh 4–5). AI chỉ tạo nháp; mọi chuyển trạng thái do Sale bấm. ----
  const ORDER_STATUS: Record<string, number> = { not_found: 404, not_pending: 409, not_draft: 409, invalid: 422, deposit_not_reached: 422, address_required: 422 };
  const orderErr = (e: unknown, reply: FastifyReply) => {
    if (e instanceof OrderError) return err(reply, ORDER_STATUS[e.code] ?? 422, e.code, e.message);
    if (e instanceof SendError) return err(reply, SEND_STATUS[e.code] ?? 502, e.code, e.message);
    if (e instanceof SimError) return err(reply, 422, 'invalid', e.message);
    throw e;
  };
  /** Gửi qua đúng đường của tenant: demo ghi giả lập (không tới Messenger), tenant thật dùng Send API. */
  const sendFor = (a: { tenantId: string; userId: string }): SendReply => async (conversationId, text, now) => {
    if (opts.demoMode && (await isDemoTenant(db, a.tenantId))) {
      const ctx = await getDemoContext(db);
      if (!ctx) throw new SendError('page_inactive', 'Chưa có dữ liệu demo.');
      await simulatePageMessage({ db, poster: opts.poster, appSecret: opts.appSecret, ctx }, conversationId, text, now, opts.ownAppId);
      return;
    }
    if (!opts.sender) throw new SendError('page_inactive', 'Chưa cấu hình gửi tin.');
    await opts.sender.send({ tenantId: a.tenantId, conversationId, text, byUserId: a.userId }, now);
  };
  const patchBody = z.object({ address: z.string().max(300).optional(), quantity: z.number().int().optional(), customerName: z.string().max(300).optional(), phone: z.string().max(50).optional() });
  app.post<{ Params: { id: string } }>('/api/orders/:id/update', async (req, reply) => {
    const a = req.auth!;
    const b = patchBody.safeParse(req.body);
    if (!uuid.safeParse(req.params.id).success) return err(reply, 404, 'not_found', 'Không có đơn này.');
    if (!b.success) return err(reply, 422, 'invalid', 'Dữ liệu sửa đơn không hợp lệ.');
    try {
      await updateDraftOrder(db, { tenantId: a.tenantId, orderId: req.params.id, by: a.displayName, patch: b.data }, await nowOf(a.tenantId));
      return { ok: true };
    } catch (e) {
      return orderErr(e, reply);
    }
  });
  app.post<{ Params: { id: string } }>('/api/payments/:id/confirm', async (req, reply) => {
    const a = req.auth!;
    const b = z.object({ amountVnd: z.number().int().optional() }).safeParse(req.body ?? {});
    if (!uuid.safeParse(req.params.id).success) return err(reply, 404, 'not_found', 'Không có khoản thanh toán này.');
    if (!b.success) return err(reply, 422, 'invalid', 'Số tiền không hợp lệ.');
    try {
      return { ok: true, ...(await confirmDeposit(db, { tenantId: a.tenantId, paymentId: req.params.id, by: a.displayName, amountVnd: b.data.amountVnd }, await nowOf(a.tenantId))) };
    } catch (e) {
      return orderErr(e, reply);
    }
  });
  app.post<{ Params: { id: string } }>('/api/payments/:id/reject', async (req, reply) => {
    const a = req.auth!;
    if (!uuid.safeParse(req.params.id).success) return err(reply, 404, 'not_found', 'Không có khoản thanh toán này.');
    try {
      return { ok: true, ...(await rejectPayment(db, { tenantId: a.tenantId, paymentId: req.params.id, by: a.displayName }, await nowOf(a.tenantId))) };
    } catch (e) {
      return orderErr(e, reply);
    }
  });
  app.post<{ Params: { id: string } }>('/api/orders/:id/confirm', async (req, reply) => {
    const a = req.auth!;
    const b = z.object({ address: z.string().max(500) }).safeParse(req.body);
    if (!uuid.safeParse(req.params.id).success) return err(reply, 404, 'not_found', 'Không có đơn này.');
    if (!b.success) return err(reply, 422, 'address_required', 'Thiếu địa chỉ nhận hàng.');
    try {
      return { ok: true, ...(await confirmOrder(db, { tenantId: a.tenantId, orderId: req.params.id, by: a.displayName, address: b.data.address }, await nowOf(a.tenantId))) };
    } catch (e) {
      return orderErr(e, reply);
    }
  });
  app.get('/api/orders', async (req) => ({ orders: await loadOrders(db, req.auth!.tenantId) }));
  app.post<{ Params: { id: string } }>('/api/reply-drafts/:id/send', async (req, reply) => {
    const a = req.auth!;
    const b = z.object({ text: z.string().max(5000).optional() }).safeParse(req.body ?? {});
    if (!uuid.safeParse(req.params.id).success) return err(reply, 404, 'not_found', 'Không có tin nháp này.');
    if (!b.success) return err(reply, 422, 'invalid', 'Nội dung không hợp lệ.');
    try {
      const r = await sendReplyDraft({ db, send: sendFor(a) }, { tenantId: a.tenantId, replyDraftId: req.params.id, by: a.displayName, text: b.data.text }, await nowOf(a.tenantId));
      return { ok: true, ...r };
    } catch (e) {
      return orderErr(e, reply);
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

  const imageBody = z.union([z.object({ persona: z.string().min(1), file: z.string() }), z.object({ conversationId: uuid, file: z.string() })]);
  app.post('/api/demo/customer-image', async (req, reply) => {
    const ctx = await demoCtx(req, reply);
    if (!ctx) return reply;
    const b = imageBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, 'invalid', b.error.issues.map((i) => i.message).join('; '));
    try {
      const target = 'persona' in b.data ? { persona: b.data.persona } : { conversationId: b.data.conversationId };
      const r = await simulateCustomerImage(sim(ctx), target, b.data.file, await nowOf(ctx.tenantId));
      return reply.code(202).send({ accepted: true, conversationId: r.conversationId });
    } catch (e) {
      if (e instanceof SimError) return err(reply, e.code === 'not_found' ? 404 : 400, e.code, e.message);
      throw e;
    }
  });

  // Ảnh mẫu: danh sách cho phép cố định, không nhận đường dẫn tùy ý (không có :param để khỏi lẫn với id của tenant).
  const assetDir = opts.assetDir ?? fileURLToPath(new URL('../../demo-assets', import.meta.url));
  app.get('/api/demo/assets/*', async (req, reply) => {
    const file = (req.params as { '*': string })['*'];
    if (!(DEMO_IMAGE_FILES as readonly string[]).includes(file)) return err(reply, 404, 'not_found', 'Không có ảnh này.');
    const bytes = await readFile(`${assetDir}/${file}`);
    return reply.header('cache-control', 'no-store').type('image/png').send(bytes);
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
