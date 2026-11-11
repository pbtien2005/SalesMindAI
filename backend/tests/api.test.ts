import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { DEMO_PAGE_INBOX_APP_ID, resetDemo, vn } from '../src/demo/seed.js';
import { OfflineExtractor } from '../src/extraction/offline-extractor.js';
import { runExtraction } from '../src/extraction/run.js';
import { processWebhookPayload } from '../src/workers/process-webhook.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));
const SECRET = 'demo-secret';
const log = { info: () => {}, warn: () => {} };
const extractor = new OfflineExtractor();

/** Hàng đợi giả xử lý NGAY (đồng bộ): lưu tin rồi trích xuất, giống webhook → worker → AI nhưng không có debounce. */
function makeApp(withApi = true) {
  return buildApp(
    {},
    {
      appSecret: SECRET,
      verifyToken: 'v',
      queue: {
        enqueue: async (d) => {
          await processWebhookPayload(db, d.payload, log, {
            sender: { ownAppId: 'own', pageInboxAppIds: [DEMO_PAGE_INBOX_APP_ID] },
            afterStore: async (ids) => {
              for (const id of ids) await runExtraction({ db, extractor, log, contextMessages: 30 }, id);
            },
          });
        },
      },
      api: { db, crypto, log, demoMode: withApi },
      auth: { db, mailer: new MemoryMailer(), signupOpen: false, demoMode: withApi, publicBaseUrl: 'http://localhost:3000', rateLimit: { max: 10_000, timeWindowMs: 60_000 } },
    },
  );
}

let app: ReturnType<typeof makeApp>;
const cookies: Record<'lan' | 'ha', string> = { lan: '', ha: '' };
const H = { 'x-requested-with': 'salesmind', 'content-type': 'application/json' };
beforeAll(async () => {
  await truncateAll(handle);
});
beforeEach(async () => {
  await truncateAll(handle);
  app = makeApp();
  await resetDemo({ db, crypto, log });
  for (const who of ['lan', 'ha'] as const) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/demo-login', headers: H, payload: { as: who } });
    cookies[who] = String(([] as string[]).concat(res.headers['set-cookie'] as string | string[])[0]).split(';')[0]!;
  }
});
afterAll(async () => {
  await handle.close();
});

async function call<T = any>(method: 'GET' | 'POST', url: string, body?: unknown, role?: 'lan' | 'ha'): Promise<{ status: number; json: T }> {
  const res = await app.inject({ method, url, ...(body !== undefined ? { payload: body as object } : method === 'POST' ? { payload: {} } : {}), headers: { ...H, cookie: cookies[role ?? 'lan'] } });
  return { status: res.statusCode, json: res.json() as T };
}
const inbox = async () => (await call('GET', '/api/inbox')).json.conversations as any[];
const byName = (list: any[], name: string) => list.find((c) => c.displayName === name);
const advanceTo = (iso: string) => call('POST', '/api/clock/advance', { to: iso });

describe('kịch bản demo cảnh 0–3 và 6, chỉ qua API', () => {
  it('chạy trọn kịch bản', async () => {
    // ----- Cảnh 0: buổi sáng của Lan, 09:00 Thứ Năm.
    const now0 = (await call('GET', '/api/now')).json;
    expect(now0.roleName).toBe('Lan');
    expect(new Date(now0.now).getTime()).toBeGreaterThanOrEqual(vn(2026, 11, 12, 9, 0).getTime());
    expect(new Date(now0.now).getTime()).toBeLessThan(vn(2026, 11, 12, 9, 1).getTime());
    const home0 = (await call('GET', '/api/home')).json;
    expect(home0.p1.map((c: any) => c.displayName)).toEqual(['Chị Thu']);
    expect(home0.overdue).toHaveLength(2);
    expect(home0.ai).toEqual({ autoFilled: 0, saleEdited: 0, askedDate: 0, approved: 0 });

    // ----- Cảnh 1: khách hỏi lần đầu (09:05).
    await call('POST', '/api/clock/advance', { minutes: 5 });
    const m1 = 'Chào shop, anh đang tìm sofa phòng khách tầm 15 triệu';
    const m2 = 'Có mẫu nào màu xám không em?';
    const sent1 = await call('POST', '/api/demo/customer-message', { persona: 'minh', text: m1 });
    expect(sent1.status).toBe(202);
    await call('POST', '/api/demo/customer-message', { persona: 'minh', text: m2 });
    const minhId = sent1.json.conversationId as string;

    let detail = (await call('GET', `/api/conversations/${minhId}`)).json;
    expect(detail.summary).toMatchObject({ displayName: 'Facebook: anh Minh', isNew: true, waitingOn: 'page' });
    expect(detail.box).toEqual([]); // cảnh 1: Hộp đề xuất vẫn trống
    const fields = Object.fromEntries(detail.autoFill.map((p: any) => [p.field, p]));
    expect(Object.keys(fields).sort()).toEqual(['budget', 'product_interest']);
    expect(fields.product_interest.value.text).toBe('sofa phòng khách, màu xám');
    expect(fields.budget.value.text).toContain('15.000.000');
    // Câu gốc trỏ đúng đoạn trong tin (để giao diện tô vàng).
    const texts = new Map<string, string>(detail.messages.map((m: any) => [m.id, m.text]));
    const bev = fields.budget.evidence[0];
    expect(texts.get(bev.messageId)!.slice(bev.start, bev.end)).toBe('tầm 15 triệu');
    expect(bev.text).toBe('tầm 15 triệu');
    expect(fields.product_interest.evidence.map((e: any) => texts.get(e.messageId)!.slice(e.start, e.end))).toEqual(['sofa phòng khách', 'màu xám']);

    // Lan trả lời ở Page Inbox.
    await call('POST', '/api/demo/page-message', { conversationId: minhId, text: 'Dạ em chào anh ạ. Em gửi anh mẫu Sofa Milan xám (SF-021) giá 12 triệu ạ. Anh cho em xin SĐT nhé.' });
    detail = (await call('GET', `/api/conversations/${minhId}`)).json;
    expect(detail.summary).toMatchObject({ waitingOn: 'customer', isNew: false });
    expect(detail.messages.at(-1)).toMatchObject({ direction: 'outbound', senderKind: 'page_inbox' });

    // ----- Cảnh 2: một ngày sau (Thứ Sáu 09:30).
    expect((await advanceTo('2026-11-13T09:30:00+07:00')).status).toBe(200);
    let list = await inbox();
    // Lan mới TRẢ LỜI (chưa bám lần nào), nhưng đã quá 24 giờ kể từ tin đó: đến hạn bám lần 1.
    expect(byName(list, 'Facebook: anh Minh').followup).toMatchObject({ count: 0, max: 5, stopped: false, suggestStop: false, due: true });
    const mai = byName(list, 'Cô Mai');
    expect(mai.followup).toMatchObject({ count: 5, suggestStop: true });
    const homeFri = (await call('GET', '/api/home')).json;
    expect(homeFri.reminders.map((r: any) => `${r.kind}:${r.displayName}:${r.title}`)).toContain('followup:Facebook: anh Minh:Đến hạn bám lần 1/5');
    expect(homeFri.suggestStop.map((c: any) => c.displayName)).toEqual(['Cô Mai']);

    // Hộp đề xuất của cô Mai có mục "Ngừng bám"; Lan xác nhận.
    const maiDetail = (await call('GET', `/api/conversations/${mai.id}`)).json;
    expect(maiDetail.box).toEqual([expect.objectContaining({ kind: 'stop_followup', count: 5 })]);
    expect((await call('POST', `/api/conversations/${mai.id}/stop-followup`)).json).toEqual({ stopped: true });
    expect((await call('POST', `/api/conversations/${mai.id}/stop-followup`)).status).toBe(409);
    list = await inbox();
    expect(byName(list, 'Cô Mai').followup).toMatchObject({ stopped: true, suggestStop: false });

    // Lan nhắn lại anh Minh (cách tin trước hơn 24 giờ): tính là 1 lần bám, hết đến hạn.
    await call('POST', '/api/demo/page-message', { conversationId: minhId, text: 'Anh Minh ơi, mẫu Sofa Milan xám em gửi hôm qua anh xem thế nào ạ?' });
    expect(byName(await inbox(), 'Facebook: anh Minh').followup).toMatchObject({ count: 1, due: false });

    // ----- Cảnh 3: khách quay lại, có SĐT, hẹn mơ hồ (09:40).
    await call('POST', '/api/clock/advance', { minutes: 10 });
    const m3 = 'Anh Minh đây, hôm qua bận quá. SĐT anh 0912 345 678. Cuối tuần này anh ghé shop xem được không?';
    await call('POST', '/api/demo/customer-message', { conversationId: minhId, text: m3 });
    detail = (await call('GET', `/api/conversations/${minhId}`)).json;
    expect(detail.summary.followup.count).toBe(0);
    expect(detail.autoFill.find((p: any) => p.field === 'customer_name').value.text).toBe('Minh');

    const box = Object.fromEntries(detail.box.map((b: any) => [b.field, b]));
    expect(Object.keys(box).sort()).toEqual(['phone', 'timeline']);
    expect(box.phone.value.text).toBe('0912345678');
    expect(box.phone.evidence[0].text).toBe('0912 345 678');
    // AI dừng lại ở mốc mơ hồ: cờ hỏi lại, KHÔNG có ngày.
    expect(box.timeline.flags).toEqual(['needs_clarification']);
    expect(box.timeline.value).toMatchObject({ text: 'Cuối tuần này', kind: 'relative' });
    // (`sentAt` = lúc khách GỬI tin, 13/11, có chủ ý để Sale biết cụm tương đối tính từ khi nào; không phải ngày đã giải.)
    expect(JSON.stringify(box.timeline)).not.toMatch(/2026-11-1[4-9]|14\/11|15\/11|Thứ Bảy|Chủ Nhật/);
    expect(box.timeline.value.sentAt).toMatch(/^2026-11-13T/);

    // Duyệt mốc hẹn khi chưa chọn ngày bị từ chối; chọn Thứ Bảy 14/11 10:00 thì được.
    const noDate = await call('POST', `/api/proposals/${box.timeline.id}/decide`, { action: 'accept' });
    expect(noDate.status).toBe(422);
    expect(noDate.json.error.code).toBe('needs_date');
    expect((await call('POST', `/api/proposals/${box.timeline.id}/decide`, { action: 'accept', chosenAt: '2026-11-14T10:00:00+07:00' })).json).toMatchObject({ status: 'accepted', field: 'timeline' });
    expect((await call('POST', `/api/proposals/${box.phone.id}/decide`, { action: 'accept' })).json).toMatchObject({ status: 'accepted', field: 'phone' });
    expect((await call('POST', `/api/proposals/${box.phone.id}/decide`, { action: 'accept' })).status).toBe(409); // đã duyệt

    detail = (await call('GET', `/api/conversations/${minhId}`)).json;
    expect(detail.box).toEqual([]);
    expect(detail.approved.map((a: any) => `${a.field}:${a.decidedBy}`).sort()).toEqual(['phone:Lan', 'timeline:Lan']);
    expect(detail.approved.find((a: any) => a.field === 'timeline').value.chosenAt).toBe('2026-11-14T03:00:00.000Z');
    expect(detail.tasks).toEqual([expect.objectContaining({ title: 'Khách hẹn ghé xem', dueAt: '2026-11-14T03:00:00.000Z' })]);

    // ----- Cảnh 6: chị Hà xem Trang chủ.
    const homeHa = (await call('GET', '/api/home', undefined, 'ha')).json;
    expect(homeHa.role).toBe('manager');
    expect(homeHa.p1.map((c: any) => c.displayName)).toEqual(['Chị Thu']);
    expect(homeHa.overdue.map((t: any) => t.displayName).sort()).toEqual(['Anh Đức', 'Chị Ngọc']);
    expect(homeHa.ai).toEqual({ autoFilled: 3, saleEdited: 0, askedDate: 1, approved: 3 });
    const upcoming = homeHa.reminders.find((r: any) => r.kind === 'upcoming');
    expect(upcoming).toMatchObject({ displayName: 'Facebook: anh Minh', title: 'Khách hẹn ghé xem', dueAt: '2026-11-14T03:00:00.000Z' });
    expect((await call('GET', '/api/overdue')).json.overdue).toHaveLength(2);

    // Lịch sử có căn cứ và người chịu trách nhiệm.
    const history = (await call('GET', `/api/conversations/${minhId}/history`)).json.history as any[];
    const phone = history.find((h) => h.field === 'phone');
    expect(phone).toMatchObject({ status: 'accepted', decidedBy: 'Lan', proposedValue: { text: '0912345678' } });
    expect(phone.evidence[0].text).toBe('0912 345 678');
    const tl = history.find((h) => h.field === 'timeline');
    expect(tl.decidedValue.chosenAt).toBe('2026-11-14T03:00:00.000Z');
    expect(history.every((h) => h.field !== 'message_purpose' && h.field !== 'intent')).toBe(true); // tín hiệu nội bộ không hiện
    const maiHistory = (await call('GET', `/api/conversations/${mai.id}/history`)).json.history as any[];
    expect(maiHistory).toEqual([expect.objectContaining({ kind: 'stop_followup', decidedBy: 'Lan' })]);
  });

  it('Sale sửa giá trị AI điền sai: nhãn "đã sửa" và số liệu "Sale sửa vì sai" tăng', async () => {
    await call('POST', '/api/clock/advance', { minutes: 5 });
    const r = await call('POST', '/api/demo/customer-message', { persona: 'minh', text: 'Anh cần sofa tầm 15 triệu' });
    const detail = (await call('GET', `/api/conversations/${r.json.conversationId}`)).json;
    const budget = detail.autoFill.find((p: any) => p.field === 'budget');
    const done = await call('POST', `/api/proposals/${budget.id}/decide`, { action: 'edit', editedText: '12.000.000 ₫' }, 'ha');
    expect(done.json).toMatchObject({ status: 'edited', value: { text: '12.000.000 ₫' } });
    const after = (await call('GET', `/api/conversations/${r.json.conversationId}`)).json;
    expect(after.approved).toEqual([expect.objectContaining({ field: 'budget', status: 'edited', decidedBy: 'chị Hà' })]);
    expect(after.autoFill.find((p: any) => p.field === 'budget')).toBeUndefined();
    expect((await call('GET', '/api/home')).json.ai).toMatchObject({ saleEdited: 1 });
  });
});

describe('xác thực đầu vào và biên', () => {
  it('vai trò sai, ID sai, hội thoại không có, body sai', async () => {
    expect((await call('GET', '/api/conversations/khong-phai-uuid')).status).toBe(404);
    expect((await call('GET', '/api/conversations/00000000-0000-7000-8000-000000000000')).status).toBe(404);
    expect((await call('POST', '/api/conversations/00000000-0000-7000-8000-000000000000/stop-followup')).status).toBe(404);
    expect((await call('POST', '/api/proposals/00000000-0000-7000-8000-000000000000/decide', { action: 'accept' })).status).toBe(404);
    expect((await call('POST', '/api/proposals/00000000-0000-7000-8000-000000000000/decide', { action: 'xoa' })).status).toBe(400);
    expect((await call('POST', '/api/clock/advance', {})).status).toBe(400);
    expect((await call('POST', '/api/clock/advance', { minutes: 5, to: '2026-11-13T09:30:00+07:00' })).status).toBe(400);
    expect((await call('POST', '/api/clock/advance', { to: '2026-11-01T09:30:00+07:00' })).status).toBe(400); // không tua lùi
    expect((await call('POST', '/api/demo/customer-message', { persona: 'khong-co', text: 'xin chào' })).status).toBe(400);
    expect((await call('POST', '/api/demo/customer-message', { persona: 'minh', text: '   ' })).status).toBe(400);
    expect((await call('POST', '/api/demo/page-message', { conversationId: 'x', text: 'a' })).status).toBe(400);
    const err = (await call('GET', '/api/conversations/khong-phai-uuid')).json;
    expect(err.error).toEqual({ code: 'not_found', message: expect.any(String) });
  });

  it('chưa đăng nhập thì mọi route nghiệp vụ và demo đều 401', async () => {
    for (const [m, url] of [['GET', '/api/home'], ['GET', '/api/inbox'], ['GET', '/api/now'], ['GET', '/api/overdue'], ['GET', '/api/personas'], ['POST', '/api/demo/reset'], ['POST', '/api/clock/advance']] as const) {
      const r = await app.inject({ method: m, url, headers: m === 'POST' ? H : {}, ...(m === 'POST' ? { payload: {} } : {}) });
      expect(r.statusCode, url).toBe(401);
    }
  });

  it('không bật DEMO_MODE thì route demo không tồn tại (404) nhưng route nghiệp vụ vẫn có (401 khi chưa đăng nhập)', async () => {
    const plain = makeApp(false);
    expect((await plain.inject({ method: 'GET', url: '/api/home' })).statusCode).toBe(401);
    for (const url of ['/api/demo/reset', '/api/clock/advance', '/api/auth/demo-login']) {
      expect((await plain.inject({ method: 'POST', url, headers: H, payload: {} })).statusCode, url).toBe(404);
    }
    await plain.close();
  });

  it('GET /api/personas liệt kê khách demo', async () => {
    const r = await call('GET', '/api/personas');
    expect(r.json.personas.map((p: any) => p.key).sort()).toEqual(['duc', 'mai', 'minh', 'ngoc', 'thu']);
  });
});
