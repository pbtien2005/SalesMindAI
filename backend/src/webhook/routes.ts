import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { quoteLargeAppIds, stripNul } from '../meta/sanitize.js';
import { safeEqual, verifySignature } from '../meta/signature.js';
import type { WebhookQueue } from '../queue/boss.js';

export interface WebhookRouteOptions {
  appSecret: string;
  verifyToken: string;
  queue: WebhookQueue;
  /**
   * Quá thời gian này mà chưa ghi được vào hàng đợi thì trả 503 để Meta thử lại.
   * Phải nhỏ hơn 5 giây (yêu cầu của dự án).
   */
  enqueueTimeoutMs?: number;
}

/** Meta gộp tối đa 1000 sự kiện mỗi request; chừa dư cho payload lớn. */
const BODY_LIMIT_BYTES = 5 * 1024 * 1024;

const verifyQuery = z.object({
  'hub.mode': z.string(),
  'hub.verify_token': z.string(),
  'hub.challenge': z.string(),
});

class EnqueueTimeout extends Error {
  override readonly name = 'EnqueueTimeout';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EnqueueTimeout('ghi hàng đợi quá thời gian')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * GET/POST /webhook cho Meta.
 *
 * Plugin này KHÔNG bọc bằng fastify-plugin nên parser body bên dưới chỉ có hiệu lực trong phạm vi
 * của nó: các route khác vẫn dùng parser JSON mặc định.
 */
export const webhookRoutes: FastifyPluginAsync<WebhookRouteOptions> = async (app, opts) => {
  const enqueueTimeoutMs = opts.enqueueTimeoutMs ?? 4000;

  // Giữ nguyên các byte thô của body: chữ ký HMAC tính trên đúng các byte này, parse rồi
  // stringify lại sẽ khác (khoảng trắng, escape Unicode) và làm chữ ký sai.
  // '*' để request thiếu hoặc sai Content-Type cũng đi tới kiểm tra chữ ký (403) thay vì 415.
  const asBuffer = (_req: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) =>
    done(null, body);
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: BODY_LIMIT_BYTES }, asBuffer);
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: BODY_LIMIT_BYTES }, asBuffer);

  // Meta gọi GET này khi đăng ký webhook trong App Dashboard.
  app.get('/webhook', async (req, reply) => {
    const q = verifyQuery.safeParse(req.query);
    if (
      !q.success ||
      q.data['hub.mode'] !== 'subscribe' ||
      !safeEqual(q.data['hub.verify_token'], opts.verifyToken)
    ) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return reply.code(200).type('text/plain').send(q.data['hub.challenge']);
  });

  // Chỉ kiểm tra chữ ký rồi ghi vào hàng đợi; xử lý nặng làm ở worker.
  app.post('/webhook', { bodyLimit: BODY_LIMIT_BYTES }, async (req, reply) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const header = req.headers['x-hub-signature-256'];

    if (!verifySignature(raw, typeof header === 'string' ? header : undefined, opts.appSecret)) {
      req.log.warn('webhook bị từ chối: chữ ký không hợp lệ');
      return reply.code(403).send({ error: 'invalid_signature' });
    }

    let payload: unknown;
    try {
      // Bỏ NUL (\u0000) trước khi vào hàng đợi: pg-boss lưu job bằng jsonb, không nhận ký tự này.
      // app_id dài chuyển thành chuỗi trước khi parse để không mất độ chính xác (xem quoteLargeAppIds).
      payload = stripNul(JSON.parse(quoteLargeAppIds(raw.toString('utf8'))));
    } catch {
      // Chữ ký đúng nhưng body không phải JSON: Meta không bao giờ gửi vậy. 400 và không thử lại.
      return reply.code(400).send({ error: 'invalid_json' });
    }

    try {
      await withTimeout(
        opts.queue.enqueue({ payload, receivedAt: new Date().toISOString() }),
        enqueueTimeoutMs,
      );
    } catch (err) {
      // Không trả 200 thì Meta sẽ thử lại (tới 36 giờ); khử trùng theo mid giữ cho việc đó an toàn.
      req.log.error({ err }, 'không ghi được webhook vào hàng đợi');
      return reply.code(503).send({ error: 'queue_unavailable' });
    }

    return reply.code(200).type('text/plain').send('EVENT_RECEIVED');
  });
};
