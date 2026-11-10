/** Dữ liệu của chính doanh nghiệp: xuất và xóa. Chỉ `owner`. */
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/users.js';
import type { TokenCrypto } from '../crypto/token-crypto.js';
import type { Db } from '../db/client.js';
import { pages, tenants } from '../db/schema.js';
import type { GraphClient } from '../meta/graph-client.js';
import { deleteTenant, exportTenant } from '../tenant/delete.js';
import { DEMO_TENANT_NAME } from '../demo/seed.js';
import { apiError, requireRole } from './guard.js';

export interface TenantRouteOptions {
  db: Db;
  crypto: TokenCrypto;
  graph?: Pick<GraphClient, 'unsubscribePage'>;
  now: () => Date;
}

export const tenantRoutes: FastifyPluginAsync<TenantRouteOptions> = async (app, opts) => {
  const { db } = opts;
  const guard = { preHandler: requireRole('owner') };

  app.get('/api/tenant/export', guard, async (req, reply) => {
    const data = await exportTenant(db, req.auth!.tenantId);
    return reply.header('content-disposition', 'attachment; filename="salesmind-du-lieu.json"').header('cache-control', 'no-store').send(data);
  });

  // POST (không phải DELETE kèm thân): thao tác phá hủy phải kèm tên doanh nghiệp và mật khẩu của người bấm.
  app.post('/api/tenant/delete', guard, async (req, reply) => {
    const b = z.object({ confirmName: z.string().max(300), password: z.string().max(1000) }).safeParse(req.body);
    if (!b.success) return apiError(reply, 422, 'invalid', 'Thiếu tên doanh nghiệp hoặc mật khẩu.');
    const a = req.auth!;
    const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, a.tenantId));
    if (!t || t.name === DEMO_TENANT_NAME) return apiError(reply, 403, 'forbidden', 'Không xóa được doanh nghiệp này.');
    if (b.data.confirmName.trim() !== t.name) return apiError(reply, 422, 'name_mismatch', 'Tên doanh nghiệp nhập vào không khớp.');
    const ok = await authenticate(db, a.email, b.data.password, opts.now());
    if (!ok.ok) return apiError(reply, 403, 'invalid_credentials', 'Mật khẩu không đúng.');

    // Gỡ webhook ở Meta cho các Page còn hoạt động (cố gắng hết sức); token bị xóa cùng dữ liệu.
    const live = await db.select().from(pages).where(and(eq(pages.tenantId, a.tenantId), eq(pages.status, 'active')));
    for (const p of live) {
      if (!opts.graph || p.tokenEnc === '') continue;
      try {
        await opts.graph.unsubscribePage(p.fbPageId, opts.crypto.decrypt(p.tokenEnc, p.fbPageId));
      } catch {
        // Meta lỗi không chặn việc xóa dữ liệu của người dùng.
      }
    }
    await deleteTenant(db, a.tenantId);
    return { ok: true };
  });
};
