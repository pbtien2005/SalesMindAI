/**
 * Trang quyền riêng tư, điều khoản và các callback bắt buộc của Meta khi app ra chế độ Live:
 * `POST /meta/data-deletion` (yêu cầu xóa dữ liệu) và `POST /meta/deauthorize` (người dùng gỡ app).
 * Cả hai nhận `signed_request` do Meta ký bằng App Secret.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { conversations, deletionRequests } from '../db/schema.js';
import { deleteConversations } from '../tenant/delete.js';

export interface PrivacyRouteOptions {
  db: Db;
  appSecret: string;
  publicBaseUrl: string;
  /** Tên và email liên hệ hiển thị trong trang quyền riêng tư. */
  contactEmail?: string;
}

/** Kiểm chữ ký `signed_request` của Meta. Trả payload nếu hợp lệ, null nếu sai. */
export function parseSignedRequest(signed: string, appSecret: string): { user_id?: string } | null {
  const [sig, payload] = signed.split('.');
  if (!sig || !payload || signed.split('.').length !== 2) return null;
  const b64 = /^[A-Za-z0-9_-]+$/;
  if (!b64.test(sig) || !b64.test(payload)) return null;
  const expected = createHmac('sha256', appSecret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { algorithm?: string; user_id?: unknown };
    if (json.algorithm !== undefined && String(json.algorithm).toUpperCase() !== 'HMAC-SHA256') return null;
    return typeof json.user_id === 'string' || json.user_id === undefined ? (json as { user_id?: string }) : null;
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title: string, body: string): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:44rem;margin:2.5rem auto;padding:0 1rem;line-height:1.55"><h1>${esc(title)}</h1>${body}</body></html>`;
}

export const privacyRoutes: FastifyPluginAsync<PrivacyRouteOptions> = async (app, opts) => {
  const { db } = opts;
  const contact = opts.contactEmail ?? 'quản trị viên của doanh nghiệp bạn';

  app.get('/privacy', async (_req, reply) =>
    reply
      .header('cache-control', 'public, max-age=3600')
      .type('text/html; charset=utf-8')
      .send(
        page(
          'Chính sách quyền riêng tư của SalesMind AI',
          `<p>SalesMind AI giúp doanh nghiệp quản lý tin nhắn của khách gửi tới Facebook Page của họ.</p>
<h2>Chúng tôi lưu gì</h2><ul><li>Tin nhắn khách gửi tới Page và tin Page trả lời (nội dung, thời điểm, mã định danh Page-scoped của khách).</li><li>Thông tin nhân viên doanh nghiệp: email, tên, vai trò. Mật khẩu chỉ lưu dạng băm.</li><li>Token truy cập Page, lưu mã hóa.</li></ul>
<h2>AI</h2><p>Khi doanh nghiệp bật tính năng AI, nội dung tin nhắn có thể được gửi tới nhà cung cấp AI ở nước ngoài để trích xuất tên, nhu cầu, ngân sách và lịch hẹn. AI mặc định <strong>tắt</strong>; chỉ chủ doanh nghiệp bật được, sau khi xác nhận. AI chỉ đề xuất, nhân viên quyết định.</p>
<h2>Xóa dữ liệu</h2><p>Bạn có thể yêu cầu xóa dữ liệu qua chức năng "Xóa dữ liệu" của Facebook (ứng dụng gửi yêu cầu tới chúng tôi), hoặc liên hệ ${esc(contact)}. Chủ doanh nghiệp có thể xuất và xóa toàn bộ dữ liệu doanh nghiệp trong ứng dụng.</p>
<h2>Chia sẻ</h2><p>Chúng tôi không bán dữ liệu. Dữ liệu của mỗi doanh nghiệp được tách biệt với doanh nghiệp khác.</p>`,
        ),
      ),
  );

  app.get('/terms', async (_req, reply) =>
    reply
      .header('cache-control', 'public, max-age=3600')
      .type('text/html; charset=utf-8')
      .send(
        page(
          'Điều khoản sử dụng SalesMind AI',
          `<p>Bằng việc sử dụng SalesMind AI, doanh nghiệp cam kết chỉ kết nối Page mình có quyền quản lý, tuân thủ chính sách nền tảng của Meta và quy định pháp luật về bảo vệ dữ liệu cá nhân, và chịu trách nhiệm về nội dung tin nhắn gửi cho khách. Dịch vụ cung cấp "nguyên trạng"; AI chỉ đề xuất và mọi quyết định thuộc về người dùng.</p>`,
        ),
      ),
  );

  // Meta gọi callback bằng application/x-www-form-urlencoded (Fastify mặc định chỉ hiểu JSON và text).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 20_000 }, (_req, raw, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(raw))));
  });

  const body = z.object({ signed_request: z.string().max(5000) });

  app.post('/meta/data-deletion', async (req, reply) => {
    const b = body.safeParse(req.body);
    const parsed = b.success ? parseSignedRequest(b.data.signed_request, opts.appSecret) : null;
    if (!parsed || !parsed.user_id) return reply.code(400).send({ error: 'invalid_signed_request' });
    // `user_id` là ID người dùng theo ứng dụng; nếu trùng một PSID đã lưu thì xóa luôn dữ liệu đó. Không trùng thì
    // chỉ ghi nhận yêu cầu để người vận hành xử lý tay (chưa có cách ánh xạ chắc chắn: điểm chưa xác minh với Meta).
    const code = randomBytes(12).toString('base64url');
    const ids = (await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.psid, parsed.user_id))).map((r) => r.id);
    const deleted = await deleteConversations(db, ids);
    await db.insert(deletionRequests).values({ code, fbUserId: parsed.user_id, status: deleted > 0 ? 'completed' : 'received', deletedConversations: deleted });
    return reply.send({ url: `${opts.publicBaseUrl}/meta/data-deletion/status?code=${code}`, confirmation_code: code });
  });

  app.get('/meta/data-deletion/status', async (req, reply) => {
    const code = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/).safeParse((req.query as { code?: string }).code);
    const [r] = code.success ? await db.select().from(deletionRequests).where(eq(deletionRequests.code, code.data)) : [];
    if (!r) return reply.code(404).type('text/html; charset=utf-8').send(page('Không tìm thấy yêu cầu', '<p>Mã xác nhận không đúng.</p>'));
    const text =
      r.status === 'completed'
        ? `Đã xóa ${r.deletedConversations} hội thoại gắn với tài khoản của bạn.`
        : 'Chúng tôi đã nhận yêu cầu. Không tìm thấy dữ liệu gắn trực tiếp với mã này; nếu bạn là khách của một doanh nghiệp dùng SalesMind AI, hãy liên hệ doanh nghiệp đó, hoặc quản trị viên sẽ xử lý yêu cầu thủ công.';
    return reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(page('Yêu cầu xóa dữ liệu', `<p>${esc(text)}</p><p>Mã xác nhận: <code>${esc(r.code)}</code></p>`));
  });

  app.post('/meta/deauthorize', async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success || !parseSignedRequest(b.data.signed_request, opts.appSecret)) return reply.code(400).send({ error: 'invalid_signed_request' });
    req.log.info({ deauthorize: true }, 'Meta báo người dùng gỡ ứng dụng');
    return reply.send({ ok: true });
  });
};

