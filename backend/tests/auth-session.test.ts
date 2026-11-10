import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { consumeUserToken, createSession, createUserToken, hashToken, resolveSession, revokeSessions } from '../src/auth/session.js';
import { createTenantWithOwner, createUser } from '../src/auth/users.js';
import { sessions, tenants, users, userTokens } from '../src/db/schema.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const T0 = new Date('2026-11-10T03:00:00Z');
const DAY = 86_400_000;

beforeEach(async () => {
  await truncateAll(handle);
});
afterAll(async () => {
  await handle.close();
});

async function seedUser(email = 'lan@shop.vn') {
  const [t] = await db.insert(tenants).values({ name: 'Shop' }).returning({ id: tenants.id });
  const { userId } = await createUser(db, { email, password: 'mat-khau-dai-123', displayName: 'Lan', tenantId: t!.id, role: 'sale' }, T0);
  return { userId, tenantId: t!.id };
}

describe('phiên', () => {
  it('token trả về không nằm trong DB (chỉ có băm) và resolve ra đúng người, tenant, vai trò', async () => {
    const { userId, tenantId } = await seedUser();
    const { token } = await createSession(db, userId, { userAgent: 'test' }, T0);
    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!.tokenHash).toBe(hashToken(token));
    const ctx = await resolveSession(db, token, T0);
    expect(ctx).toMatchObject({ userId, tenantId, role: 'sale', email: 'lan@shop.vn', displayName: 'Lan', emailVerified: false });
  });

  it('token lạ hoặc sai định dạng thì null', async () => {
    expect(await resolveSession(db, 'x', T0)).toBeNull();
    expect(await resolveSession(db, 'a'.repeat(43), T0)).toBeNull();
  });

  it('hết hạn nhàn rỗi sau 7 ngày (đúng biên) và dùng lại trong thời gian đó thì gia hạn', async () => {
    const { userId } = await seedUser();
    const a = await createSession(db, userId, { userAgent: 't' }, T0);
    const b = await createSession(db, userId, { userAgent: 't' }, T0);
    expect(await resolveSession(db, a.token, new Date(T0.getTime() + 7 * DAY - 1))).not.toBeNull();
    expect(await resolveSession(db, b.token, new Date(T0.getTime() + 7 * DAY))).toBeNull();
    // Dùng lúc 6 ngày thì lần sau còn sống tới 13 ngày nữa (tính từ lần dùng).
    const { token: t2 } = await createSession(db, userId, { userAgent: 't' }, T0);
    expect(await resolveSession(db, t2, new Date(T0.getTime() + 6 * DAY))).not.toBeNull();
    expect(await resolveSession(db, t2, new Date(T0.getTime() + 12 * DAY))).not.toBeNull();
  });

  it('hết hạn tuyệt đối sau 30 ngày dù vẫn dùng liên tục', async () => {
    const { userId } = await seedUser();
    const { token } = await createSession(db, userId, { userAgent: 't' }, T0);
    for (let d = 5; d < 30; d += 5) expect(await resolveSession(db, token, new Date(T0.getTime() + d * DAY))).not.toBeNull();
    expect(await resolveSession(db, token, new Date(T0.getTime() + 30 * DAY))).toBeNull();
  });

  it('người dùng bị vô hiệu thì null ngay', async () => {
    const { userId } = await seedUser();
    const { token } = await createSession(db, userId, { userAgent: 't' }, T0);
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, userId));
    expect(await resolveSession(db, token, T0)).toBeNull();
  });

  it('revokeSessions vô hiệu mọi phiên, trừ phiên được giữ', async () => {
    const { userId } = await seedUser();
    const a = await createSession(db, userId, { userAgent: 't' }, T0);
    const b = await createSession(db, userId, { userAgent: 't' }, T0);
    const keep = (await resolveSession(db, b.token, T0))!.sessionId;
    await revokeSessions(db, userId, keep);
    expect(await resolveSession(db, a.token, T0)).toBeNull();
    expect(await resolveSession(db, b.token, T0)).not.toBeNull();
    await revokeSessions(db, userId);
    expect(await resolveSession(db, b.token, T0)).toBeNull();
  });
});

describe('token dùng một lần', () => {
  it('dùng được một lần, lần hai null; không lưu token gốc', async () => {
    const { userId } = await seedUser();
    const token = await createUserToken(db, userId, 'password_reset', T0, 3_600_000);
    expect(JSON.stringify(await db.select().from(userTokens))).not.toContain(token);
    expect(await consumeUserToken(db, token, 'password_reset', T0)).toBe(userId);
    expect(await consumeUserToken(db, token, 'password_reset', T0)).toBeNull();
  });

  it('sai loại thì null và chưa bị tiêu thụ; hết hạn đúng biên', async () => {
    const { userId } = await seedUser();
    const token = await createUserToken(db, userId, 'email_verify', T0, 1000);
    expect(await consumeUserToken(db, token, 'password_reset', T0)).toBeNull();
    expect(await consumeUserToken(db, token, 'email_verify', new Date(T0.getTime() + 1000))).toBeNull();
    expect(await consumeUserToken(db, token, 'email_verify', new Date(T0.getTime() + 999))).toBe(userId);
  });

  it('hai lần dùng đồng thời chỉ một lần thắng', async () => {
    const { userId } = await seedUser();
    const token = await createUserToken(db, userId, 'password_reset', T0, 3_600_000);
    const r = await Promise.all([1, 2, 3, 4].map(() => consumeUserToken(db, token, 'password_reset', T0)));
    expect(r.filter((x) => x !== null)).toHaveLength(1);
  });
});

describe('tạo người dùng', () => {
  it('email trùng (khác hoa thường) bị từ chối', async () => {
    const { tenantId } = await seedUser('lan@shop.vn');
    await expect(createUser(db, { email: 'LAN@Shop.vn', password: 'mat-khau-dai-123', displayName: 'X', tenantId, role: 'sale' }, T0)).rejects.toMatchObject({ code: 'email_taken' });
  });

  it('đăng ký lỗi không để lại tenant mồ côi', async () => {
    await seedUser('lan@shop.vn');
    const before = (await db.select().from(tenants)).length;
    await expect(createTenantWithOwner(db, { businessName: 'Mới', email: 'lan@shop.vn', password: 'mat-khau-dai-123', displayName: 'A' }, T0)).rejects.toMatchObject({ code: 'email_taken' });
    await expect(createTenantWithOwner(db, { businessName: 'Mới', email: 'b@shop.vn', password: 'ngan', displayName: 'A' }, T0)).rejects.toMatchObject({ code: 'weak_password' });
    expect((await db.select().from(tenants)).length).toBe(before);
  });
});
