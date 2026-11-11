/**
 * Điền tên khách từ Graph API cho hội thoại chưa có tên. Làm sau khi lưu tin, cố gắng hết sức:
 * lỗi chỉ được đếm và ghi log (không tên, không PSID, không token), không làm hỏng job webhook.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { TokenCrypto } from '../crypto/token-crypto.js';
import type { Db } from '../db/client.js';
import { conversations, pages } from '../db/schema.js';
import type { GraphClient } from './graph-client.js';

const MAX_PER_CALL = 20;

export async function fillCustomerNames(
  db: Db,
  graph: Pick<GraphClient, 'getUserName'>,
  crypto: TokenCrypto,
  conversationIds: string[],
  log: { warn(obj: object, msg?: string): void },
): Promise<{ filled: number; failed: number }> {
  const ids = conversationIds.slice(0, MAX_PER_CALL);
  if (ids.length === 0) return { filled: 0, failed: 0 };
  const rows = await db
    .select({ id: conversations.id, tenantId: conversations.tenantId, psid: conversations.psid, fbPageId: pages.fbPageId, tokenEnc: pages.tokenEnc })
    .from(conversations)
    .innerJoin(pages, eq(pages.id, conversations.pageId))
    .where(and(inArray(conversations.id, ids), isNull(conversations.displayName), eq(pages.status, 'active')));
  let filled = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.tokenEnc === '' || r.psid.startsWith('demo-')) continue;
    try {
      const name = await graph.getUserName(crypto.decrypt(r.tokenEnc, r.fbPageId), r.psid);
      if (name === null) continue;
      const upd = await db
        .update(conversations)
        .set({ displayName: name })
        .where(and(eq(conversations.id, r.id), eq(conversations.tenantId, r.tenantId), isNull(conversations.displayName)))
        .returning({ id: conversations.id });
      filled += upd.length;
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) log.warn({ failed }, 'không lấy được tên của một số khách từ Meta');
  return { filled, failed };
}
