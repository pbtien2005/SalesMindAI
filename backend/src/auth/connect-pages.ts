import { eq, sql } from 'drizzle-orm';
import type { TokenCrypto } from '../crypto/token-crypto.js';
import type { Db } from '../db/client.js';
import { pages } from '../db/schema.js';
import { GraphApiError, type GraphClient } from '../meta/graph-client.js';

export type PageOutcome =
  /** Đã lưu và đăng ký webhook. */
  | { fbPageId: string; name: string; status: 'connected' }
  /** Đã lưu nhưng đăng ký webhook thất bại: chưa chắc nhận được tin. */
  | { fbPageId: string; name: string; status: 'subscribe_failed'; graphCode: number | null }
  /** Page đã thuộc doanh nghiệp (tenant) khác: không ghi đè. */
  | { fbPageId: string; name: string; status: 'owned_by_other_tenant' }
  /** Không lưu được vào DB. */
  | { fbPageId: string; name: string; status: 'save_failed' };

export interface ConnectDeps {
  db: Db;
  graph: Pick<GraphClient, 'listPages' | 'subscribePage'>;
  crypto: TokenCrypto;
  /** Nhận lỗi không phải của Meta (DB, mã hóa...). Không được ghi token. */
  onError?: (err: unknown, fbPageId: string) => void;
}

/**
 * Lưu các Page mà người dùng vừa cấp quyền cho một tenant, rồi đăng ký webhook cho từng Page.
 *
 * Thứ tự quan trọng: LƯU TRƯỚC, ĐĂNG KÝ SAU. Khi đăng ký xong Meta có thể gửi tin ngay, và worker
 * cần thấy Page trong DB (nếu không tin sẽ phải retry, xem UnknownPageError).
 *
 * Mỗi Page độc lập: bất kỳ lỗi nào của một Page (Meta, DB, mã hóa) chỉ ảnh hưởng Page đó, các Page
 * còn lại vẫn được xử lý. Token chỉ được lưu dạng mã hóa (AES-256-GCM, AAD là ID Page) và không
 * bao giờ đi vào log hay giá trị trả về.
 *
 * Ý nghĩa: `status` là sức khỏe của TOKEN (token_invalid khi Meta báo 190); `subscribedAt` là việc
 * đăng ký webhook đã thành công hay chưa. Một Page 'active' mà `subscribedAt` null thì chưa chắc
 * nhận được tin.
 */
export async function connectPages(deps: ConnectDeps, tenantId: string, userToken: string, connectedByUserId: string | null = null): Promise<PageOutcome[]> {
  const { db, graph, crypto } = deps;
  const fbPages = await graph.listPages(userToken);
  const outcomes: PageOutcome[] = [];

  for (const p of fbPages) {
    let pageRowId: string;
    try {
      const tokenEnc = crypto.encrypt(p.accessToken, p.id); // mã hóa một lần, dùng cho cả insert và update
      // Page đã có: chỉ cập nhật nếu cùng tenant (kết nối lại, làm mới token). Khác tenant thì
      // WHERE không khớp, không dòng nào bị đổi và RETURNING rỗng.
      const [saved] = await db
        .insert(pages)
        .values({ tenantId, fbPageId: p.id, name: p.name, tokenEnc, status: 'active', connectedByUserId })
        .onConflictDoUpdate({
          target: pages.fbPageId,
          // subscribedAt về null: đăng ký webhook phải được xác lập lại ở lần này; nếu thất bại thì không được
          // giữ mốc thời gian của lần trước (nó sẽ nói dối rằng Page đang nhận được tin).
          set: { name: p.name, tokenEnc, status: 'active', subscribedAt: null, ...(connectedByUserId ? { connectedByUserId } : {}) },
          setWhere: eq(pages.tenantId, tenantId),
        })
        .returning({ id: pages.id });
      if (!saved) {
        outcomes.push({ fbPageId: p.id, name: p.name, status: 'owned_by_other_tenant' });
        continue;
      }
      pageRowId = saved.id;
    } catch (err) {
      deps.onError?.(err, p.id);
      outcomes.push({ fbPageId: p.id, name: p.name, status: 'save_failed' });
      continue;
    }

    try {
      await graph.subscribePage(p.id, p.accessToken);
    } catch (err) {
      let graphCode: number | null = null;
      if (err instanceof GraphApiError) {
        graphCode = err.code;
        if (err.isTokenInvalid) {
          try {
            await db.update(pages).set({ status: 'token_invalid' }).where(eq(pages.id, pageRowId));
          } catch (dbErr) {
            deps.onError?.(dbErr, p.id); // không để lỗi DB ở đây biến mất
          }
        }
      } else {
        deps.onError?.(err, p.id);
      }
      outcomes.push({ fbPageId: p.id, name: p.name, status: 'subscribe_failed', graphCode });
      continue;
    }

    // Meta đã xác nhận đăng ký. Nếu chỉ việc ghi mốc thời gian vào DB lỗi thì webhook vẫn hoạt động:
    // báo 'connected' (đúng với thực tế) và ghi lỗi để người vận hành biết subscribed_at đang thiếu.
    try {
      await db.update(pages).set({ subscribedAt: sql`now()` }).where(eq(pages.id, pageRowId));
    } catch (dbErr) {
      deps.onError?.(dbErr, p.id);
    }
    outcomes.push({ fbPageId: p.id, name: p.name, status: 'connected' });
  }
  return outcomes;
}
