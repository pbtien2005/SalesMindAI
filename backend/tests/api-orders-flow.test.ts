import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import { OfflineBillReader } from '../src/bills/offline-bill-reader.js';
import { readPendingBills } from '../src/bills/read.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { DEMO_PAGE_INBOX_APP_ID, resetDemo } from '../src/demo/seed.js';
import { OfflineExtractor } from '../src/extraction/offline-extractor.js';
import { runExtraction } from '../src/extraction/run.js';
import { processWebhookPayload } from '../src/workers/process-webhook.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));
const SECRET = 'demo-secret';
const OWN_APP = 'own-app';
const log = { info: () => {}, warn: () => {} };
const assetDir = fileURLToPath(new URL('../demo-assets', import.meta.url));
const H = { 'x-requested-with': 'salesmind', 'content-type': 'application/json' };
const SCENE4 = 'Anh xem ảnh thấy ổn rồi, lấy 1 bộ Sofa Milan xám mã SF-021, giá 12 triệu như em báo nhé. Chốt luôn.';

/** Hàng đợi giả xử lý ngay: lưu tin, trích xuất và đọc bill (giống worker thật nhưng không debounce). */
function makeApp() {
  return buildApp(
    {},
    {
      appSecret: SECRET,
      verifyToken: 'v',
      queue: {
        enqueue: async (d) => {
          await processWebhookPayload(db, d.payload, log, {
            sender: { ownAppId: OWN_APP, pageInboxAppIds: [DEMO_PAGE_INBOX_APP_ID] },
            afterStore: async (ids) => {
              for (const id of ids) {
                await readPendingBills({ db, reader: new OfflineBillReader(), assetDir, demoMode: true, log }, id, new Date());
                await runExtraction({ db, extractor: new OfflineExtractor(), log, contextMessages: 30 }, id);
              }
            },
          });
        },
      },
      api: { db, crypto, log, demoMode: true, ownAppId: OWN_APP },
      auth: { db, mailer: new MemoryMailer(), signupOpen: false, demoMode: true, publicBaseUrl: 'http://localhost:3000', rateLimit: { max: 10_000, timeWindowMs: 60_000 } },
    },
  );
}

let app: ReturnType<typeof makeApp>;
let cookie = '';
beforeEach(async () => {
  await truncateAll(handle);
  app = makeApp();
  await resetDemo({ db, crypto, log });
  const res = await app.inject({ method: 'POST', url: '/api/auth/demo-login', headers: H, payload: { as: 'lan' } });
  cookie = String(([] as string[]).concat(res.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
});
afterAll(async () => {
  await handle.close();
});

async function call(method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { ...H, cookie }, ...(method === 'POST' ? { payload: (body ?? {}) as object } : {}) });
  return { status: res.statusCode, json: res.json() as any };
}
const detailOf = async (id: string) => (await call('GET', `/api/conversations/${id}`)).json;

/** Cảnh 4: khách chốt đơn; trả về id hội thoại. */
async function chotDon() {
  await call('POST', '/api/clock/advance', { to: '2026-11-13T09:30:00+07:00' });
  const r = await call('POST', '/api/demo/customer-message', { persona: 'minh', text: SCENE4 });
  expect(r.status).toBe(202);
  return r.json.conversationId as string;
}

describe('cảnh 4–5 qua API: đơn nháp, gửi, bill, xác nhận cọc, tạo đơn', () => {
  it('chạy trọn bill 6 triệu', async () => {
    const conv = await chotDon();

    // Cảnh 4: đơn nháp và tin nháp, tín hiệu chốt đơn có câu gốc.
    let d = await detailOf(conv);
    expect(d.summary.closeSignal.text.toLowerCase()).toBe('chốt luôn');
    expect(d.order).toMatchObject({ status: 'draft', sku: 'SF-021', quantity: 1, totalVnd: 12_000_000, depositRequiredVnd: 6_000_000, address: null, code: null });
    expect(d.replyDrafts).toHaveLength(1);
    expect(d.replyDrafts[0].text).toContain('6.000.000 ₫');
    // Mã hàng và đơn giá KHÔNG hiện trên thẻ khách hay Hộp đề xuất.
    expect(JSON.stringify([d.autoFill, d.box])).not.toContain('SF-021');

    // Sale sửa nháp rồi bấm Gửi (demo: ghi giả lập, đi qua webhook có ký).
    expect((await call('POST', `/api/orders/${d.order.id}/update`, { address: '12 Lê Lợi, Quận 1' })).status).toBe(200);
    const sent = await call('POST', `/api/reply-drafts/${d.replyDrafts[0].id}/send`, { text: 'Dạ em xác nhận đơn Sofa Milan, anh cọc 6.000.000 ₫ giúp em nhé' });
    expect(sent.status).toBe(200);
    expect(sent.json).toMatchObject({ orderStatus: 'awaiting_deposit' });
    expect((await call('POST', `/api/reply-drafts/${d.replyDrafts[0].id}/send`, {})).status).toBe(409);
    d = await detailOf(conv);
    expect(d.order.status).toBe('awaiting_deposit');
    expect(d.replyDrafts).toHaveLength(0);
    const last = d.messages.at(-1);
    expect(last).toMatchObject({ direction: 'outbound', senderKind: 'page_app', text: 'Dạ em xác nhận đơn Sofa Milan, anh cọc 6.000.000 ₫ giúp em nhé' });
    expect(d.tasks.some((t: any) => t.title === 'Nhắc khách cọc')).toBe(true);

    // Cảnh 5: khách gửi ảnh bill 6 triệu; AI đọc, Sale xác nhận.
    await call('POST', '/api/clock/advance', { to: '2026-11-13T10:09:00+07:00' });
    expect((await call('POST', '/api/demo/customer-image', { conversationId: conv, file: 'bill-6000000.png' })).status).toBe(202);
    d = await detailOf(conv);
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0]).toMatchObject({ status: 'proposed', readOk: true, amountVnd: 6_000_000, verdict: 'ok', ratioPercent: 50, simulatedReader: true });
    expect(d.messages.some((m: any) => m.attachments?.[0]?.url === '/api/demo/assets/bill-6000000.png')).toBe(true);
    const img = await app.inject({ method: 'GET', url: '/api/demo/assets/bill-6000000.png', headers: { cookie } });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');

    const conf = await call('POST', `/api/payments/${d.payments[0].id}/confirm`, {});
    expect(conf.json).toMatchObject({ depositPaidVnd: 6_000_000, depositReached: true });
    expect((await call('POST', `/api/payments/${d.payments[0].id}/confirm`, {})).status).toBe(409);
    d = await detailOf(conv);
    expect(d.replyDrafts[0]).toMatchObject({ kind: 'deposit_received' });

    // Tạo đơn: địa chỉ bắt buộc.
    expect((await call('POST', `/api/orders/${d.order.id}/confirm`, { address: 'abc' })).json.error.code).toBe('address_required');
    const created = await call('POST', `/api/orders/${d.order.id}/confirm`, { address: '12 Lê Lợi, Quận 1, TP.HCM' });
    expect(created.json).toMatchObject({ ok: true, code: 'DH-0001' });

    // Cảnh 6: Trang chủ và màn Đơn hàng.
    const home = (await call('GET', '/api/home')).json;
    expect(home.depositToday).toBe(6_000_000);
    const orders = (await call('GET', '/api/orders')).json.orders;
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ code: 'DH-0001', status: 'confirmed', totalVnd: 12_000_000, depositPaidVnd: 6_000_000, remainingVnd: 6_000_000 });
  });

  it('biến thể bill 3 triệu: dưới ngưỡng, bỏ qua thì có tin nháp nhắc chuyển nốt và không cộng tiền', async () => {
    const conv = await chotDon();
    let d = await detailOf(conv);
    await call('POST', `/api/reply-drafts/${d.replyDrafts[0].id}/send`, {});
    await call('POST', '/api/demo/customer-image', { conversationId: conv, file: 'bill-3000000.png' });
    d = await detailOf(conv);
    expect(d.payments[0]).toMatchObject({ amountVnd: 3_000_000, verdict: 'below', ratioPercent: 25, thresholdPercent: 50 });
    expect((await call('POST', `/api/payments/${d.payments[0].id}/reject`, {})).json).toMatchObject({ topUpDraft: true });
    d = await detailOf(conv);
    expect(d.order.depositPaidVnd).toBe(0);
    expect(d.replyDrafts[0]).toMatchObject({ kind: 'top_up' });
    expect((await call('GET', '/api/home')).json.depositToday).toBe(0);
  });

  it('ảnh sofa (không phải bill): không đọc được, không có phần trăm, phải nhập tay mới xác nhận được', async () => {
    const conv = await chotDon();
    let d = await detailOf(conv);
    await call('POST', `/api/reply-drafts/${d.replyDrafts[0].id}/send`, {});
    await call('POST', '/api/demo/customer-image', { conversationId: conv, file: 'sofa.png' });
    d = await detailOf(conv);
    expect(d.payments[0]).toMatchObject({ readOk: false, amountVnd: null, verdict: null, ratioPercent: null });
    expect((await call('POST', `/api/payments/${d.payments[0].id}/confirm`, {})).json.error.code).toBe('invalid');
  });

  it('ảnh demo chỉ có khi DEMO_MODE, tên ngoài danh sách thì 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/demo/assets/..%2F.env', headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/demo/assets/khac.png', headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/demo/assets/sofa.png' })).statusCode).toBe(401);
  });
});
