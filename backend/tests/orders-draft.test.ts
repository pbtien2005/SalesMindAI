import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { orders, products, replyDrafts, tasks, tenants } from '../src/db/schema.js';
import { OfflineExtractor } from '../src/extraction/offline-extractor.js';
import { runExtraction } from '../src/extraction/run.js';
import { buildOrderDraft } from '../src/orders/draft.js';
import { OrderError, sendReplyDraft, updateDraftOrder } from '../src/orders/service.js';
import { addMessage, seedBase, type Base } from './helpers/fixtures.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

const T = (min: number) => new Date(Date.UTC(2026, 10, 13, 2, min)); // Thứ Sáu 13/11 09:xx (+07:00)
const log = { info: () => {}, warn: () => {} };
const extract = (base: Base) => runExtraction({ db, extractor: new OfflineExtractor(), log, contextMessages: 30 }, base.conversationId);
const SCENE4 = 'Anh xem ảnh thấy ổn rồi, lấy 1 bộ Sofa Milan xám mã SF-021, giá 12 triệu như em báo nhé. Chốt luôn.';

async function setup(text = SCENE4) {
  const base = await seedBase(db, { aiEnabled: true });
  await db.update(tenants).set({ paymentInstructions: 'STK DEMO 000' }).where(eq(tenants.id, base.tenantId));
  await db.insert(products).values({ tenantId: base.tenantId, sku: 'SF-021', name: 'Sofa Milan xám', priceVnd: 12_000_000 });
  await addMessage(db, base, { text: 'Anh Minh đây. SĐT 0912 345 678', sentAt: T(0) });
  await addMessage(db, base, { text, sentAt: T(30) });
  await extract(base);
  return base;
}
const allOrders = (base: Base) => db.select().from(orders).where(eq(orders.conversationId, base.conversationId));
const allDrafts = (base: Base) => db.select().from(replyDrafts).where(eq(replyDrafts.conversationId, base.conversationId));

describe('đơn nháp (cảnh 4)', () => {
  it('khách chốt: đơn nháp đúng số liệu, địa chỉ thiếu, tin nháp có số tiền cọc', async () => {
    const base = await setup();
    const [o] = await allOrders(base);
    expect(o).toMatchObject({ status: 'draft', sku: 'SF-021', quantity: 1, unitPriceVnd: 12_000_000, totalVnd: 12_000_000, depositRequiredVnd: 6_000_000, depositPaidVnd: 0, address: null, code: null, flags: [] });
    expect(o!.customerName).toBe('Minh');
    expect(o!.phone).toBe('0912345678');
    const [d] = await allDrafts(base);
    expect(d).toMatchObject({ kind: 'confirm_order', status: 'pending', orderId: o!.id });
    expect(d!.text).toContain('6.000.000 ₫');
    expect(d!.text).toContain('Sofa Milan xám (SF-021)');
    expect(d!.text).toContain('STK DEMO 000');
  });

  it('giá khách nêu khác giá niêm yết: dùng giá niêm yết và gắn cờ price_mismatch', async () => {
    const base = await setup('Lấy 1 bộ mã SF-021, giá 10 triệu nhé. Chốt luôn.');
    const [o] = await allOrders(base);
    expect(o).toMatchObject({ unitPriceVnd: 12_000_000, totalVnd: 12_000_000 });
    expect(o!.flags).toContain('price_mismatch');
  });

  it('không có mã hàng trong bảng sản phẩm thì không dựng đơn', async () => {
    const base = await setup('Lấy 1 bộ mã ZZ-999, giá 10 triệu nhé. Chốt luôn.');
    expect(await allOrders(base)).toHaveLength(0);
  });

  it('chạy hai lần chỉ một đơn; Sale đã sửa thì khách nhắn thêm không ghi đè', async () => {
    const base = await setup();
    expect(await buildOrderDraft(db, base.tenantId, base.conversationId)).toBeNull();
    const [o] = await allOrders(base);
    await updateDraftOrder(db, { tenantId: base.tenantId, orderId: o!.id, by: 'Lan', patch: { quantity: 2 } }, T(40));
    await addMessage(db, base, { text: 'Mã SF-021 nhé, chốt luôn', sentAt: T(50) });
    await extract(base);
    const rows = await allOrders(base);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 2, totalVnd: 24_000_000, depositRequiredVnd: 12_000_000 });
    expect(rows[0]!.saleEditedAt).not.toBeNull();
    expect((await allDrafts(base))[0]!.text).toContain('12.000.000 ₫'); // tin nháp soạn lại theo số mới
  });

  it('chỉ sửa được khi đơn còn nháp; số lượng ngoài khoảng bị từ chối', async () => {
    const base = await setup();
    const [o] = await allOrders(base);
    await expect(updateDraftOrder(db, { tenantId: base.tenantId, orderId: o!.id, by: 'Lan', patch: { quantity: 0 } }, T(40))).rejects.toMatchObject({ code: 'invalid' });
    const u = await updateDraftOrder(db, { tenantId: base.tenantId, orderId: o!.id, by: 'Lan', patch: { address: '  12 Lê Lợi, Q1  ' } }, T(40));
    expect(u.address).toBe('12 Lê Lợi, Q1');
    await db.update(orders).set({ status: 'awaiting_deposit' }).where(eq(orders.id, o!.id));
    await expect(updateDraftOrder(db, { tenantId: base.tenantId, orderId: o!.id, by: 'Lan', patch: { address: 'x' } }, T(41))).rejects.toMatchObject({ code: 'not_draft' });
  });
});

describe('gửi tin nháp', () => {
  const sender = () => {
    const sent: Array<{ conversationId: string; text: string }> = [];
    return { sent, send: async (conversationId: string, text: string) => void sent.push({ conversationId, text }) };
  };

  it('Gửi: tin ra đúng bản Sale sửa, đơn sang awaiting_deposit, có việc nhắc cọc +24 giờ; lần hai trả not_pending', async () => {
    const base = await setup();
    const [d] = await allDrafts(base);
    const s = sender();
    const r = await sendReplyDraft({ db, send: s.send }, { tenantId: base.tenantId, replyDraftId: d!.id, by: 'Lan', text: 'Dạ em xác nhận đơn, cọc 6.000.000 ₫ ạ' }, T(35));
    expect(r.orderStatus).toBe('awaiting_deposit');
    expect(s.sent).toEqual([{ conversationId: base.conversationId, text: 'Dạ em xác nhận đơn, cọc 6.000.000 ₫ ạ' }]);
    expect((await allDrafts(base))[0]).toMatchObject({ status: 'sent', text: 'Dạ em xác nhận đơn, cọc 6.000.000 ₫ ạ', decidedBy: 'Lan' });
    const [o] = await allOrders(base);
    expect(o).toMatchObject({ status: 'awaiting_deposit' });
    const ts = await db.select().from(tasks).where(eq(tasks.conversationId, base.conversationId));
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ title: 'Nhắc khách cọc', source: 'deposit_reminder' });
    expect(ts[0]!.dueAt.getTime()).toBe(T(35).getTime() + 24 * 3_600_000);

    await expect(sendReplyDraft({ db, send: s.send }, { tenantId: base.tenantId, replyDraftId: d!.id, by: 'Lan' }, T(36))).rejects.toMatchObject({ code: 'not_pending' });
    expect(s.sent).toHaveLength(1);
  });

  it('bấm đồng thời hai lần chỉ gửi một tin', async () => {
    const base = await setup();
    const [d] = await allDrafts(base);
    const s = sender();
    const run = () => sendReplyDraft({ db, send: s.send }, { tenantId: base.tenantId, replyDraftId: d!.id, by: 'Lan' }, T(35));
    const results = await Promise.allSettled([run(), run()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(s.sent).toHaveLength(1);
    expect(await db.select().from(tasks).where(eq(tasks.conversationId, base.conversationId))).toHaveLength(1);
  });

  it('gửi thất bại: tin nháp vẫn pending, đơn vẫn draft, không có việc nhắc', async () => {
    const base = await setup();
    const [d] = await allDrafts(base);
    const failing = async () => {
      throw new Error('mạng lỗi');
    };
    await expect(sendReplyDraft({ db, send: failing }, { tenantId: base.tenantId, replyDraftId: d!.id, by: 'Lan' }, T(35))).rejects.toThrow('mạng lỗi');
    expect((await allDrafts(base))[0]!.status).toBe('pending');
    expect((await allOrders(base))[0]!.status).toBe('draft');
    expect(await db.select().from(tasks).where(eq(tasks.conversationId, base.conversationId))).toHaveLength(0);
    // Thử lại được.
    const s = sender();
    await sendReplyDraft({ db, send: s.send }, { tenantId: base.tenantId, replyDraftId: d!.id, by: 'Lan' }, T(36));
    expect(s.sent).toHaveLength(1);
  });

  it('nội dung trống hoặc quá dài bị từ chối, tenant khác không thấy tin nháp', async () => {
    const base = await setup();
    const other = await seedBase(db);
    const [d] = await allDrafts(base);
    for (const text of ['   ', 'x'.repeat(1001)]) {
      await expect(sendReplyDraft({ db, send: async () => {} }, { tenantId: base.tenantId, replyDraftId: d!.id, by: 'Lan', text }, T(35))).rejects.toBeInstanceOf(OrderError);
    }
    await expect(sendReplyDraft({ db, send: async () => {} }, { tenantId: other.tenantId, replyDraftId: d!.id, by: 'X' }, T(35))).rejects.toMatchObject({ code: 'not_found' });
  });
});
