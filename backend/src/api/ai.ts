/** AI theo doanh nghiệp: bật (kèm xác nhận pháp lý), tắt, xem mức dùng. Bật và tắt chỉ `owner`. */
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { tenantCap, usageToday } from '../ai/budget.js';
import type { Db } from '../db/client.js';
import { auditLog, tenants } from '../db/schema.js';
import { setAiEnabled } from '../extraction/admin.js';
import { apiError, requireRole } from './guard.js';

export interface AiRouteOptions {
  db: Db;
  mode: 'offline' | 'live';
  defaultCap: number;
  now: () => Date;
}

export const aiRoutes: FastifyPluginAsync<AiRouteOptions> = async (app, opts) => {
  const { db } = opts;

  app.get('/api/ai', { preHandler: requireRole('manager', 'owner') }, async (req) => {
    const tenantId = req.auth!.tenantId;
    const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    const cap = await tenantCap(db, tenantId, opts.defaultCap);
    return {
      enabled: t?.aiExtractionEnabled ?? false,
      mode: opts.mode,
      consentAt: t?.aiConsentAt ?? null,
      cap: opts.mode === 'live' ? cap : null,
      today: await usageToday(db, tenantId, opts.now()),
    };
  });

  app.post('/api/ai/enable', { preHandler: requireRole('owner') }, async (req, reply) => {
    const b = z.object({ acknowledgeLegal: z.literal(true) }).safeParse(req.body);
    if (!b.success) return apiError(reply, 422, 'consent_required', 'Cần xác nhận đã hiểu việc gửi nội dung chat ra nhà cung cấp AI ở nước ngoài.');
    const a = req.auth!;
    const now = opts.now();
    await setAiEnabled(db, a.tenantId, true, now);
    await db.update(tenants).set({ aiConsentAt: now, aiConsentBy: a.userId }).where(eq(tenants.id, a.tenantId));
    await db.insert(auditLog).values({ tenantId: a.tenantId, userId: a.userId, action: 'ai.enabled', meta: { mode: opts.mode } });
    return { enabled: true };
  });

  app.post('/api/ai/disable', { preHandler: requireRole('owner') }, async (req) => {
    const a = req.auth!;
    await setAiEnabled(db, a.tenantId, false);
    await db.insert(auditLog).values({ tenantId: a.tenantId, userId: a.userId, action: 'ai.disabled' });
    return { enabled: false };
  });
};
