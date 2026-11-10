/** Phiên đăng nhập và token dùng một lần. Token là 32 byte ngẫu nhiên; DB chỉ lưu băm SHA-256. */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { memberships, sessions, userTokens, users, type MemberRole } from '../db/schema.js';

const DAY_MS = 86_400_000;
/** Chỉ ghi `last_seen_at` khi đã cũ hơn ngần này, để mỗi request không tốn một lần ghi. */
const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface SessionOptions {
  idleDays?: number;
  maxDays?: number;
}

export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

export interface AuthContext {
  sessionId: string;
  userId: string;
  tenantId: string;
  role: MemberRole;
  email: string;
  displayName: string;
  emailVerified: boolean;
}

export async function createSession(
  db: Db,
  userId: string,
  ctx: { userAgent: string },
  now: Date,
  opts: SessionOptions = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + (opts.maxDays ?? 30) * DAY_MS);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    lastSeenAt: now,
    userAgent: ctx.userAgent.slice(0, 300),
  });
  return { token, expiresAt };
}

/** null khi token sai, hết hạn (nhàn rỗi hoặc tuyệt đối), người dùng bị khóa hoặc không thuộc doanh nghiệp nào. */
export async function resolveSession(db: Db, token: string, now: Date, opts: SessionOptions = {}): Promise<AuthContext | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      verifiedAt: users.emailVerifiedAt,
      tenantId: memberships.tenantId,
      role: memberships.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(eq(sessions.tokenHash, hashToken(token)));
  if (!row || row.status !== 'active') return null;
  if (row.expiresAt <= now) return null;
  if (row.lastSeenAt.getTime() + (opts.idleDays ?? 7) * DAY_MS <= now.getTime()) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    tenantId: row.tenantId,
    role: row.role,
    email: row.email,
    displayName: row.displayName,
    emailVerified: row.verifiedAt !== null,
  };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Thu hồi mọi phiên của người dùng (trừ `exceptSessionId` nếu có). */
export async function revokeSessions(db: Db, userId: string, exceptSessionId?: string): Promise<void> {
  await db.delete(sessions).where(exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId));
}

export type UserTokenKind = 'email_verify' | 'password_reset';

export async function createUserToken(db: Db, userId: string, kind: UserTokenKind, now: Date, ttlMs: number): Promise<string> {
  const token = newToken();
  await db.insert(userTokens).values({ userId, kind, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + ttlMs) });
  return token;
}

/** Dùng token đúng một lần (nguyên tử). Trả userId, hoặc null nếu sai, hết hạn hay đã dùng. */
export async function consumeUserToken(db: Db, token: string, kind: UserTokenKind, now: Date): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const rows = await db
    .update(userTokens)
    .set({ usedAt: now })
    .where(and(eq(userTokens.tokenHash, hashToken(token)), eq(userTokens.kind, kind), isNull(userTokens.usedAt), gt(userTokens.expiresAt, now)))
    .returning({ userId: userTokens.userId });
  return rows[0]?.userId ?? null;
}
