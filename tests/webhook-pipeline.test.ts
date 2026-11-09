import { asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import * as schema from '../src/db/schema.js';
import { conversations, messages, pages, tenants } from '../src/db/schema.js';
import {
  createBoss,
  createWebhookQueue,
  startWebhookWorker,
  WEBHOOK_DEAD_QUEUE,
  WEBHOOK_QUEUE,
  type WebhookJobData,
} from '../src/queue/boss.js';
import { processWebhookPayload, UnknownPageError } from '../src/workers/process-webhook.js';
import { getTestDatabaseUrl, openTestDb, truncateAll } from './helpers/test-db.js';
import { APP_SECRET, messageEvent, PAGE_ID, PSID, sign, VERIFY_TOKEN, webhookPayload } from './helpers/webhook.js';

const handle = openTestDb();
const { db } = handle;

let boss: PgBoss;
let app: ReturnType<typeof buildApp>;
let logLines: string[];

/** Worker gọi hàm này: mỗi test thay bằng hành vi riêng (chậm, lỗi...). */
let work: (data: WebhookJobData) => Promise<void>;
let finished = 0; // số job đã chạy xong (kể cả lỗi) để test biết khi nào hàng đợi đã xử lý

/** Kết quả từng lần worker chạy, để test kiểm tra việc khử trùng thật sự xảy ra (chứ không chỉ DB chặn). */
let runs: Array<{ stored: number; duplicates: number }>;

const realWork = async (data: WebhookJobData) => {
  const s = await processWebhookPayload(db, data.payload, app.log);
  runs.push({ stored: s.stored, duplicates: s.duplicates });
};

async function waitFor<T>(fn: () => Promise<T | false | undefined | null>, timeoutMs = 20_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor: quá thời gian');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const count = async () => (await db.select().from(messages)).length;
const waitJobs = (n: number) => waitFor(async () => finished >= n);

beforeAll(async () => {
  // Retry nhanh để test không phải chờ lâu: tối đa 3 lần chạy, cách nhau 1 giây.
  boss = await createBoss(getTestDatabaseUrl(), {
    queueOverrides: { retryLimit: 2, retryDelay: 1, retryBackoff: false },
  });
  await startWebhookWorker(
    boss,
    async (data) => {
      try {
        await work(data);
      } finally {
        finished += 1;
      }
    },
    { pollingIntervalSeconds: 0.5 },
  );
});

afterAll(async () => {
  await boss.stop({ graceful: true, timeout: 10_000 });
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  await boss.deleteAllJobs(WEBHOOK_QUEUE);
  await boss.deleteAllJobs(WEBHOOK_DEAD_QUEUE);
  finished = 0;
  runs = [];
  work = realWork;
  logLines = [];
  app = buildApp(
    { logger: { level: 'debug', stream: { write: (s: string) => void logLines.push(s) } } },
    { appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, queue: createWebhookQueue(boss) },
  );
  await app.ready();

  const [tenant] = await db.insert(tenants).values({ name: 'Công ty A' }).returning();
  await db.insert(pages).values({ tenantId: tenant!.id, fbPageId: PAGE_ID, name: 'Page 1', tokenEnc: 'enc' });
});

const send = (payload: unknown) => {
  const raw = JSON.stringify(payload);
  return app.inject({
    method: 'POST',
    url: '/webhook',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) },
    payload: raw,
  });
};

describe('webhook → hàng đợi → worker → DB', () => {
  it('lưu tin hợp lệ với đúng nội dung, thời điểm gửi và hội thoại', async () => {
    const res = await send(webhookPayload([messageEvent({ mid: 'm1', text: 'Anh muốn mua 20 bộ', timestamp: 1_700_000_123_456 })]));
    expect(res.statusCode).toBe(200);
    await waitJobs(1);

    const [row] = await db.select().from(messages);
    expect(row).toMatchObject({ mid: 'm1', text: 'Anh muốn mua 20 bộ', source: 'webhook' });
    expect(row!.sentAt.getTime()).toBe(1_700_000_123_456);
    const [conv] = await db.select().from(conversations);
    expect(conv).toMatchObject({ psid: PSID });
    expect(conv!.lastMessageAt!.getTime()).toBe(1_700_000_123_456);
    expect(row!.conversationId).toBe(conv!.id);
  });

  it('Meta gửi lại cùng payload nhiều lần: vẫn đúng một dòng', async () => {
    const payload = webhookPayload([messageEvent({ mid: 'dup', text: 'a' })]);
    for (let i = 0; i < 3; i++) expect((await send(payload)).statusCode).toBe(200);
    await waitJobs(3);
    expect(await count()).toBe(1);
    // Khử trùng do code làm (ON CONFLICT DO NOTHING), không phải job lỗi vì vi phạm unique rồi retry:
    // cả 3 lần chạy đều thành công, một lần lưu và hai lần nhận ra là trùng.
    expect(runs).toHaveLength(3);
    expect(runs.reduce((n, r) => n + r.stored, 0)).toBe(1);
    expect(runs.reduce((n, r) => n + r.duplicates, 0)).toBe(2);
    expect(finished).toBe(3);
  });

  it('bỏ tin do Page gửi (is_echo), chỉ lưu tin của khách', async () => {
    await send(
      webhookPayload([
        messageEvent({ mid: 'in', text: 'khách hỏi' }),
        messageEvent({ mid: 'out', text: 'sale trả lời', isEcho: true }),
      ]),
    );
    await waitJobs(1);
    const rows = await db.select().from(messages);
    expect(rows.map((r) => r.mid)).toEqual(['in']);
  });

  it('tin đến sai thứ tự (qua nhiều request): sắp đúng theo sent_at, last_message_at không lùi', async () => {
    const t = 1_700_000_000_000;
    await send(webhookPayload([messageEvent({ mid: 'late', text: 'sau', timestamp: t + 5000 })]));
    await waitJobs(1);
    await send(webhookPayload([messageEvent({ mid: 'early', text: 'trước', timestamp: t + 1000 })]));
    await waitJobs(2);

    const rows = await db.select({ mid: messages.mid }).from(messages).orderBy(asc(messages.sentAt));
    expect(rows.map((r) => r.mid)).toEqual(['early', 'late']);
    const [conv] = await db.select().from(conversations);
    expect(conv!.lastMessageAt!.getTime()).toBe(t + 5000);
  });

  it('nhiều tin cùng khách chỉ tạo một conversation; khách khác tạo conversation khác', async () => {
    await send(
      webhookPayload([
        messageEvent({ mid: 'a', text: '1', timestamp: 1000 }),
        messageEvent({ mid: 'b', text: '2', timestamp: 2000 }),
        messageEvent({ mid: 'c', text: '3', timestamp: 3000, psid: 'PSID_2' }),
      ]),
    );
    await waitJobs(1);
    const convs = await db.select().from(conversations);
    expect(convs.map((c) => c.psid).sort()).toEqual(['PSID_1', 'PSID_2']);
    expect(await count()).toBe(3);
  });

  it('tin gửi tới Page chưa kết nối: không mất. Retry rồi vào dead-letter, tin của Page đã biết vẫn được lưu', async () => {
    // Meta đã nhận 200 và sẽ không gửi lại, nên bỏ qua im lặng nghĩa là mất tin.
    const payload = {
      object: 'page',
      entry: [
        { id: PAGE_ID, messaging: [messageEvent({ mid: 'known', text: 'Page đã kết nối' })] },
        { id: 'UNKNOWN_PAGE', messaging: [messageEvent({ mid: 'unk', text: 'Page chưa kết nối', pageId: 'UNKNOWN_PAGE' })] },
      ],
    };
    expect((await send(payload)).statusCode).toBe(200);
    const dead = await waitFor(async () => {
      const jobs = await boss.fetch<WebhookJobData>(WEBHOOK_DEAD_QUEUE);
      return jobs.length > 0 ? jobs : false;
    }, 30_000);
    expect(finished).toBe(3); // 1 lần đầu + 2 lần retry
    expect(dead[0]!.data.payload).toEqual(payload); // còn nguyên để chạy lại sau khi kết nối Page
    const rows = await db.select().from(messages);
    expect(rows.map((r) => r.mid)).toEqual(['known']); // tin của Page biết được lưu đúng một lần
    expect(runs.map((r) => r.stored)).toEqual([]); // cả 3 lần đều ném lỗi sau khi lưu, không ghi runs
  });

  it('Page kết nối chậm hơn tin đầu tiên: retry thấy Page rồi lưu được, không cần dead-letter', async () => {
    const res = await send(webhookPayload([messageEvent({ mid: 'early', text: 'tin đến trước khi kết nối xong', pageId: 'LATE_PAGE' })], 'LATE_PAGE'));
    expect(res.statusCode).toBe(200);
    await waitFor(async () => finished >= 1); // lần đầu lỗi vì chưa có Page
    const [tenant] = await db.select().from(tenants);
    await db.insert(pages).values({ tenantId: tenant!.id, fbPageId: 'LATE_PAGE', name: 'Late', tokenEnc: 'enc' });
    await waitFor(async () => (await count()) === 1);
    expect(await boss.fetch(WEBHOOK_DEAD_QUEUE)).toHaveLength(0);
  });

  it('tin có ký tự NUL không làm hỏng batch: webhook vẫn 200 và mọi tin được lưu (đã bỏ NUL)', async () => {
    // Postgres/jsonb không nhận \u0000. Trước khi sửa, boss.send() lỗi => 503 => Meta thử lại rồi bỏ.
    const res = await send(
      webhookPayload([
        messageEvent({ mid: 'p1', text: 'bình thường' }),
        messageEvent({ mid: 'p2', text: 'có\u0000nul', attachments: [{ type: 'file', payload: { url: 'u\u0000v' } }] }),
        messageEvent({ mid: 'p3\u0000x', text: 'mid lạ' }),
      ]),
    );
    expect(res.statusCode).toBe(200);
    await waitJobs(1);
    const rows = await db.select().from(messages).orderBy(asc(messages.mid));
    expect(rows.map((r) => [r.mid, r.text])).toEqual([
      ['p1', 'bình thường'],
      ['p2', 'cónul'],
      ['p3x', 'mid lạ'],
    ]);
    expect(rows[1]!.attachments).toEqual([{ type: 'file', payload: { url: 'uv' } }]);
    expect(finished).toBe(1); // không phải retry
  });

  it('số truy vấn không tăng theo số tin: batch 1000 tin chỉ cần vài câu lệnh', async () => {
    let queries = 0;
    const counting = drizzle(handle.pool, { schema, logger: { logQuery: () => void (queries += 1) } });
    const events = Array.from({ length: 1000 }, (_, i) =>
      messageEvent({ mid: `q${i}`, text: `t${i}`, timestamp: 1_700_000_000_000 + i, psid: `U${i % 50}` }),
    );
    const stats = await processWebhookPayload(counting, webhookPayload(events), app.log);
    expect(stats).toMatchObject({ stored: 1000, duplicates: 0 });
    // chọn Page + upsert conversations + insert messages (+ BEGIN/COMMIT). Trước khi gộp là ~2000.
    expect(queries).toBeLessThanOrEqual(10);
    // chạy lại: không trùng, vẫn ít câu lệnh
    queries = 0;
    const again = await processWebhookPayload(counting, webhookPayload(events), app.log);
    expect(again).toMatchObject({ stored: 0, duplicates: 1000 });
    expect(queries).toBeLessThanOrEqual(10);
  });

  it('batch 1000 tin được lưu đủ và đúng thứ tự', async () => {
    const t = 1_700_000_000_000;
    const events = Array.from({ length: 1000 }, (_, i) => messageEvent({ mid: `b${i}`, text: `t${i}`, timestamp: t + i, psid: `U${i % 50}` }));
    expect((await send(webhookPayload(events))).statusCode).toBe(200);
    await waitJobs(1);
    expect(await count()).toBe(1000);
    expect((await db.select().from(conversations)).length).toBe(50);
  });
});

describe('độ trễ và độ bền', () => {
  it('worker chậm không làm chậm webhook: trả 200 ngay, tin được lưu sau', async () => {
    work = async (d) => {
      await new Promise((r) => setTimeout(r, 2500));
      await realWork(d);
    };
    const t0 = Date.now();
    const res = await send(webhookPayload([messageEvent({ mid: 'slow', text: 'a' })]));
    const elapsed = Date.now() - t0;
    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(1000);
    expect(await count()).toBe(0); // worker chưa xong
    await waitFor(async () => (await count()) === 1);
  });

  it('lỗi tạm thời: job được retry và tin chỉ được lưu một lần', async () => {
    let calls = 0;
    work = async (d) => {
      calls += 1;
      if (calls === 1) throw new Error('lỗi tạm thời giả lập');
      await realWork(d);
    };
    await send(webhookPayload([messageEvent({ mid: 'retry', text: 'a' })]));
    await waitFor(async () => (await count()) === 1);
    expect(calls).toBe(2);
    expect(await count()).toBe(1);
  });

  it('lỗi vĩnh viễn: hết retry thì vào dead-letter, không mất payload', async () => {
    let calls = 0;
    work = async () => {
      calls += 1;
      throw new Error('lỗi vĩnh viễn giả lập');
    };
    const payload = webhookPayload([messageEvent({ mid: 'dead', text: 'giữ lại' })]);
    await send(payload);
    const dead = await waitFor(async () => {
      const jobs = await boss.fetch<WebhookJobData>(WEBHOOK_DEAD_QUEUE);
      return jobs.length > 0 ? jobs : false;
    }, 30_000);
    expect(calls).toBe(3); // 1 lần đầu + 2 lần retry
    expect(dead[0]!.data.payload).toEqual(payload);
    expect(await count()).toBe(0);
  });

  it('xử lý theo kiểu tất cả hoặc không gì: lỗi giữa chừng thì rollback, chạy lại lưu đủ', async () => {
    const payload = webhookPayload([
      messageEvent({ mid: 'a', text: '1', timestamp: 1000 }),
      messageEvent({ mid: 'b', text: '2', timestamp: 2000, psid: 'PSID_2' }),
    ]);
    const failingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return (fn: Parameters<typeof db.transaction>[0]) =>
            target.transaction(async (tx) => {
              await fn(tx);
              throw new Error('lỗi sau khi đã ghi hết');
            });
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(processWebhookPayload(failingDb, payload, app.log)).rejects.toThrow('lỗi sau khi đã ghi hết');
    expect(await count()).toBe(0);
    expect((await db.select().from(conversations)).length).toBe(0);

    const stats = await processWebhookPayload(db, payload, app.log);
    expect(stats.stored).toBe(2);
    const stats2 = await processWebhookPayload(db, payload, app.log); // chạy lại lần nữa
    expect(stats2).toMatchObject({ stored: 0, duplicates: 2 });
    expect(await count()).toBe(2);
  });

  it('Page chưa biết: ném UnknownPageError nhưng đã lưu xong tin của Page đã biết', async () => {
    const payload = {
      object: 'page',
      entry: [
        { id: PAGE_ID, messaging: [messageEvent({ mid: 'k1', text: 'a' })] },
        { id: 'NOPE', messaging: [messageEvent({ mid: 'u1', text: 'b', pageId: 'NOPE' })] },
      ],
    };
    const err = await processWebhookPayload(db, payload, app.log).catch((e) => e);
    expect(err).toBeInstanceOf(UnknownPageError);
    expect((err as UnknownPageError).count).toBe(1);
    expect((await db.select().from(messages)).map((r) => r.mid)).toEqual(['k1']);
  });

  it('createBoss chạy lần hai áp dụng cấu hình mới cho queue đã tồn tại', async () => {
    const before = await boss.getQueue(WEBHOOK_QUEUE);
    expect(before!.retryLimit).toBe(2); // cấu hình của test này (createBoss ở beforeAll)
    const second = await createBoss(getTestDatabaseUrl(), {
      queueOverrides: { retryLimit: 5, retryDelay: 1, retryBackoff: false },
    });
    try {
      const after = await second.getQueue(WEBHOOK_QUEUE);
      expect(after!.retryLimit).toBe(5);
      expect(after!.deadLetter).toBe(WEBHOOK_DEAD_QUEUE);
    } finally {
      await second.updateQueue(WEBHOOK_QUEUE, { retryLimit: 2 }); // trả lại cho các test sau
      await second.stop({ graceful: true, timeout: 5000 });
    }
  });
});

describe('quyền riêng tư trong log', () => {
  it('log không chứa nội dung tin, PSID, chữ ký hay APP_SECRET (kể cả ở mức debug)', async () => {
    const secretText = 'NOI-DUNG-BI-MAT-98765';
    const payload = webhookPayload([messageEvent({ mid: 'priv', text: secretText })]);
    const raw = JSON.stringify(payload);
    const signature = sign(raw);
    const ok = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
      payload: raw,
    });
    expect(ok.statusCode).toBe(200);
    await waitJobs(1);

    const badSig = sign(raw, 'wrong');
    const bad = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': badSig },
      payload: raw,
    });
    expect(bad.statusCode).toBe(403);

    // Meta gửi verify token trong query string của GET /webhook: URL không được ghi nguyên vào log.
    const verify = await app.inject({
      method: 'GET',
      url: `/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=424242`,
    });
    expect(verify.statusCode).toBe(200);

    const all = logLines.join('\n');
    expect(all.length).toBeGreaterThan(0); // có log thật để kiểm tra
    for (const forbidden of [secretText, PSID, signature, badSig, APP_SECRET, VERIFY_TOKEN]) {
      expect(all).not.toContain(forbidden);
    }
  });
});
