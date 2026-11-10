/** Page Facebook của doanh nghiệp: danh sách, kết nối, ngắt kết nối, lấy lại tin cũ. Chỉ `manager` và `owner`. */
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createOAuthState } from '../auth/oauth-state.js';
import { connectUrl } from '../auth/tenants.js';
import type { TokenCrypto } from '../crypto/token-crypto.js';
import type { Db } from '../db/client.js';
import { auditLog, conversations, pages, tenants, users } from '../db/schema.js';
import type { GraphClient } from '../meta/graph-client.js';
import { apiError, requireRole } from './guard.js';

export interface PageRouteOptions {
  db: Db;
  crypto: TokenCrypto;
  publicBaseUrl: string;
  /** `FB_APP_ID` và `APP_SECRET` đã được cấu hình thật (không phải giá trị mẫu). */
  facebookConfigured: boolean;
  graph?: Pick<GraphClient, 'unsubscribePage'>;
  backfill?: { enqueuePage(job: { pageId: string }): Promise<boolean> };
}

const uuid = z.string().uuid();

export interface PageView {
  id: string;
  fbPageId: string;
  name: string;
  status: 'active' | 'token_invalid' | 'disconnected';
  /** Webhook đã được đăng ký thành công (chưa chắc nhận được tin nếu thiếu field ở cấp App). */
  webhookSubscribed: boolean;
  conversations: number;
  lastMessageAt: Date | null;
  connectedBy: string | null;
}

export const pageRoutes: FastifyPluginAsync<PageRouteOptions> = async (app, opts) => {
  const { db } = opts;
  const guard = { preHandler: requireRole('manager', 'owner') };

  app.get('/api/pages', guard, async (req) => {
    const tenantId = req.auth!.tenantId;
    // Không chọn cột token: JSON trả ra không bao giờ có token.
    const rows = await db
      .select({
        id: pages.id,
        fbPageId: pages.fbPageId,
        name: pages.name,
        status: pages.status,
        subscribedAt: pages.subscribedAt,
        connectedBy: users.displayName,
        conversations: sql<number>`count(${conversations.id})::int`,
        lastMessageAt: sql<Date | null>`max(${conversations.lastMessageAt})`,
      })
      .from(pages)
      .leftJoin(conversations, eq(conversations.pageId, pages.id))
      .leftJoin(users, eq(users.id, pages.connectedByUserId))
      .where(eq(pages.tenantId, tenantId))
      .groupBy(pages.id, users.displayName)
      .orderBy(pages.createdAt);
    const [t] = await db.select({ ai: tenants.aiExtractionEnabled }).from(tenants).where(eq(tenants.id, tenantId));
    const list: PageView[] = rows.map((r) => ({
      id: r.id,
      fbPageId: r.fbPageId,
      name: r.name,
      status: r.status,
      webhookSubscribed: r.subscribedAt !== null,
      conversations: r.conversations,
      lastMessageAt: r.lastMessageAt ? new Date(r.lastMessageAt) : null,
      connectedBy: r.connectedBy,
    }));
    return { pages: list, aiEnabled: t?.ai ?? false, facebookConfigured: opts.facebookConfigured };
  });

  app.post('/api/pages/connect-url', guard, async (req, reply) => {
    const a = req.auth!;
    if (!opts.facebookConfigured) return apiError(reply, 503, 'facebook_not_configured', 'Chưa cấu hình ứng dụng Facebook (FB_APP_ID, APP_SECRET) trên máy chủ.');
    if (!a.emailVerified) return apiError(reply, 403, 'email_not_verified', 'Cần xác minh email trước khi kết nối Page.');
    const state = await createOAuthState(db, a.tenantId, undefined, a.userId);
    await db.insert(auditLog).values({ tenantId: a.tenantId, userId: a.userId, action: 'page.connect_started' });
    return { url: connectUrl(opts.publicBaseUrl, state), expiresInSeconds: 600 };
  });

  const ownPage = async (tenantId: string, id: string) => {
    if (!uuid.safeParse(id).success) return null;
    const [p] = await db.select().from(pages).where(and(eq(pages.id, id), eq(pages.tenantId, tenantId)));
    return p ?? null;
  };

  app.post<{ Params: { id: string } }>('/api/pages/:id/disconnect', guard, async (req, reply) => {
    const a = req.auth!;
    const p = await ownPage(a.tenantId, req.params.id);
    if (!p) return apiError(reply, 404, 'not_found', 'Không có Page này.');
    let metaUnsubscribed = false;
    if (p.status !== 'disconnected' && opts.graph && p.tokenEnc !== '') {
      try {
        await opts.graph.unsubscribePage(p.fbPageId, opts.crypto.decrypt(p.tokenEnc, p.fbPageId));
        metaUnsubscribed = true;
      } catch {
        metaUnsubscribed = false; // Meta lỗi thì vẫn xóa token cục bộ: quyền của người dùng quan trọng hơn
      }
    }
    // Xóa token cục bộ dù Meta trả lời thế nào; giữ lịch sử tin.
    await db.update(pages).set({ status: 'disconnected', tokenEnc: '', subscribedAt: null, backfillState: null }).where(eq(pages.id, p.id));
    await db.insert(auditLog).values({ tenantId: a.tenantId, userId: a.userId, action: 'page.disconnected', target: p.id, meta: { metaUnsubscribed } });
    return { ok: true, metaUnsubscribed };
  });

  app.post<{ Params: { id: string } }>('/api/pages/:id/backfill', guard, async (req, reply) => {
    const p = await ownPage(req.auth!.tenantId, req.params.id);
    if (!p) return apiError(reply, 404, 'not_found', 'Không có Page này.');
    if (p.status !== 'active') return apiError(reply, 409, 'page_not_active', 'Page chưa kết nối hoặc token không còn hiệu lực: hãy kết nối lại trước.');
    if (!opts.backfill) return apiError(reply, 503, 'queue_unavailable', 'Hàng đợi chưa sẵn sàng.');
    const queued = await opts.backfill.enqueuePage({ pageId: p.id });
    return { queued };
  });
};
