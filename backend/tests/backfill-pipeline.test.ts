import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  handleBackfillConversation,
  handleBackfillPage,
  type BackfillDeps,
  type BackfillState,
} from '../src/backfill/backfill.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { messages, pages, tenants } from '../src/db/schema.js';
import { GraphClient } from '../src/meta/graph-client.js';
import {
  BACKFILL_CONVERSATION_QUEUE,
  BACKFILL_DEAD_QUEUE,
  BACKFILL_PAGE_QUEUE,
  createBackfillQueue,
  createBoss,
  startBackfillWorkers,
} from '../src/queue/boss.js';
import { API_VERSION, FB_APP_ID, FB_APP_SECRET, makeFakeFetch, metaError, type MetaHandler } from './helpers/fake-meta.js';
import { getTestDatabaseUrl, openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));

const FB_PAGE = 'BF_PAGE';
const TOKEN = 'PAGE_TOKEN_SECRET';

let boss: PgBoss;
let deps: BackfillDeps;
let finished = 0; // số job (mọi loại) đã chạy xong, kể cả lỗi
let meta: ReturnType<typeof makeFakeFetch>;

async function waitFor<T>(fn: () => Promise<T | false | undefined | null>, timeoutMs = 30_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor: quá thời gian');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const count = async () => (await db.select().from(messages)).length;
const detailCalls = (id: string) => meta.calls.filter((c) => c.path === id).length;

/** Meta giả dạng thật: 3 hội thoại ở 2 trang, mỗi hội thoại có 1 tin của khách và 1 tin của Page. */
const baseMeta: MetaHandler = (req) => {
  if (req.path === `${FB_PAGE}/conversations`) {
    return req.params.get('after') === 'CUR1'
      ? { body: { data: [{ id: 't_3', updated_time: '2026-11-09T07:00:00+0000' }] } }
      : {
          body: {
            data: [
              { id: 't_1', updated_time: '2026-11-09T07:02:00+0000' },
              { id: 't_2', updated_time: '2026-11-09T07:01:00+0000' },
            ],
            paging: { cursors: { before: 'B', after: 'CUR1' }, next: 'https://graph.facebook.com/next' },
          },
        };
  }
  const conv = /^t_(\d)$/.exec(req.path);
  if (conv) {
    const n = conv[1];
    return {
      body: {
        id: req.path,
        messages: {
          data: [
            { id: `m_${n}_c`, created_time: `2026-11-09T07:0${n}:30+0000` },
            { id: `m_${n}_p`, created_time: `2026-11-09T07:0${n}:10+0000` },
          ],
        },
      },
    };
  }
  const msg = /^m_(\d)_(c|p)$/.exec(req.path);
  if (msg) {
    const [, n, who] = msg;
    return {
      body: {
        id: req.path,
        created_time: who === 'c' ? `2026-11-09T07:0${n}:30+0000` : `2026-11-09T07:0${n}:10+0000`,
        from: who === 'c' ? { id: `PSID_${n}`, name: 'Khách hàng', email: 'khach@example.com' } : { id: FB_PAGE, name: 'Page' },
        message: who === 'c' ? `Khách ${n} cần báo giá` : `Page trả lời khách ${n}`,
      },
    };
  }
  return metaError(100, `không hỗ trợ ${req.path}`, 404);
};

function useMeta(handler: MetaHandler) {
  meta = makeFakeFetch(handler);
  const graph = new GraphClient({ apiVersion: API_VERSION, appId: FB_APP_ID, appSecret: FB_APP_SECRET, fetch: meta.fetch });
  deps = {
    db,
    graph,
    crypto,
    queue: createBackfillQueue(boss),
    log: { info: () => {}, warn: () => {} },
    pacingMs: 0,
    sleep: async () => {},
  };
}

beforeAll(async () => {
  // Retry nhanh để test không phải chờ lâu: tối đa 3 lần chạy, cách nhau 1 giây.
  boss = await createBoss(getTestDatabaseUrl(), {
    backfillQueueOverrides: { retryLimit: 2, retryDelay: 1, retryBackoff: false },
  });
  await startBackfillWorkers(
    boss,
    {
      page: async (job) => {
        try {
          await handleBackfillPage(deps, job);
        } finally {
          finished += 1;
        }
      },
      conversation: async (job) => {
        try {
          await handleBackfillConversation(deps, job);
        } finally {
          finished += 1;
        }
      },
    },
    { pollingIntervalSeconds: 0.5 },
  );
});

afterAll(async () => {
  await boss.stop({ graceful: true, timeout: 10_000 });
  await handle.close();
});

let pageId: string;

beforeEach(async () => {
  await truncateAll(handle);
  for (const q of [BACKFILL_PAGE_QUEUE, BACKFILL_CONVERSATION_QUEUE, BACKFILL_DEAD_QUEUE]) await boss.deleteAllJobs(q);
  finished = 0;
  const [tenant] = await db.insert(tenants).values({ name: 'Công ty A' }).returning();
  const [page] = await db
    .insert(pages)
    .values({ tenantId: tenant!.id, fbPageId: FB_PAGE, name: 'Page BF', tokenEnc: crypto.encrypt(TOKEN, FB_PAGE) })
    .returning();
  pageId = page!.id;
  useMeta(baseMeta);
});

const state = async () => (await db.select().from(pages).where(eq(pages.id, pageId)))[0]!;

describe('backfill chạy thật: hàng đợi → worker → Graph giả → DB', () => {
  it('liệt kê hai trang hội thoại, lấy chi tiết, lưu tin của khách và bỏ tin của Page', async () => {
    await deps.queue.enqueuePage({ pageId });
    await waitFor(async () => (await count()) === 3);
    // đợi tới khi mọi job (2 job liệt kê trang + 3 job hội thoại) xong
    await waitFor(async () => finished >= 5);

    const rows = await db.select().from(messages);
    expect(rows.map((r) => r.mid).sort()).toEqual(['m_1_c', 'm_2_c', 'm_3_c']);
    for (const r of rows) {
      expect(r.source).toBe('backfill');
      expect(r.text).toMatch(/^Khách \d cần báo giá$/);
    }
    expect(rows.find((r) => r.mid === 'm_1_c')!.sentAt.toISOString()).toBe('2026-11-09T07:01:30.000Z');

    const p = await state();
    expect(p.backfillState as BackfillState).toMatchObject({ status: 'listed', conversationsEnqueued: 3 });
    expect(p.status).toBe('active');
    // Page token đã giải mã và gửi kèm appsecret_proof cho mọi lời gọi
    expect(meta.calls.every((c) => c.params.get('access_token') === TOKEN && c.params.get('appsecret_proof'))).toBe(true);
    // dữ liệu cá nhân thừa (tên, email) không bị lưu
    expect(JSON.stringify(rows)).not.toContain('example.com');
    expect(await boss.fetch(BACKFILL_DEAD_QUEUE)).toHaveLength(0);
  });

  it('chạy lại: không tạo trùng và không gọi lại chi tiết các tin của khách đã lưu', async () => {
    await deps.queue.enqueuePage({ pageId });
    await waitFor(async () => finished >= 5);
    expect(await count()).toBe(3);
    const before = ['m_1_c', 'm_2_c', 'm_3_c'].map(detailCalls);

    await deps.queue.enqueuePage({ pageId });
    await waitFor(async () => finished >= 10);
    expect(await count()).toBe(3);
    expect(['m_1_c', 'm_2_c', 'm_3_c'].map(detailCalls)).toEqual(before); // không gọi thêm
  });

  it('bị giới hạn tốc độ một lần: job tự retry rồi lưu đủ, không vào dead-letter', async () => {
    let limited = false;
    useMeta((req) => {
      if (req.path === 'm_2_c' && !limited) {
        limited = true;
        return metaError(4, 'Application request limit reached', 400);
      }
      return baseMeta(req);
    });
    await deps.queue.enqueuePage({ pageId });
    await waitFor(async () => (await count()) === 3, 40_000);
    expect(limited).toBe(true);
    expect(detailCalls('m_2_c')).toBeGreaterThanOrEqual(2); // lần đầu bị chặn, lần retry thành công
    expect(await boss.fetch(BACKFILL_DEAD_QUEUE)).toHaveLength(0);
  });

  it('token hết hiệu lực (190) khi liệt kê: đánh dấu Page, KHÔNG retry, không lưu gì', async () => {
    let listCalls = 0;
    useMeta((req) => {
      if (req.path === `${FB_PAGE}/conversations`) {
        listCalls += 1;
        return metaError(190, 'Error validating access token');
      }
      return baseMeta(req);
    });
    await deps.queue.enqueuePage({ pageId });
    await waitFor(async () => finished >= 1);
    await new Promise((r) => setTimeout(r, 2500)); // đủ cho một lần retry nếu có
    expect(listCalls).toBe(1);
    expect(finished).toBe(1);
    const p = await state();
    expect(p.status).toBe('token_invalid');
    expect(p.backfillState as BackfillState).toMatchObject({ status: 'failed', reason: 'token_invalid' });
    expect(await count()).toBe(0);
    expect(await boss.fetch(BACKFILL_DEAD_QUEUE)).toHaveLength(0);
  });

  it('khử trùng job: cùng hội thoại hoặc cùng Page đang chờ thì không nhân đôi (chạy backfill hai lần, job liệt kê retry)', async () => {
    // startAfter đẩy job ra xa để chúng nằm yên trong hàng đợi, không bị worker lấy mất trong lúc test
    const send = (queue: string, data: object, key: string) => boss.send(queue, data, { singletonKey: key, startAfter: 3600 });
    const job = { pageId, conversationId: 't_dup' };
    expect(await send(BACKFILL_CONVERSATION_QUEUE, job, pageId + ':t_dup')).not.toBeNull();
    expect(await send(BACKFILL_CONVERSATION_QUEUE, job, pageId + ':t_dup')).toBeNull(); // trùng: bị bỏ
    expect(await send(BACKFILL_CONVERSATION_QUEUE, { pageId, conversationId: 't_other' }, pageId + ':t_other')).not.toBeNull(); // khác hội thoại: nhận
    expect(await send(BACKFILL_PAGE_QUEUE, { pageId }, pageId)).not.toBeNull();
    expect(await send(BACKFILL_PAGE_QUEUE, { pageId }, pageId)).toBeNull();
    expect((await boss.getQueue(BACKFILL_CONVERSATION_QUEUE))!.policy).toBe('short');
  });

  it('createBackfillQueue không ném lỗi khi job bị bỏ vì trùng (đó là khử trùng đúng ý)', async () => {
    await boss.send(BACKFILL_CONVERSATION_QUEUE, { pageId, conversationId: 't_x' }, { singletonKey: pageId + ':t_x', startAfter: 3600 });
    await expect(deps.queue.enqueueConversation({ pageId, conversationId: 't_x' })).resolves.toBe(false); // bị bỏ vì trùng
    await expect(deps.queue.enqueueConversation({ pageId, conversationId: 't_y' })).resolves.toBe(true); // khác khóa: xếp hàng
  });

  it('lỗi kéo dài: hết retry thì vào dead-letter thay vì mất dấu', async () => {
    useMeta((req) => (req.path === `${FB_PAGE}/conversations` ? metaError(1, 'Lỗi tạm thời của Meta', 500, 'GraphMethodException') : baseMeta(req)));
    await deps.queue.enqueuePage({ pageId });
    const dead = await waitFor(async () => {
      const jobs = await boss.fetch(BACKFILL_DEAD_QUEUE);
      return jobs.length > 0 ? jobs : false;
    }, 40_000);
    expect(dead[0]!.data).toEqual({ pageId });
    expect(finished).toBe(3); // 1 lần đầu + 2 lần retry
  });
});
