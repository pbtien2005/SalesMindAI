/** Đội: lời mời, nhận lời mời, vai trò, gỡ thành viên. Luôn còn ít nhất một owner. */
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { auditLog, invitations, memberships, tenants, users, type MemberRole } from '../db/schema.js';
import { normalizeEmail } from './password.js';
import { hashToken, newToken, revokeSessions } from './session.js';
import { AuthError, createUser } from './users.js';

export const INVITE_TTL_MS = 7 * 86_400_000;

export type TeamErrorCode = 'forbidden' | 'not_found' | 'last_owner' | 'invalid_token' | 'invalid';

export class TeamError extends Error {
  override readonly name = 'TeamError';
  constructor(
    readonly code: TeamErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Actor {
  tenantId: string;
  userId: string;
  role: MemberRole;
}

const log = (db: Db, a: Actor, action: string, target: string, meta?: object) =>
  db.insert(auditLog).values({ tenantId: a.tenantId, userId: a.userId, action, target, meta: meta ?? null });

/** `owner` chỉ do `owner` mời hoặc cấp. */
function assertCanGrant(actor: Actor, role: MemberRole): void {
  if (role === 'owner' && actor.role !== 'owner') throw new TeamError('forbidden', 'Chỉ chủ doanh nghiệp mới cấp được vai trò chủ.');
}

export async function createInvite(db: Db, actor: Actor, input: { role: MemberRole; email?: string }, now: Date): Promise<{ id: string; token: string; expiresAt: Date }> {
  assertCanGrant(actor, input.role);
  let email: string | null = null;
  if (input.email !== undefined && input.email.trim() !== '') {
    email = normalizeEmail(input.email);
    if (!email) throw new TeamError('invalid', 'Email không hợp lệ.');
  }
  const token = newToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  const [row] = await db
    .insert(invitations)
    .values({ tenantId: actor.tenantId, email, role: input.role, tokenHash: hashToken(token), invitedBy: actor.userId, expiresAt })
    .returning({ id: invitations.id });
  await log(db, actor, 'invite.created', row!.id, { role: input.role });
  return { id: row!.id, token, expiresAt };
}

/** Thông tin hiển thị cho người mở liên kết mời (không tiêu thụ token). */
export async function inviteInfo(db: Db, token: string, now: Date): Promise<{ tenantName: string; role: MemberRole; email: string | null } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [r] = await db
    .select({ tenantName: tenants.name, role: invitations.role, email: invitations.email })
    .from(invitations)
    .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
    .where(and(eq(invitations.tokenHash, hashToken(token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, now)));
  return r ?? null;
}

export async function acceptInvite(
  db: Db,
  input: { token: string; displayName: string; password: string; email?: string },
  now: Date,
): Promise<{ userId: string }> {
  const bad = () => new TeamError('invalid_token', 'Lời mời không hợp lệ hoặc đã hết hạn.');
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw bad();
  const th = hashToken(input.token);
  const [inv] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.tokenHash, th), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, now)));
  if (!inv) throw bad();
  const email = inv.email ?? normalizeEmail(input.email ?? '');
  if (!email) throw new AuthError('invalid_email', 'Cần nhập email hợp lệ.');
  if (inv.email && input.email && normalizeEmail(input.email) !== inv.email) throw bad();

  // Giữ chỗ trước (nguyên tử): hai người dùng cùng một liên kết thì chỉ một người qua.
  const claimed = await db
    .update(invitations)
    .set({ acceptedAt: now })
    .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, now)))
    .returning({ id: invitations.id });
  if (claimed.length !== 1) throw bad();
  try {
    const { userId } = await createUser(db, { email, password: input.password, displayName: input.displayName, tenantId: inv.tenantId, role: inv.role, emailVerified: true }, now);
    await db.update(invitations).set({ acceptedBy: userId }).where(eq(invitations.id, inv.id));
    await db.insert(auditLog).values({ tenantId: inv.tenantId, userId, action: 'invite.accepted', target: inv.id });
    return { userId };
  } catch (e) {
    // Email đã thuộc tài khoản khác (kể cả doanh nghiệp khác) hoặc mật khẩu yếu: trả lại lời mời để thử lại.
    await db.update(invitations).set({ acceptedAt: null }).where(eq(invitations.id, inv.id));
    throw e;
  }
}

export async function revokeInvite(db: Db, actor: Actor, inviteId: string, now: Date): Promise<void> {
  const rows = await db
    .update(invitations)
    .set({ revokedAt: now })
    .where(and(eq(invitations.id, inviteId), eq(invitations.tenantId, actor.tenantId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .returning({ id: invitations.id });
  if (rows.length !== 1) throw new TeamError('not_found', 'Không có lời mời này.');
  await log(db, actor, 'invite.revoked', inviteId);
}

export interface TeamView {
  members: Array<{ id: string; email: string; displayName: string; role: MemberRole; createdAt: Date }>;
  invites: Array<{ id: string; email: string | null; role: MemberRole; expiresAt: Date }>;
}

export async function listTeam(db: Db, tenantId: string, now: Date): Promise<TeamView> {
  const members = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName, role: memberships.role, createdAt: memberships.createdAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(asc(memberships.createdAt));
  const invites = await db
    .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, now)))
    .orderBy(asc(invitations.createdAt));
  return { members, invites };
}

/** Khóa dòng tenant để hai thao tác đồng thời không cùng gỡ hai owner cuối cùng. */
async function withOwnerLock<T>(db: Db, tenantId: string, fn: (tx: Parameters<Parameters<Db['transaction']>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);
    return fn(tx);
  });
}

export async function changeRole(db: Db, actor: Actor, userId: string, role: MemberRole): Promise<void> {
  assertCanGrant(actor, role);
  await withOwnerLock(db, actor.tenantId, async (tx) => {
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.tenantId, actor.tenantId)));
    if (!m) throw new TeamError('not_found', 'Không có thành viên này.');
    if (m.role === 'owner' && actor.role !== 'owner') throw new TeamError('forbidden', 'Chỉ chủ doanh nghiệp mới đổi được vai trò của chủ.');
    if (m.role === 'owner' && role !== 'owner') {
      const owners = await tx.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, actor.tenantId), eq(memberships.role, 'owner')));
      if (owners.length <= 1) throw new TeamError('last_owner', 'Doanh nghiệp phải còn ít nhất một chủ.');
    }
    await tx.update(memberships).set({ role }).where(eq(memberships.userId, userId));
    await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.userId, action: 'member.role_changed', target: userId, meta: { from: m.role, to: role } });
  });
  // Vai trò nằm trong phiên (tra mỗi request) nên có hiệu lực ngay; thu hồi phiên để người đó đăng nhập lại cho chắc.
  await revokeSessions(db, userId);
}

export async function removeMember(db: Db, actor: Actor, userId: string): Promise<void> {
  await withOwnerLock(db, actor.tenantId, async (tx) => {
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.tenantId, actor.tenantId)));
    if (!m) throw new TeamError('not_found', 'Không có thành viên này.');
    if (m.role === 'owner') {
      if (actor.role !== 'owner') throw new TeamError('forbidden', 'Chỉ chủ doanh nghiệp mới gỡ được chủ.');
      const owners = await tx.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, actor.tenantId), eq(memberships.role, 'owner')));
      if (owners.length <= 1) throw new TeamError('last_owner', 'Doanh nghiệp phải còn ít nhất một chủ.');
    }
    // Xóa người dùng: phiên và thẻ token xóa theo (ON DELETE CASCADE), phiên cũ vô hiệu ngay ở request kế tiếp.
    await tx.delete(users).where(eq(users.id, userId));
    await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.userId, action: 'member.removed', target: userId, meta: { role: m.role } });
  });
}
