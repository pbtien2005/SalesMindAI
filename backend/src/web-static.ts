/**
 * Phục vụ bản build của `web/` (SPA) từ chính backend, cùng một origin: cookie phiên hoạt động, không cần CORS,
 * và chạy được sau một tunnel duy nhất. Đường dẫn của SPA (không phải tệp, không thuộc API) trả `index.html`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Tiền tố thuộc về backend: không bao giờ rơi về `index.html` (lỗi phải là JSON 404, không phải trang web). */
const RESERVED = ['/api/', '/webhook', '/auth/', '/healthz', '/readyz'];

export function hasWebBuild(dir: string): boolean {
  return existsSync(join(dir, 'index.html'));
}

export function registerWebStatic(app: FastifyInstance, dir: string): void {
  void app.register(fastifyStatic, {
    root: dir,
    cacheControl: false,
    setHeaders(res, filePath) {
      // Tệp có băm trong tên (Vite xuất vào /assets/) đổi tên khi đổi nội dung nên cache vô thời hạn được;
      // index.html phải luôn được kiểm lại để nhận bản build mới.
      const hashed = /[\\/]assets[\\/]/.test(filePath);
      res.header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  app.setNotFoundHandler(async (req, reply) => {
    const path = req.url.split('?')[0] ?? '/';
    const isPage = (req.method === 'GET' || req.method === 'HEAD') && !RESERVED.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`) || path === p.replace(/\/$/, ''));
    const wantsHtml = String(req.headers.accept ?? '').includes('text/html');
    if (isPage && wantsHtml) {
      reply.header('cache-control', 'no-cache');
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'not_found', message: 'Không có đường dẫn này.' } });
  });
}
