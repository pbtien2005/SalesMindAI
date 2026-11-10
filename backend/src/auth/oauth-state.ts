import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { oauthStates } from '../db/schema.js';

/** State sống 10 phút: đủ để người dùng đăng nhập Facebook và chọn Page. */
export const STATE_TTL_SECONDS = 10 * 60;

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** Nonce ngẫu nhiên 256 bit đặt trong cookie để gắn state với trình duyệt đã mở liên kết. */
export const newNonce = () => randomBytes(32).toString('base64url');
export const NONCE_FORMAT = /^[A-Za-z0-9_-]{43}$/;

const usable = (state: string) =>
  and(eq(oauthStates.stateHash, hash(state)), isNull(oauthStates.usedAt), gt(oauthStates.expiresAt, sql`now()`));

/**
 * Tạo state ngẫu nhiên (256 bit) gắn với một tenant. Trả về state THÔ để đưa vào URL; DB chỉ lưu băm.
 * Hạn dùng tính theo đồng hồ của DB để không lệch giờ giữa các máy.
 * Tiện thể xóa các state đã hết hạn quá 1 ngày để bảng không phình mãi.
 */
export async function createOAuthState(
  db: Db,
  tenantId: string,
  ttlSeconds: number = STATE_TTL_SECONDS,
  userId?: string,
): Promise<string> {
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, sql`now() - interval '1 day'`));
  const state = randomBytes(32).toString('base64url');
  await db.insert(oauthStates).values({
    stateHash: hash(state),
    tenantId,
    ...(userId ? { userId } : {}),
    expiresAt: sql`now() + ${ttlSeconds} * interval '1 second'`,
  });
  return state;
}

/**
 * Trình duyệt mở liên kết (GET /start) "nhận" state bằng nonce của nó. Chỉ trình duyệt ĐẦU TIÊN nhận
 * được; mở lại bằng cùng nonce (tải lại trang) thì vẫn được. Người khác có state mà mở sau thì bị từ
 * chối, nên lộ state qua URL, Referer hay log không đủ để chiếm luồng kết nối.
 */
export async function claimOAuthState(db: Db, state: string, nonce: string): Promise<boolean> {
  const rows = await db
    .update(oauthStates)
    .set({ nonceHash: hash(nonce) })
    .where(and(usable(state), or(isNull(oauthStates.nonceHash), eq(oauthStates.nonceHash, hash(nonce)))))
    .returning({ id: oauthStates.id });
  return rows.length > 0;
}

/**
 * Tiêu thụ state một lần, nguyên tử, và chỉ khi nonce khớp trình duyệt đã nhận state:
 * hai callback đồng thời với cùng state thì chỉ một bên nhận được tenantId, bên kia nhận null.
 * Trả null nếu sai state, sai nonce, đã dùng hoặc hết hạn.
 */
export async function consumeOAuthState(
  db: Db,
  state: string,
  nonce: string,
): Promise<{ tenantId: string; userId: string | null } | null> {
  const rows = await db
    .update(oauthStates)
    .set({ usedAt: sql`now()` })
    .where(and(usable(state), eq(oauthStates.nonceHash, hash(nonce))))
    .returning({ tenantId: oauthStates.tenantId, userId: oauthStates.userId });
  return rows[0] ?? null;
}
