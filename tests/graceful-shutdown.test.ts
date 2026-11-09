import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { messages, pages, tenants } from '../src/db/schema.js';
import { createBoss, createWebhookQueue, startWebhookWorker, WEBHOOK_QUEUE } from '../src/queue/boss.js';
import { processWebhookPayload } from '../src/workers/process-webhook.js';
import { getTestDatabaseUrl, openTestDb, truncateAll } from './helpers/test-db.js';
import { APP_SECRET, messageEvent, PAGE_ID, sign, VERIFY_TOKEN, webhookPayload } from './helpers/webhook.js';

const handle = openTestDb();
const { db } = handle;

beforeAll(() => truncateAll(handle));
afterAll(() => handle.close());

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 20_000) {
  const t0 = Date.now();
  while (!(await fn())) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor: quá thời gian');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('tắt nhẹ nhàng (đúng thứ tự như server.ts: app.close, rồi boss.stop graceful)', () => {
  it('job đang chạy dở được hoàn tất và tin được lưu trước khi dừng; không còn job dở dang', async () => {
    const [tenant] = await db.insert(tenants).values({ name: 'A' }).returning();
    await db.insert(pages).values({ tenantId: tenant!.id, fbPageId: PAGE_ID, name: 'P', tokenEnc: 'enc' });

    const boss = await createBoss(getTestDatabaseUrl());
    // Hàng đợi dùng chung giữa các file test: dọn job còn sót để phép đếm ở cuối chỉ tính job của test này.
    await boss.deleteAllJobs(WEBHOOK_QUEUE);
    let started = false;
    let finishedJobs = 0;
    await startWebhookWorker(
      boss,
      async (data) => {
        started = true;
        await new Promise((r) => setTimeout(r, 1500)); // việc chậm đang chạy dở lúc nhận tín hiệu tắt
        await processWebhookPayload(db, data.payload, { info: () => {}, warn: () => {} });
        finishedJobs += 1;
      },
      { pollingIntervalSeconds: 0.5 },
    );

    const app = buildApp({}, { appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, queue: createWebhookQueue(boss) });
    const raw = JSON.stringify(webhookPayload([messageEvent({ mid: 'graceful-1', text: 'tin đang xử lý dở' })]));
    const res = await app.inject({ method: 'POST', url: '/webhook', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) }, payload: raw });
    expect(res.statusCode).toBe(200);

    await waitFor(async () => started); // chắc chắn job đã được lấy và đang chạy
    expect(finishedJobs).toBe(0);

    // Nhận tín hiệu tắt giữa lúc job đang chạy: đóng nhận request, rồi chờ job xong (như server.ts)
    await app.close();
    await boss.stop({ graceful: true, timeout: 15_000 });

    expect(finishedJobs).toBe(1); // handler đã chạy tới cuối, không bị cắt ngang
    expect((await db.select().from(messages)).map((m) => m.mid)).toEqual(['graceful-1']);
    const states = await handle.pool.query("select state, count(*)::int as n from pgboss.job where name = $1 group by state", [WEBHOOK_QUEUE]);
    expect(Object.fromEntries(states.rows.map((r) => [r.state, r.n]))).toEqual({ completed: 1 }); // không còn active/created dở dang
  });
});
