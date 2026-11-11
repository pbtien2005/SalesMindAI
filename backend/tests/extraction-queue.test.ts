import { eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { extractionRuns, proposals } from '../src/db/schema.js';
import { OfflineExtractor } from '../src/extraction/offline-extractor.js';
import { runExtraction } from '../src/extraction/run.js';
import { enqueueExtractions, findStaleConversations, sweepOnce } from '../src/extraction/schedule.js';
import type { Extractor, ExtractorOutcome } from '../src/extraction/types.js';
import { redriveDeadLetter } from '../src/queue/admin.js';
import { createBoss, createExtractQueue, EXTRACT_DEAD_QUEUE, EXTRACT_QUEUE, startExtractWorker } from '../src/queue/boss.js';
import { processWebhookPayload } from '../src/workers/process-webhook.js';
import { addMessage, seedBase } from './helpers/fixtures.js';
import { getTestDatabaseUrl, openTestDb, truncateAll } from './helpers/test-db.js';
import { messageEvent, webhookPayload } from './helpers/webhook.js';

const handle = openTestDb();
const { db } = handle;
const log = { info: () => {}, warn: () => {} };

let boss: PgBoss;
let behavior: () => ExtractorOutcome | Promise<ExtractorOutcome>;
let attempts: number;
const extractor: Extractor = {
  model: 'fake',
  async extract() {
    attempts += 1;
    return behavior();
  },
};
const okEmpty = (): ExtractorOutcome => ({ kind: 'ok', candidates: [], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 } });

const T = (min: number) => new Date(Date.UTC(2026, 10, 12, 2, min));

async function waitFor<T>(fn: () => Promise<T | false | undefined | null>, timeoutMs = 25_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor: quá thời gian');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Đếm thẳng từ bảng job: `getQueueStats` của pg-boss có thể trễ tới ~1 phút (xem PROGRESS.md, mốc 5). */
const queued = async (name: string) => {
  const r = await handle.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND state IN ('created', 'retry', 'active')`, [name]);
  return r.rows[0]!.n;
};

beforeAll(async () => {
  // Retry nhanh: tối đa 2 lần chạy, cách nhau 1 giây.
  boss = await createBoss(getTestDatabaseUrl(), { extractQueueOverrides: { retryLimit: 1, retryDelay: 1, retryBackoff: false } });
});
afterAll(async () => {
  await boss.stop({ graceful: true, timeout: 10_000 });
  await handle.close();
});
beforeEach(async () => {
  await truncateAll(handle);
  for (const q of [EXTRACT_QUEUE, EXTRACT_DEAD_QUEUE]) await boss.deleteAllJobs(q);
  attempts = 0;
  behavior = okEmpty;
});

describe('xếp việc trích xuất', () => {
  it('nhiều lần xếp cho cùng hội thoại chỉ cho MỘT job đang chờ (gom tin)', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    const q = createExtractQueue(boss);
    expect(await q.enqueue(base.conversationId, 60)).toBe(true);
    expect(await q.enqueue(base.conversationId, 60)).toBe(false);
    expect(await q.enqueue(base.conversationId, 60)).toBe(false);
    expect(await queued(EXTRACT_QUEUE)).toBe(1);
  });

  it('hai hội thoại KHÁC nhau đều có job riêng (khóa theo hội thoại, không gộp cả hàng đợi)', async () => {
    const a = await seedBase(db, { aiEnabled: true });
    const b = await seedBase(db, { aiEnabled: true });
    const q = createExtractQueue(boss);
    expect(await q.enqueue(a.conversationId, 60)).toBe(true);
    expect(await q.enqueue(b.conversationId, 60)).toBe(true);
    expect(await queued(EXTRACT_QUEUE)).toBe(2);
  });

  it('tenant tắt AI thì không có job', async () => {
    const off = await seedBase(db, { aiEnabled: false });
    const on = await seedBase(db, { aiEnabled: true });
    const n = await enqueueExtractions(db, createExtractQueue(boss), [off.conversationId, on.conversationId], 60);
    expect(n).toBe(1);
    expect(await queued(EXTRACT_QUEUE)).toBe(1);
  });

  it('job chỉ mang ID hội thoại, không có nội dung tin', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    await addMessage(db, base, { text: 'Nội dung bí mật 0912345678', sentAt: T(5) });
    await createExtractQueue(boss).enqueue(base.conversationId, 60);
    const res = await handle.pool.query(`SELECT data FROM pgboss.job WHERE name = $1`, [EXTRACT_QUEUE]);
    expect(JSON.stringify(res.rows[0]!.data)).toBe(JSON.stringify({ conversationId: base.conversationId }));
  });
});

describe('worker trích xuất chạy thật', () => {
  const start = () =>
    startExtractWorker(
      boss,
      async ({ conversationId }) => {
        await runExtraction({ db, extractor, log, contextMessages: 30 }, conversationId);
      },
      { pollingIntervalSeconds: 0.5 },
    );

  it('debounce: ba tin liên tiếp chỉ gọi AI MỘT lần và đề xuất đúng', async () => {
    behavior = () => ({ kind: 'ok', candidates: [], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 } });
    const base = await seedBase(db, { aiEnabled: true });
    await addMessage(db, base, { text: 'Chào shop', sentAt: T(5) });
    await addMessage(db, base, { text: 'anh gọi 0912 345 678', sentAt: T(5) });
    await addMessage(db, base, { text: 'cuối tuần anh ghé', sentAt: T(6) });
    const q = createExtractQueue(boss);
    for (let i = 0; i < 3; i++) await q.enqueue(base.conversationId, 1);
    await start();
    await waitFor(async () => (await db.select().from(extractionRuns)).length === 1);
    await new Promise((r) => setTimeout(r, 2500)); // chờ xem có lần chạy thứ hai không
    expect(attempts).toBe(1);
    expect(await db.select().from(extractionRuns)).toHaveLength(1);
    expect((await db.select().from(proposals)).map((p) => p.field)).toEqual(['phone']);
  });

  it('lỗi tạm thời: retry rồi thành công; ghi đúng một run', async () => {
    let n = 0;
    behavior = () => {
      n += 1;
      if (n === 1) throw new Error('429 giới hạn tốc độ');
      return okEmpty();
    };
    const base = await seedBase(db, { aiEnabled: true });
    await addMessage(db, base, { text: 'Chào shop', sentAt: T(5) });
    await createExtractQueue(boss).enqueue(base.conversationId, 0);
    await start();
    await waitFor(async () => (await db.select().from(extractionRuns)).length === 1);
    expect(attempts).toBe(2);
    expect(await db.select().from(extractionRuns)).toHaveLength(1);
  });

  it('lỗi kéo dài: vào dead-letter, không ghi run; redrive đưa về hàng đợi gốc', async () => {
    behavior = () => {
      throw new Error('503 hỏng kéo dài');
    };
    const base = await seedBase(db, { aiEnabled: true });
    await addMessage(db, base, { text: 'Chào shop', sentAt: T(5) });
    await createExtractQueue(boss).enqueue(base.conversationId, 0);
    await start();
    const dead = await waitFor(async () => {
      const jobs = await handle.pool.query(`SELECT data FROM pgboss.job WHERE name = $1`, [EXTRACT_DEAD_QUEUE]);
      return jobs.rows.length > 0 ? jobs.rows : false;
    });
    expect(dead[0]!.data).toEqual({ conversationId: base.conversationId });
    expect(await db.select().from(extractionRuns)).toHaveLength(0);

    const r = await redriveDeadLetter(boss, 'extraction', { dryRun: true });
    expect(r.jobs).toBe(1);
  });
});

describe('sweeper', () => {
  it('tìm hội thoại có tin khách mới chưa được trích, bỏ qua tenant tắt AI, tin trước lúc bật, và hội thoại đã trích', async () => {
    const stale = await seedBase(db, { aiEnabled: true });
    await addMessage(db, stale, { text: 'tin chưa trích', sentAt: T(5) });

    const off = await seedBase(db, { aiEnabled: false });
    await addMessage(db, off, { text: 'tenant tắt AI', sentAt: T(5) });

    const done = await seedBase(db, { aiEnabled: true });
    await addMessage(db, done, { text: 'đã trích rồi', sentAt: T(5) });
    await runExtraction({ db, extractor: new OfflineExtractor(), log, contextMessages: 30 }, done.conversationId);

    const onlyPage = await seedBase(db, { aiEnabled: true });
    await addMessage(db, onlyPage, { text: 'chỉ có tin của Page', direction: 'outbound', sentAt: T(5) });

    expect(await findStaleConversations(db)).toEqual([stale.conversationId]);

    // Có tin mới sau lần trích: hội thoại đã trích thành "stale" trở lại.
    await addMessage(db, done, { text: 'thêm tin mới', sentAt: T(9) });
    expect((await findStaleConversations(db)).sort()).toEqual([stale.conversationId, done.conversationId].sort());
  });

  it('sweepOnce xếp việc bù khi enqueue từ webhook bị lỡ', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    await addMessage(db, base, { text: 'bị lỡ', sentAt: T(5) });
    expect(await sweepOnce({ db, queue: createExtractQueue(boss), log, delaySeconds: 60 })).toBe(1);
    expect(await queued(EXTRACT_QUEUE)).toBe(1);
    // Lượt sau không xếp trùng.
    expect(await sweepOnce({ db, queue: createExtractQueue(boss), log, delaySeconds: 60 })).toBe(0);
  });
});

describe('nối với webhook (afterStore)', () => {
  async function setup() {
    const base = await seedBase(db, { aiEnabled: true, fbPageId: 'PAGE_X', psid: 'PSID_X' });
    const seen: string[][] = [];
    const opts = {
      afterStore: async (ids: string[]) => {
        seen.push(ids);
      },
    };
    return { base, seen, opts };
  }

  it('tin khách mới có chữ gọi afterStore với đúng hội thoại', async () => {
    const { base, seen, opts } = await setup();
    const payload = webhookPayload([messageEvent({ mid: 'm1', text: 'Chào shop', psid: 'PSID_X', pageId: 'PAGE_X' })], 'PAGE_X');
    await processWebhookPayload(db, payload, log, opts);
    expect(seen).toEqual([[base.conversationId]]);
  });

  it('tin của Page và tin trùng KHÔNG kích hoạt; ảnh của khách có kích hoạt (để đọc bill)', async () => {
    const { seen, opts } = await setup();
    const echo = webhookPayload([messageEvent({ mid: 'e1', text: 'Dạ em chào anh', isEcho: true, appId: '263902037430900', psid: 'PSID_X', pageId: 'PAGE_X' })], 'PAGE_X');
    const photo = webhookPayload([messageEvent({ mid: 'p1', psid: 'PSID_X', pageId: 'PAGE_X', attachments: [{ type: 'image', payload: { url: 'https://x/y.png' } }] })], 'PAGE_X');
    await processWebhookPayload(db, echo, log, opts);
    expect(seen).toEqual([]);
    await processWebhookPayload(db, photo, log, opts);
    expect(seen).toHaveLength(1); // ảnh của khách xếp việc: worker đọc bill rồi (nếu có chữ) trích xuất
    await processWebhookPayload(db, photo, log, opts); // Meta gửi lại cùng ảnh: không xếp lại
    expect(seen).toHaveLength(1);

    const text = webhookPayload([messageEvent({ mid: 'm2', text: 'Chào', psid: 'PSID_X', pageId: 'PAGE_X' })], 'PAGE_X');
    await processWebhookPayload(db, text, log, opts);
    await processWebhookPayload(db, text, log, opts); // Meta gửi lại cùng tin
    expect(seen).toHaveLength(2);
  });

  it('afterStore ném lỗi thì webhook VẪN thành công và tin vẫn được lưu', async () => {
    const { base } = await setup();
    const warnings: object[] = [];
    const payload = webhookPayload([messageEvent({ mid: 'm3', text: 'Chào shop', psid: 'PSID_X', pageId: 'PAGE_X' })], 'PAGE_X');
    const stats = await processWebhookPayload(db, payload, { info: () => {}, warn: (o) => warnings.push(o) }, {
      afterStore: async () => {
        throw new Error('hàng đợi hỏng');
      },
    });
    expect(stats.stored).toBe(1);
    expect(warnings.length).toBeGreaterThan(0);
    // Sweeper bù được việc bị lỡ.
    expect(await findStaleConversations(db)).toEqual([base.conversationId]);
    // Cảnh báo không chứa nội dung tin.
    expect(JSON.stringify(warnings)).not.toContain('Chào shop');
  });

  it('không truyền afterStore thì hành vi như cũ', async () => {
    await setup();
    const payload = webhookPayload([messageEvent({ mid: 'm4', text: 'Chào', psid: 'PSID_X', pageId: 'PAGE_X' })], 'PAGE_X');
    expect((await processWebhookPayload(db, payload, log)).stored).toBe(1);
  });
});

describe('proposals và run liên kết đúng', () => {
  it('xóa sạch giữa các test (kiểm tra truncate bao cả bảng mới)', async () => {
    expect(await db.select().from(proposals)).toHaveLength(0);
    expect(await db.select().from(extractionRuns).where(eq(extractionRuns.status, 'failed'))).toHaveLength(0);
  });
});
