/** Ngữ cảnh theo tenant của phiên: giờ hiện tại và nhận diện tenant demo. */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { getNow } from '../demo/clock.js';
import { DEMO_TENANT_NAME } from '../demo/seed.js';

export async function isDemoTenant(db: Db, tenantId: string): Promise<boolean> {
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.name === DEMO_TENANT_NAME;
}

/**
 * Giờ hiện tại của một tenant: tenant demo (khi DEMO_MODE) dùng đồng hồ demo tua được; mọi tenant khác luôn dùng
 * giờ thật, nên tua đồng hồ không bao giờ ảnh hưởng dữ liệu của doanh nghiệp khác.
 */
export async function nowFor(db: Db, tenantId: string, demoMode: boolean): Promise<Date> {
  if (demoMode && (await isDemoTenant(db, tenantId))) return getNow(db, true);
  return new Date();
}
