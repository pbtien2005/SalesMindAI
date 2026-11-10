import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pages, tenants } from '../db/schema.js';
import { createOAuthState } from './oauth-state.js';
import { OAUTH_START_PATH } from './paths.js';

/** Liên kết quản trị viên gửi cho người dùng để kết nối Page. Dùng một lần, hết hạn sau 10 phút. */
export function connectUrl(publicBaseUrl: string, state: string): string {
  return `${publicBaseUrl}${OAUTH_START_PATH}?state=${encodeURIComponent(state)}`;
}

export async function createTenant(db: Db, name: string): Promise<{ id: string; name: string }> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Tên doanh nghiệp không được để trống.');
  const [row] = await db.insert(tenants).values({ name: trimmed }).returning({ id: tenants.id, name: tenants.name });
  return row!;
}

export async function tenantExists(db: Db, tenantId: string): Promise<boolean> {
  const rows = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return rows.length > 0;
}

export async function listTenants(db: Db): Promise<Array<{ id: string; name: string; pages: number }>> {
  // LEFT JOIN + GROUP BY, không dùng truy vấn con tương quan: Drizzle viết cột không kèm tên bảng
  // trong truy vấn con nên điều kiện sẽ so cột của chính bảng pages với nhau và luôn ra 0.
  return db
    .select({ id: tenants.id, name: tenants.name, pages: sql<number>`count(${pages.id})::int` })
    .from(tenants)
    .leftJoin(pages, eq(pages.tenantId, tenants.id))
    .groupBy(tenants.id, tenants.name, tenants.createdAt)
    .orderBy(tenants.createdAt);
}

/** Tạo liên kết kết nối mới cho một tenant đã có. */
export async function newConnectUrl(db: Db, publicBaseUrl: string, tenantId: string): Promise<string> {
  return connectUrl(publicBaseUrl, await createOAuthState(db, tenantId));
}
