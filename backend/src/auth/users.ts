/** Người dùng: tạo, đăng nhập (có khóa tạm), đổi mật khẩu. */
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { auditLog, memberships, tenants, users, type MemberRole } from '../db/schema.js';
import { hashPassword, needsRehash, normalizeEmail, validatePassword, verifyPassword } from './password.js';
import { revokeSessions } from './session.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MS = 15 * 60_000;

export class AuthError extends Error {
  override readonly name = 'AuthError';
  constructor(
    readonly code: 'invalid_email' | 'weak_password' | 'email_taken' | 'invalid_name',
    message: string,
  ) {
    super(message);
  }
}

export interface CreateUserInput {
  email: string;
  password: string;
  displayName: string;
  tenantId: string;
  role: MemberRole;
  emailVerified?: boolean;
}

const cleanName = (raw: string): string => {
  const n = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (n.length < 1 || n.length > 100) throw new AuthError('invalid_name', 'Tên hiển thị phải có từ 1 đến 100 ký tự.');
  return n;
};

export async function createUser(db: Db, input: CreateUserInput, now: Date): Promise<{ userId: string }> {
  const email = normalizeEmail(input.email);
  if (!email) throw new AuthError('invalid_email', 'Email không hợp lệ.');
  const weak = validatePassword(input.password, email);
  if (weak) throw new AuthError('weak_password', weak);
  const displayName = cleanName(input.displayName);
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ email, passwordHash, displayName, emailVerifiedAt: input.emailVerified ? now : null })
        .returning({ id: users.id });
      await tx.insert(memberships).values({ userId: u!.id, tenantId: input.tenantId, role: input.role });
      await tx.insert(auditLog).values({ tenantId: input.tenantId, userId: u!.id, action: 'user.created', target: u!.id, meta: { role: input.role } });
      return { userId: u!.id };
    });
  } catch (e) {
    const pgCode = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (pgCode === '23505') throw new AuthError('email_taken', 'Email này đã được đăng ký.');
    throw e;
  }
}

/** Tạo doanh nghiệp mới cùng chủ sở hữu (đăng ký tự do). */
export async function createTenantWithOwner(
  db: Db,
  input: { businessName: string; email: string; password: string; displayName: string },
  now: Date,
): Promise<{ userId: string; tenantId: string }> {
  const name = input.businessName.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 120) throw new AuthError('invalid_name', 'Tên doanh nghiệp phải có từ 1 đến 120 ký tự.');
  // Kiểm tra email/mật khẩu trước khi tạo tenant để lỗi không để lại tenant mồ côi.
  const email = normalizeEmail(input.email);
  if (!email) throw new AuthError('invalid_email', 'Email không hợp lệ.');
  const weak = validatePassword(input.password, email);
  if (weak) throw new AuthError('weak_password', weak);
  const [t] = await db.insert(tenants).values({ name }).returning({ id: tenants.id });
  try {
    const { userId } = await createUser(db, { email, password: input.password, displayName: input.displayName, tenantId: t!.id, role: 'owner' }, now);
    return { userId, tenantId: t!.id };
  } catch (e) {
    await db.delete(tenants).where(eq(tenants.id, t!.id));
    throw e;
  }
}

// Băm giả để email lạ cũng tốn thời gian băm như email có thật (chống đoán email qua độ trễ).
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword('không-có-người-dùng-này'));

export type AuthResult = { ok: true; userId: string } | { ok: false };

/**
 * Xác thực. Mọi lý do thất bại (email lạ, sai mật khẩu, đang khóa, bị vô hiệu) đều trả `{ ok: false }`
 * như nhau, và đều chạy đúng một lần băm.
 */
export async function authenticate(db: Db, rawEmail: string, password: string, now: Date): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  const [u] = email ? await db.select().from(users).where(eq(users.email, email)) : [];
  if (!u) {
    await verifyPassword(password, await getDummyHash());
    return { ok: false };
  }
  const locked = u.lockedUntil !== null && u.lockedUntil > now;
  const good = await verifyPassword(password, u.passwordHash);
  if (locked || u.status !== 'active') return { ok: false };
  if (!good) {
    // Tăng nguyên tử rồi khóa nếu chạm ngưỡng: nhiều lần thử song song không né được bộ đếm.
    await db
      .update(users)
      .set({
        failedLogins: sql`CASE WHEN ${users.failedLogins} + 1 >= ${MAX_FAILED_LOGINS} THEN 0 ELSE ${users.failedLogins} + 1 END`,
        lockedUntil: sql`CASE WHEN ${users.failedLogins} + 1 >= ${MAX_FAILED_LOGINS} THEN ${new Date(now.getTime() + LOCK_MS)}::timestamptz ELSE ${users.lockedUntil} END`,
      })
      .where(eq(users.id, u.id));
    return { ok: false };
  }
  const set: Partial<typeof users.$inferInsert> = { failedLogins: 0, lockedUntil: null, lastLoginAt: now };
  if (needsRehash(u.passwordHash)) set.passwordHash = await hashPassword(password);
  await db.update(users).set(set).where(eq(users.id, u.id));
  return { ok: true, userId: u.id };
}

/** Đặt mật khẩu mới và thu hồi mọi phiên (trừ `keepSessionId`). */
export async function setPassword(db: Db, userId: string, newPassword: string, keepSessionId?: string): Promise<void> {
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) throw new AuthError('invalid_email', 'Không có người dùng này.');
  const weak = validatePassword(newPassword, u.email);
  if (weak) throw new AuthError('weak_password', weak);
  await db.update(users).set({ passwordHash: await hashPassword(newPassword), failedLogins: 0, lockedUntil: null }).where(eq(users.id, userId));
  await revokeSessions(db, userId, keepSessionId);
}

export async function findUserByEmail(db: Db, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return u ?? null;
}
