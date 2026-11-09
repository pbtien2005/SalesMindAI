import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { WebhookJobData, WebhookQueue } from '../src/queue/boss.js';
import { APP_SECRET, messageEvent, sign, VERIFY_TOKEN, webhookPayload } from './helpers/webhook.js';

class FakeQueue implements WebhookQueue {
  jobs: WebhookJobData[] = [];
  impl: (d: WebhookJobData) => Promise<void> = async (d) => {
    this.jobs.push(d);
  };
  enqueue(d: WebhookJobData) {
    return this.impl(d);
  }
}

let queue: FakeQueue;
let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  queue = new FakeQueue();
  app = buildApp({}, { appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, queue, enqueueTimeoutMs: 300 });
  await app.ready();
});
afterEach(() => app.close());

const post = (raw: string | Buffer, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/webhook',
    headers: { 'content-type': 'application/json', ...headers },
    payload: raw,
  });

const body = JSON.stringify(webhookPayload([messageEvent({ mid: 'm1', text: 'xin chào' })]));

describe('GET /webhook (xác minh với Meta)', () => {
  const get = (q: Record<string, string>) => app.inject({ method: 'GET', url: '/webhook', query: q });

  it('đúng mode và token thì trả lại hub.challenge dạng text', async () => {
    const res = await get({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('1158201444');
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
  });

  it.each([
    ['sai token', { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' }],
    ['sai mode', { 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1' }],
    ['thiếu challenge', { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN }],
    ['thiếu token', { 'hub.mode': 'subscribe', 'hub.challenge': '1' }],
    ['không có tham số', {}],
  ])('trả 403 khi %s', async (_n, q) => {
    const res = await get(q as Record<string, string>);
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('1');
  });
});

describe('POST /webhook', () => {
  it('chữ ký đúng: 200 và đưa đúng một job vào hàng đợi', async () => {
    const res = await post(body, { 'x-hub-signature-256': sign(body) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('EVENT_RECEIVED');
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]!.payload).toEqual(JSON.parse(body));
  });

  it('chữ ký sai: 403, không vào hàng đợi', async () => {
    const res = await post(body, { 'x-hub-signature-256': sign(body, 'wrong-secret') });
    expect(res.statusCode).toBe(403);
    expect(queue.jobs).toHaveLength(0);
  });

  it('thiếu chữ ký: 403, không vào hàng đợi', async () => {
    const res = await post(body);
    expect(res.statusCode).toBe(403);
    expect(queue.jobs).toHaveLength(0);
  });

  it('payload bị sửa sau khi ký: 403', async () => {
    const tampered = body.replace('xin chào', 'xin chao');
    const res = await post(tampered, { 'x-hub-signature-256': sign(body) });
    expect(res.statusCode).toBe(403);
    expect(queue.jobs).toHaveLength(0);
  });

  it('body rỗng, không chữ ký: 403', async () => {
    const res = await app.inject({ method: 'POST', url: '/webhook' });
    expect(res.statusCode).toBe(403);
  });

  it('Content-Type lạ cũng đi tới kiểm tra chữ ký (403, không phải 415)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'text/plain' },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it('khớp theo byte thô với tiếng Việt, \\u-escape, khoảng trắng và xuống dòng', async () => {
    const variants = [
      JSON.stringify(webhookPayload([messageEvent({ mid: 'v1', text: 'Anh muốn mua 20 bộ' })])),
      JSON.stringify(webhookPayload([messageEvent({ mid: 'v2', text: 'Anh muốn mua' })])).replace(/ố/g, '\\u1ed1'),
      JSON.stringify(webhookPayload([messageEvent({ mid: 'v3', text: 'a' })]), null, 2) + '\n',
    ];
    for (const raw of variants) {
      const res = await post(raw, { 'x-hub-signature-256': sign(raw) });
      expect(res.statusCode).toBe(200);
    }
    expect(queue.jobs).toHaveLength(3);
  });

  it('bỏ ký tự NUL khỏi payload trước khi vào hàng đợi (pg-boss/jsonb không nhận NUL)', async () => {
    const raw = JSON.stringify(webhookPayload([messageEvent({ mid: 'n1', text: 'a\u0000b' })]));
    expect(raw).toContain('\\u0000'); // chắc chắn payload thô có NUL
    const res = await post(raw, { 'x-hub-signature-256': sign(raw) }); // ký trên byte thô gốc
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(queue.jobs[0]!.payload)).not.toContain('\\u0000');
    expect(JSON.stringify(queue.jobs[0]!.payload)).toContain('"text":"ab"');
  });

  it('chữ ký đúng nhưng body không phải JSON: 400, không vào hàng đợi', async () => {
    const raw = 'not json at all';
    const res = await post(raw, { 'x-hub-signature-256': sign(raw) });
    expect(res.statusCode).toBe(400);
    expect(queue.jobs).toHaveLength(0);
  });

  it('hàng đợi lỗi: 503 để Meta thử lại', async () => {
    queue.impl = async () => {
      throw new Error('db down');
    };
    const res = await post(body, { 'x-hub-signature-256': sign(body) });
    expect(res.statusCode).toBe(503);
  });

  it('hàng đợi treo: trả 503 trước 5 giây thay vì chờ mãi', async () => {
    queue.impl = () => new Promise(() => {}); // không bao giờ xong
    const t0 = Date.now();
    const res = await post(body, { 'x-hub-signature-256': sign(body) });
    expect(res.statusCode).toBe(503);
    expect(Date.now() - t0).toBeLessThan(2000); // timeout test là 300ms
  });

  it('nhận payload lớn (1000 sự kiện) và vẫn trả 200', async () => {
    const events = Array.from({ length: 1000 }, (_, i) => messageEvent({ mid: `m${i}`, text: 'x'.repeat(200) }));
    const raw = JSON.stringify(webhookPayload(events));
    expect(Buffer.byteLength(raw)).toBeGreaterThan(200_000);
    const res = await post(raw, { 'x-hub-signature-256': sign(raw) });
    expect(res.statusCode).toBe(200);
  });
});

describe('phạm vi parser body', () => {
  it('route khác vẫn dùng parser JSON mặc định (không bị parser của /webhook ảnh hưởng)', async () => {
    const other = buildApp({}, { appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, queue: new FakeQueue() });
    other.post('/echo', async (req) => ({ got: req.body }));
    await other.ready();
    const res = await other.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: { a: 1 },
    });
    expect(res.json()).toEqual({ got: { a: 1 } });
    await other.close();
  });
});
