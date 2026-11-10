import { and, eq, sql } from 'drizzle-orm';
import type { TokenCrypto } from '../crypto/token-crypto.js';
import type { Db } from '../db/client.js';
import { pages } from '../db/schema.js';
import { GraphApiError, type GraphClient } from '../meta/graph-client.js';

export type ResubscribeOutcome =
  | { fbPageId: string; name: string; status: 'subscribed' }
  /** Meta báo token không hợp lệ (190): đã đánh dấu `token_invalid`, cần kết nối lại Page. */
  | { fbPageId: string; name: string; status: 'token_invalid' }
  | { fbPageId: string; name: string; status: 'failed'; graphCode: number | null };

export interface ResubscribeDeps {
  db: Db;
  graph: Pick<GraphClient, 'subscribePage'>;
  crypto: TokenCrypto;
}

/**
 * Đăng ký lại webhook (theo danh sách field hiện hành) cho các Page đang dùng được. Cần khi danh sách
 * field thay đổi sau khi Page đã được kết nối (ví dụ thêm `message_echoes`): Page cũ vẫn chỉ nhận các field
 * lúc kết nối. Dùng Page token đã lưu (giải mã bằng AAD là ID Page), không cần người dùng đăng nhập lại.
 *
 * Mỗi Page độc lập. `subscribed_at` được đặt lại khi thành công; khi thất bại giữ nguyên để không nói dối
 * rằng việc đăng ký mới đã xong.
 */
export async function resubscribePages(deps: ResubscribeDeps, fbPageId?: string): Promise<ResubscribeOutcome[]> {
  const { db, graph, crypto } = deps;
  const rows = await db
    .select({ id: pages.id, fbPageId: pages.fbPageId, name: pages.name, tokenEnc: pages.tokenEnc })
    .from(pages)
    .where(fbPageId ? and(eq(pages.status, 'active'), eq(pages.fbPageId, fbPageId)) : eq(pages.status, 'active'));

  const out: ResubscribeOutcome[] = [];
  for (const p of rows) {
    try {
      await graph.subscribePage(p.fbPageId, crypto.decrypt(p.tokenEnc, p.fbPageId));
      await db.update(pages).set({ subscribedAt: sql`now()` }).where(eq(pages.id, p.id));
      out.push({ fbPageId: p.fbPageId, name: p.name, status: 'subscribed' });
    } catch (err) {
      if (err instanceof GraphApiError && err.isTokenInvalid) {
        await db.update(pages).set({ status: 'token_invalid' }).where(eq(pages.id, p.id));
        out.push({ fbPageId: p.fbPageId, name: p.name, status: 'token_invalid' });
      } else {
        // Lỗi Meta khác (quyền, giới hạn tốc độ...) hoặc lỗi giải mã: chỉ báo cho Page này, không dừng cả lượt.
        out.push({ fbPageId: p.fbPageId, name: p.name, status: 'failed', graphCode: err instanceof GraphApiError ? err.code : null });
      }
    }
  }
  return out;
}
