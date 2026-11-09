import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, LOG_REDACT_PATHS } from '../src/app.js';
import type { ReadinessCheck } from '../src/health.js';
import { assessQueueHealth, startQueueMonitor, STALE_READY_SECONDS } from '../src/queue/monitor.js';
import { ALL_QUEUES, assertQueueExists, isDeadLetter, queueOverview, redriveDeadLetter, type QueueSummary } from '../src/queue/admin.js';
import { BACKFILL_DEAD_QUEUE, EXTRACT_DEAD_QUEUE, EXTRACT_QUEUE, WEBHOOK_DEAD_QUEUE, WEBHOOK_QUEUE } from '../src/queue/boss.js';

const apps: Array<{ close: () => Promise<unknown> }> = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

function appWithLogs(loggerExtra: Record<string, unknown> = {}, readiness?: ReadinessCheck[], readinessTimeoutMs?: number) {
  const lines: string[] = [];
  const app = buildApp(
    { logger: { level: 'debug', stream: { write: (s: string) => void lines.push(s) }, ...loggerExtra } },
    {
      appSecret: 's',
      verifyToken: 'v',
      queue: { enqueue: async () => {} },
      ...(readiness ? { readiness } : {}),
      ...(readinessTimeoutMs ? { readinessTimeoutMs } : {}),
    },
  );
  apps.push(app);
  return { app, lines };
}

describe('redact log (phòng thủ thêm)', () => {
  it('che token, secret, mật khẩu và nội dung tin ở mọi mức lồng một cấp, kể cả khi lỡ đưa vào log', async () => {
    const { app, lines } = appWithLogs();
    await app.ready();
    app.log.info({
      accessToken: 'TOKEN_A', token: 'TOKEN_B', access_token: 'TOKEN_C', tokenEnc: 'v1:ENC', client_secret: 'SECRET_D',
      appSecret: 'SECRET_E', password: 'PASS_F', text: 'NỘI DUNG TIN NHẮN 1',
      nested: { accessToken: 'TOKEN_G', text: 'NỘI DUNG TIN NHẮN 2', password: 'PASS_H' },
      ok: 'giữ nguyên',
    }, 'thử redact');
    const out = lines.join('\n');
    for (const secret of ['TOKEN_A', 'TOKEN_B', 'TOKEN_C', 'v1:ENC', 'SECRET_D', 'SECRET_E', 'PASS_F', 'NỘI DUNG TIN NHẮN 1', 'TOKEN_G', 'NỘI DUNG TIN NHẮN 2', 'PASS_H']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[đã ẩn]');
    expect(out).toContain('giữ nguyên'); // trường thường không bị che
  });

  it('không che mã lỗi Meta (code, httpStatus, type) vì cần cho việc chẩn đoán', async () => {
    const { app, lines } = appWithLogs();
    await app.ready();
    app.log.warn({ httpStatus: 400, code: 190, type: 'OAuthException' }, 'lỗi Meta');
    const out = lines.join('\n');
    expect(out).toContain('"code":190');
    expect(out).toContain('OAuthException');
  });

  it('gộp với đường dẫn redact do người gọi cấu hình, không ghi đè', async () => {
    const { app, lines } = appWithLogs({ redact: ['customerPhone'] });
    await app.ready();
    app.log.info({ customerPhone: '0901234567', accessToken: 'TOKEN_X' });
    const out = lines.join('\n');
    expect(out).not.toContain('0901234567');
    expect(out).not.toContain('TOKEN_X');
  });

  it('danh sách đường dẫn có các header nhạy cảm', () => {
    expect(LOG_REDACT_PATHS).toEqual(expect.arrayContaining(['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-hub-signature-256"]', 'res.headers["set-cookie"]']));
  });
});

describe('request id', () => {
  it('không có header: sinh UUID, trả về trong header phản hồi và có trong log', async () => {
    const { app, lines } = appWithLogs();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    const id = res.headers['x-request-id'] as string;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(lines.join('\n')).toContain(`"reqId":"${id}"`);
  });

  it('x-request-id hợp lệ của client được giữ nguyên để đối chiếu', async () => {
    const { app, lines } = appWithLogs();
    const res = await app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': 'trace-abc_123.x' } });
    expect(res.headers['x-request-id']).toBe('trace-abc_123.x');
    expect(lines.join('\n')).toContain('"reqId":"trace-abc_123.x"');
  });

  it.each([
    ['quá dài', 'a'.repeat(65)],
    ['có khoảng trắng', 'abc def'],
    ['có ký tự đặc biệt (thử chèn log)', 'abc"},"level":60,"x":"'],
    ['có dấu tiếng Việt', 'mã-yêu-cầu'],
  ])('x-request-id không an toàn (%s): bị thay bằng UUID, không đi vào log', async (_n, bad) => {
    const { app, lines } = appWithLogs();
    const res = await app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': bad } });
    const id = res.headers['x-request-id'] as string;
    expect(id).not.toBe(bad);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines.join('\n')).not.toContain(bad);
  });

  it('có ở cả phản hồi lỗi (404, 403 của webhook)', async () => {
    const { app } = appWithLogs();
    expect((await app.inject({ method: 'GET', url: '/khong-co' })).headers['x-request-id']).toBeTruthy();
    expect((await app.inject({ method: 'POST', url: '/webhook', payload: '{}' })).headers['x-request-id']).toBeTruthy();
  });
});

describe('/healthz và /readyz', () => {
  const ok = (name: string): ReadinessCheck => ({ name, check: async () => 'ok' });
  const bad = (name: string, msg = 'connection refused at 10.0.0.5 password=SECRET'): ReadinessCheck => ({
    name,
    check: async () => {
      throw new Error(msg);
    },
  });

  it('không có kiểm tra nào: sẵn sàng', async () => {
    const { app } = appWithLogs();
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: {} });
  });

  it('mọi kiểm tra đạt: 200 và liệt kê từng thành phần', async () => {
    const { app } = appWithLogs({}, [ok('db'), ok('queue')]);
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { db: 'ok', queue: 'ok' } });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('một thành phần lỗi: 503, chỉ nêu tên thành phần, KHÔNG lộ chi tiết lỗi', async () => {
    const { app } = appWithLogs({}, [ok('queue'), bad('db')]);
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'not_ready', checks: { queue: 'ok', db: 'fail' } });
    expect(res.body).not.toContain('10.0.0.5');
    expect(res.body).not.toContain('SECRET');
  });

  it('kiểm tra treo thì 503 sau thời gian chờ thay vì treo cả endpoint', async () => {
    const hang: ReadinessCheck = { name: 'db', check: () => new Promise(() => {}) };
    const { app } = appWithLogs({}, [hang], 150);
    const t0 = Date.now();
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('/healthz (liveness) vẫn 200 khi một thành phần lỗi: không khởi động lại tiến trình vô ích', async () => {
    const { app } = appWithLogs({}, [bad('db')]);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(503);
  });

  it('các kiểm tra chạy song song, không cộng dồn thời gian', async () => {
    const slow = (name: string): ReadinessCheck => ({ name, check: () => new Promise((r) => setTimeout(r, 200)) });
    const { app } = appWithLogs({}, [slow('a'), slow('b'), slow('c')]);
    const t0 = Date.now();
    await app.inject({ method: 'GET', url: '/readyz' });
    expect(Date.now() - t0).toBeLessThan(550);
  });
});

describe('quản trị hàng đợi', () => {
  const stats = (name: string, over: Partial<{ queuedCount: number; activeCount: number; failedCount: number; readyOldestSeconds: number | null }> = {}) => ({
    name, queuedCount: 0, activeCount: 0, failedCount: 0, readyOldestSeconds: null, ...over,
  });
  const fakeBoss = (byName: Record<string, ReturnType<typeof stats>>) => ({
    getQueueStats: async (name: string, opts?: { force?: boolean }) => {
      expect(opts?.force).toBe(true); // luôn đọc số liệu mới, không dùng cache 1 giờ
      return [byName[name] ?? stats(name)];
    },
  });

  it('queueOverview đọc đủ mọi queue và quy đổi đúng trường', async () => {
    const r = await queueOverview(fakeBoss({ [WEBHOOK_QUEUE]: stats(WEBHOOK_QUEUE, { queuedCount: 3, activeCount: 1, failedCount: 2, readyOldestSeconds: 12 }) }) as never);
    expect(r.map((q) => q.name)).toEqual([...ALL_QUEUES]);
    expect(r[0]).toEqual({ name: WEBHOOK_QUEUE, queued: 3, active: 1, failed: 2, oldestReadySeconds: 12 });
    expect(r[1]).toEqual({ name: WEBHOOK_DEAD_QUEUE, queued: 0, active: 0, failed: 0, oldestReadySeconds: null });
  });

  it('assertQueueExists: queue thiếu (getQueue trả null, không ném lỗi) thì phải báo lỗi để /readyz không báo nhầm là ổn', async () => {
    await expect(assertQueueExists({ getQueue: async () => ({ name: 'x' }) } as never, 'x')).resolves.toBeUndefined();
    await expect(assertQueueExists({ getQueue: async () => null } as never, 'x')).rejects.toThrow(/không tồn tại/);
  });

  it('queueOverview đọc các queue song song, không cộng dồn thời gian', async () => {
    const slow = { getQueueStats: async (name: string) => { await new Promise((r) => setTimeout(r, 120)); return [stats(name)]; } };
    const t0 = Date.now();
    await queueOverview(slow as never);
    expect(Date.now() - t0).toBeLessThan(120 * 3); // 5 queue tuần tự sẽ mất ~600ms
  });

  it('isDeadLetter nhận đúng ba queue dead-letter', () => {
    expect(isDeadLetter(WEBHOOK_DEAD_QUEUE)).toBe(true);
    expect(isDeadLetter(BACKFILL_DEAD_QUEUE)).toBe(true);
    expect(isDeadLetter(EXTRACT_DEAD_QUEUE)).toBe(true);
    expect(isDeadLetter(EXTRACT_QUEUE)).toBe(false);
    expect(isDeadLetter(WEBHOOK_QUEUE)).toBe(false);
  });

  const q = (name: string, o: Partial<QueueSummary> = {}): QueueSummary => ({ name, queued: 0, active: 0, failed: 0, oldestReadySeconds: null, ...o });

  it('assessQueueHealth: khỏe thì info, không có vấn đề', () => {
    const h = assessQueueHealth([q(WEBHOOK_QUEUE, { queued: 5, active: 2, oldestReadySeconds: 3 }), q(WEBHOOK_DEAD_QUEUE)]);
    expect(h).toMatchObject({ level: 'info', problems: [] });
  });

  it('assessQueueHealth: có job trong dead-letter thì cảnh báo kèm cách xử lý', () => {
    const h = assessQueueHealth([q(WEBHOOK_DEAD_QUEUE, { queued: 2 })]);
    expect(h.level).toBe('warn');
    expect(h.problems[0]).toContain('dead-letter');
    expect(h.problems[0]).toContain('queue:redrive');
  });

  it('assessQueueHealth: chờ quá lâu thì cảnh báo; số "failed" KHÔNG cảnh báo (pg-boss giữ job hết retry ở trạng thái failed dù đã vào dead-letter, sẽ trùng và không tự hết)', () => {
    expect(assessQueueHealth([q(WEBHOOK_QUEUE, { failed: 9 })]).level).toBe('info');
    expect(assessQueueHealth([q(WEBHOOK_QUEUE, { failed: 1 }), q(WEBHOOK_DEAD_QUEUE, { queued: 1 })]).problems).toHaveLength(1); // chỉ cảnh báo dead-letter, không đếm lại
    expect(assessQueueHealth([q(WEBHOOK_QUEUE, { oldestReadySeconds: STALE_READY_SECONDS + 1 })]).problems[0]).toContain('tắc');
    expect(assessQueueHealth([q(WEBHOOK_QUEUE, { oldestReadySeconds: STALE_READY_SECONDS })]).level).toBe('info');
    expect(assessQueueHealth([q(WEBHOOK_DEAD_QUEUE, { failed: 5 })]).level).toBe('info');
  });

  describe('startQueueMonitor', () => {
    const logs: Array<{ level: string; obj: Record<string, unknown> }> = [];
    const log = { info: (obj: object) => void logs.push({ level: 'info', obj: obj as never }), warn: (obj: object) => void logs.push({ level: 'warn', obj: obj as never }) };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it('ghi log ngay khi bắt đầu và định kỳ; dừng được', async () => {
      logs.length = 0;
      const stop = startQueueMonitor(fakeBoss({}) as never, log, { intervalMs: 30 });
      await wait(120);
      await stop();
      const n = logs.length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(logs.every((l) => l.level === 'info')).toBe(true);
      await wait(100);
      expect(logs.length).toBe(n); // đã dừng thật
    });

    it('có vấn đề thì ghi mức warn kèm số liệu và danh sách vấn đề', async () => {
      logs.length = 0;
      const stop = startQueueMonitor(fakeBoss({ [WEBHOOK_DEAD_QUEUE]: stats(WEBHOOK_DEAD_QUEUE, { queuedCount: 4 }) }) as never, log, { intervalMs: 1000 });
      await wait(60);
      await stop();
      const w = logs.find((l) => l.level === 'warn')!;
      expect(w).toBeTruthy();
      expect((w.obj.problems as string[])[0]).toContain('dead-letter');
      expect((w.obj.queues as Record<string, { queued: number }>)[WEBHOOK_DEAD_QUEUE]!.queued).toBe(4);
    });

    it('lỗi khi đọc số liệu chỉ ghi cảnh báo, không ném lỗi hay làm sập tiến trình', async () => {
      logs.length = 0;
      const boss = { getQueueStats: async () => { throw new Error('db down'); } };
      const stop = startQueueMonitor(boss as never, log, { intervalMs: 30 });
      await wait(100);
      await stop();
      expect(logs.length).toBeGreaterThanOrEqual(2);
      expect(logs.every((l) => l.level === 'warn' && l.obj.err === 'db down')).toBe(true);
    });

    it('lần đọc trước chưa xong thì bỏ lượt, không chồng chéo', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      const boss = {
        getQueueStats: async (name: string) => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await wait(60);
          concurrent -= 1;
          return [stats(name)];
        },
      };
      const stop = startQueueMonitor(boss as never, log, { intervalMs: 10 });
      await wait(300);
      await stop();
      // Một lượt đọc ALL_QUEUES.length queue song song; hai lượt chồng nhau sẽ cho gấp đôi.
      expect(maxConcurrent).toBe(ALL_QUEUES.length);
    });

    it('stop chờ lượt đọc đang chạy xong: sau khi stop xong không còn truy vấn dở dang (an toàn để đóng pg-boss)', async () => {
      let finished = false;
      let calls = 0;
      const boss = {
        getQueueStats: async (name: string) => {
          calls += 1;
          await wait(150);
          if (calls === ALL_QUEUES.length) finished = true; // lượt đầu đọc đủ mọi queue (song song)
          return [stats(name)];
        },
      };
      const stop = startQueueMonitor(boss as never, log, { intervalMs: 10_000 });
      await wait(30); // lượt đầu đang chạy dở
      expect(finished).toBe(false);
      await stop();
      expect(finished).toBe(true); // stop đã chờ lượt đó xong
    });
  });

  describe('redriveDeadLetter', () => {
    const calls: Array<{ kind: string; queue: string; opts: unknown }> = [];
    const boss = {
      redrive: async (queue: string, opts: unknown) => { calls.push({ kind: 'redrive', queue, opts }); return 7; },
      previewRedrive: async (queue: string, opts: unknown) => { calls.push({ kind: 'preview', queue, opts }); return { total: 10, destinations: [], unroutable: 3 }; },
    };

    it('webhook: chuyển từ dead-letter của webhook, mặc định tối đa 1000 job, và BÁO số job không có queue nguồn', async () => {
      calls.length = 0;
      const r = await redriveDeadLetter(boss as never, 'webhook');
      expect(r).toEqual({ target: 'webhook', dryRun: false, jobs: 7, unroutable: 3 });
      expect(calls).toEqual([
        { kind: 'preview', queue: WEBHOOK_DEAD_QUEUE, opts: { limit: 1000 } },
        { kind: 'redrive', queue: WEBHOOK_DEAD_QUEUE, opts: { limit: 1000 } },
      ]);
    });

    it('backfill với --limit: đúng queue và giới hạn', async () => {
      calls.length = 0;
      await redriveDeadLetter(boss as never, 'backfill', { limit: 5 });
      expect(calls.map((c) => [c.kind, c.queue, c.opts])).toEqual([
        ['preview', BACKFILL_DEAD_QUEUE, { limit: 5 }],
        ['redrive', BACKFILL_DEAD_QUEUE, { limit: 5 }],
      ]);
    });

    it('--dry-run chỉ xem trước, KHÔNG chuyển job nào', async () => {
      calls.length = 0;
      const r = await redriveDeadLetter(boss as never, 'webhook', { dryRun: true });
      expect(r).toEqual({ target: 'webhook', dryRun: true, jobs: 7, unroutable: 3 });
      expect(calls.map((c) => c.kind)).toEqual(['preview']);
    });
  });
});
