import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { extractionRuns, profileFields, proposals, tenants } from '../src/db/schema.js';
import { setAiEnabled } from '../src/extraction/admin.js';
import { OfflineExtractor } from '../src/extraction/offline-extractor.js';
import { buildProposal, runExtraction } from '../src/extraction/run.js';
import type { Candidate, Extractor, ExtractorMessage, ExtractorOutcome } from '../src/extraction/types.js';
import { addConversation, addMessage, addProposal, addRun, seedBase, type Base } from './helpers/fixtures.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

const T = (min: number) => new Date(Date.UTC(2026, 10, 12, 2, min)); // Thứ Năm 12/11/2026 09:xx (+07:00)

function fake(fn: (input: { messages: ExtractorMessage[] }) => ExtractorOutcome | Promise<ExtractorOutcome>): Extractor & { calls: number } {
  const ex = {
    model: 'fake',
    calls: 0,
    async extract(input: { messages: ExtractorMessage[] }) {
      ex.calls += 1;
      return fn(input);
    },
  };
  return ex;
}
const ok = (candidates: Candidate[]): ExtractorOutcome => ({ kind: 'ok', candidates, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 } });

const logs: object[] = [];
const log = { info: (o: object) => logs.push(o), warn: (o: object) => logs.push(o) };
beforeEach(() => {
  logs.length = 0;
});
const deps = (extractor: Extractor) => ({ db, extractor, log, contextMessages: 30 });

async function pending(base: Base) {
  return db.select().from(proposals).where(and(eq(proposals.conversationId, base.conversationId), eq(proposals.status, 'pending')));
}
const byField = (rows: Awaited<ReturnType<typeof pending>>, f: string) => rows.find((r) => r.field === f);

describe('runExtraction', () => {
  it('tạo đề xuất kèm câu gốc đã kiểm chứng; SĐT do code trích; ngày mơ hồ không bị giải', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    const text = 'Anh Minh đây. SĐT anh 0912 345 678. Cuối tuần này anh ghé shop xem được không?';
    const m = await addMessage(db, base, { text, sentAt: T(40) });
    const r = await runExtraction(deps(new OfflineExtractor()), base.conversationId);
    expect(r.status).toBe('succeeded');

    const rows = await pending(base);
    const phone = byField(rows, 'phone')!;
    expect(phone.value).toEqual({ text: '0912345678' });
    const ev = (phone.evidence as Array<{ messageId: string; start: number; end: number; text: string }>)[0]!;
    expect(ev.messageId).toBe(m);
    expect(text.slice(ev.start, ev.end)).toBe(ev.text);
    expect(ev.text).toBe('0912 345 678');

    const tl = byField(rows, 'timeline')!;
    expect(tl.flags).toEqual(['needs_clarification']);
    expect(tl.value).toEqual({ text: 'Cuối tuần này', kind: 'relative', sentAt: T(40).toISOString() });
    expect(JSON.stringify(tl.value)).not.toMatch(/2026-11-1[3-5]|14\/11|Thứ Bảy|Chủ Nhật/);

    expect(byField(rows, 'customer_name')!.value).toEqual({ text: 'Minh' });
    // Mọi câu gốc là đoạn cắt thật từ tin khách.
    for (const p of rows) {
      for (const e of p.evidence as Array<{ start: number; end: number; text: string }>) expect(text.slice(e.start, e.end)).toBe(e.text);
    }
    // Chưa có gì được duyệt.
    expect(await db.select().from(profileFields)).toHaveLength(0);
  });

  it('chạy lại cùng tin thì bỏ qua, không trùng; tin mới thì chạy lại', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    await addMessage(db, base, { text: 'Cho anh hỏi sofa tầm 15 triệu', sentAt: T(5) });
    const ex = fake(() => ok([]));
    expect((await runExtraction(deps(ex), base.conversationId)).status).toBe('succeeded');
    expect(await runExtraction(deps(ex), base.conversationId)).toEqual({ status: 'skipped', reason: 'already_done' });
    expect(ex.calls).toBe(1); // lần hai không tốn lượt gọi AI
    await addMessage(db, base, { text: 'à mà màu xám nhé', sentAt: T(6) });
    expect((await runExtraction(deps(ex), base.conversationId)).status).toBe('succeeded');
    expect(await db.select().from(extractionRuns)).toHaveLength(2);
  });

  it('câu bịa, câu gần giống, câu lấy từ tin của Page hay từ hội thoại khác đều bị loại', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    const other = await addConversation(db, base, 'psid-khac');
    const mCustomer = await addMessage(db, base, { text: 'Anh cần sofa tầm 15 triệu', sentAt: T(5) });
    const mPage = await addMessage(db, base, { text: 'Dạ em có mẫu giá 12 triệu ạ', direction: 'outbound', sentAt: T(6) });
    const mOther = await addMessage(db, other, { text: 'Tôi cần giường tầm 8 triệu', sentAt: T(5) });
    await addMessage(db, base, { text: 'ok em', sentAt: T(7) });

    const ex = fake(() =>
      ok([
        { field: 'budget', value: 'khoảng 20 triệu', quotes: [{ messageId: mCustomer, quote: 'tầm 20 triệu' }] }, // bịa
        { field: 'budget', value: '12 triệu', quotes: [{ messageId: mPage, quote: '12 triệu' }] }, // của Page
        { field: 'budget', value: '8 triệu', quotes: [{ messageId: mOther, quote: '8 triệu' }] }, // hội thoại khác
        { field: 'budget', value: '15 triệu', quotes: [{ messageId: 'khong-ton-tai', quote: '15 triệu' }] }, // id lạ
        { field: 'budget', value: '15 triệu', quotes: [] }, // không có căn cứ
        { field: 'product_interest', value: 'sofa', quotes: [{ messageId: mCustomer, quote: 'sofa' }] }, // hợp lệ
      ]),
    );
    const r = await runExtraction(deps(ex), base.conversationId);
    expect(r).toMatchObject({ status: 'succeeded', proposed: 1, rejected: 5 });
    const rows = await pending(base);
    expect(rows.map((x) => x.field)).toEqual(['product_interest']);
    const [run] = await db.select().from(extractionRuns);
    expect(run).toMatchObject({ fieldsProposed: 1, fieldsRejected: 5 });
  });

  it('giá trị không hợp lệ theo từng trường bị loại (ngày không phải thời gian, ngân sách không có số, enum lạ)', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    const m = await addMessage(db, base, { text: 'Cho anh xem sofa màu xám nhé, chốt luôn', sentAt: T(5) });
    const ex = fake(() =>
      ok([
        { field: 'timeline', value: 'sofa', quotes: [{ messageId: m, quote: 'sofa' }] }, // không phải cụm thời gian
        { field: 'budget', value: 'rẻ', quotes: [{ messageId: m, quote: 'màu xám' }] }, // không có số
        { field: 'message_purpose', value: 'bay_mau', quotes: [{ messageId: m, quote: 'chốt luôn' }] }, // ngoài danh sách
        { field: 'intent', value: 'ready_to_buy', quotes: [{ messageId: m, quote: 'chốt luôn' }] }, // hợp lệ
      ]),
    );
    const r = await runExtraction(deps(ex), base.conversationId);
    expect(r).toMatchObject({ proposed: 1, rejected: 3 });
  });

  it('timeline: giá trị lưu là cụm GỐC đã kiểm chứng, không phải chữ của mô hình', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    const m = await addMessage(db, base, { text: 'MAI anh qua nhé', sentAt: T(5) });
    const ex = fake(() => ok([{ field: 'timeline', value: 'ngày 13/11/2026', quotes: [{ messageId: m, quote: 'mai' }] }]));
    await runExtraction(deps(ex), base.conversationId);
    const tl = byField(await pending(base), 'timeline')!;
    expect(tl.value).toMatchObject({ text: 'MAI', kind: 'relative' }); // đoạn gốc, không có "13/11/2026"
    expect(JSON.stringify(tl)).not.toContain('13/11/2026');
  });

  it('đề xuất mới khác giá trị thì thay đề xuất cũ; cùng giá trị thì giữ; chỉ một pending mỗi trường', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    const m1 = await addMessage(db, base, { text: 'Anh cần sofa tầm 15 triệu', sentAt: T(5) });
    let amount = 'tầm 15 triệu';
    const ex = fake(() => ok([{ field: 'budget', value: amount, quotes: [{ messageId: m1, quote: amount }] }]));
    await runExtraction(deps(ex), base.conversationId);
    const first = byField(await pending(base), 'budget')!;

    // Tin mới, giá trị vẫn như cũ: giữ nguyên đề xuất cũ.
    await addMessage(db, base, { text: 'ừ nhé', sentAt: T(6) });
    await runExtraction(deps(ex), base.conversationId);
    expect(byField(await pending(base), 'budget')!.id).toBe(first.id);

    // Tin mới đổi ngân sách: đề xuất cũ thành superseded.
    const m3 = await addMessage(db, base, { text: 'thôi tầm 20 triệu thôi', sentAt: T(7) });
    amount = 'tầm 20 triệu';
    ex.extract = async () => {
      ex.calls += 1;
      return ok([{ field: 'budget', value: 'khoảng 20 triệu', quotes: [{ messageId: m3, quote: 'tầm 20 triệu' }] }]);
    };
    await runExtraction(deps(ex), base.conversationId);
    const all = await db.select().from(proposals).where(eq(proposals.field, 'budget'));
    expect(all.filter((p) => p.status === 'pending')).toHaveLength(1);
    expect(all.find((p) => p.id === first.id)!.status).toBe('superseded');
  });

  it('giá trị đã duyệt hoặc đã bị Sale bỏ qua thì không đề xuất lại', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    const m1 = await addMessage(db, base, { text: 'Anh Minh đây, tên là Minh, cần sofa tầm 15 triệu', sentAt: T(5) });
    const run0 = await addRun(db, base, m1, 'cu');
    // Tên đã duyệt "Minh"; ngân sách đã bị bỏ qua.
    const pName = await addProposal(db, base, run0, { field: 'customer_name', value: { text: 'Minh' }, status: 'accepted' });
    await db.insert(profileFields).values({ conversationId: base.conversationId, tenantId: base.tenantId, field: 'customer_name', value: { text: 'Minh' }, proposalId: pName });
    await addProposal(db, base, run0, { field: 'budget', value: { text: 'khoảng 15 triệu' }, status: 'dismissed' });

    const ex = fake(() =>
      ok([
        { field: 'customer_name', value: 'Minh', quotes: [{ messageId: m1, quote: 'Minh đây' }] },
        { field: 'budget', value: 'khoảng 15 triệu', quotes: [{ messageId: m1, quote: 'tầm 15 triệu' }] },
        { field: 'product_interest', value: 'sofa', quotes: [{ messageId: m1, quote: 'sofa' }] },
      ]),
    );
    const r = await runExtraction(deps(ex), base.conversationId);
    expect(r).toMatchObject({ status: 'succeeded', proposed: 1 });
    expect((await pending(base)).map((p) => p.field)).toEqual(['product_interest']);
  });

  it('mô hình từ chối, hết token hoặc trả sai schema: ghi run failed kèm lý do, SĐT vẫn được trích', async () => {
    for (const [kind, reason] of [
      ['refused', 'refusal'],
      ['max_tokens', 'max_tokens'],
      ['invalid', 'invalid_output'],
    ] as const) {
      await truncateAll(handle);
      const base = await seedBase(db, { aiEnabled: true });
      await addMessage(db, base, { text: 'gọi anh số 0912345678 nhé', sentAt: T(5) });
      const r = await runExtraction(deps(fake(() => ({ kind, usage: { inputTokens: 3, outputTokens: 1, cacheReadTokens: 0 } }))), base.conversationId);
      expect(r).toMatchObject({ status: 'failed', failureReason: reason, proposed: 1 });
      const [run] = await db.select().from(extractionRuns);
      expect(run).toMatchObject({ status: 'failed', failureReason: reason });
      expect((await pending(base)).map((p) => p.field)).toEqual(['phone']);
    }
  });

  it('lỗi tạm thời của nhà cung cấp được ném ra và KHÔNG ghi run (để hàng đợi retry)', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    await addMessage(db, base, { text: 'anh cần sofa', sentAt: T(5) });
    await expect(
      runExtraction(
        deps(
          fake(() => {
            throw new Error('429');
          }),
        ),
        base.conversationId,
      ),
    ).rejects.toThrow('429');
    expect(await db.select().from(extractionRuns)).toHaveLength(0);
  });

  it('bỏ qua khi: tenant tắt AI, hội thoại không tồn tại, không có tin khách, tin trước lúc bật AI', async () => {
    const off = await seedBase(db, { aiEnabled: false });
    await addMessage(db, off, { text: 'anh cần sofa', sentAt: T(5) });
    const ex = fake(() => ok([]));
    expect(await runExtraction(deps(ex), off.conversationId)).toEqual({ status: 'skipped', reason: 'ai_disabled' });
    expect(await runExtraction(deps(ex), '00000000-0000-7000-8000-000000000000')).toEqual({ status: 'skipped', reason: 'conversation_missing' });

    const on = await seedBase(db, { aiEnabled: true });
    await addMessage(db, on, { text: 'Dạ em chào anh', direction: 'outbound', sentAt: T(5) });
    expect(await runExtraction(deps(ex), on.conversationId)).toEqual({ status: 'skipped', reason: 'no_customer_message' });

    const late = await seedBase(db, { aiEnabled: false });
    await addMessage(db, late, { text: 'tin cũ trước khi bật AI', sentAt: T(5) });
    await setAiEnabled(db, late.tenantId, true, T(30));
    expect(await runExtraction(deps(ex), late.conversationId)).toEqual({ status: 'skipped', reason: 'before_enabled' });
    expect(ex.calls).toBe(0); // không gửi gì cho AI
  });

  it('log chỉ có số đếm và id, không có nội dung tin, câu gốc hay giá trị trích', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    const text = 'Anh Minh đây, SĐT 0912 345 678, sofa phòng khách tầm 15 triệu, cuối tuần này ghé';
    await addMessage(db, base, { text, sentAt: T(5) });
    await runExtraction(deps(new OfflineExtractor()), base.conversationId);
    expect(logs.length).toBeGreaterThan(0);
    const dump = JSON.stringify(logs);
    for (const secret of ['Minh', '0912', 'sofa', '15 triệu', 'cuối tuần', 'Cuối tuần']) expect(dump).not.toContain(secret);
  });

  it('AI chỉ ghi proposals: profile_fields luôn rỗng sau khi trích', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    await addMessage(db, base, { text: 'Anh Minh đây, 0912345678, sofa xám tầm 15 triệu', sentAt: T(5) });
    await runExtraction(deps(new OfflineExtractor()), base.conversationId);
    expect((await pending(base)).length).toBeGreaterThan(3);
    expect(await db.select().from(profileFields)).toHaveLength(0);
  });

  it('mặc định tenant tắt AI', async () => {
    const [t] = await db.insert(tenants).values({ name: 'x' }).returning();
    expect(t!.aiExtractionEnabled).toBe(false);
  });
});

describe('buildProposal (hàm thuần)', () => {
  const msgA: ExtractorMessage = { id: 'a', direction: 'inbound', text: 'Cuối tuần này anh ghé', sentAt: T(5) };
  const map = new Map([[msgA.id, msgA]]);
  it('không nhận quote của tin không có trong danh sách tin khách', () => {
    expect(buildProposal({ field: 'quantity', value: '1 bộ', quotes: [{ messageId: 'x', quote: 'anh' }] }, map)).toBeNull();
  });
  it('nhiều quote: một quote hỏng thì loại cả trường', () => {
    expect(
      buildProposal({ field: 'product_interest', value: 'sofa xám', quotes: [{ messageId: 'a', quote: 'anh ghé' }, { messageId: 'a', quote: 'màu xám' }] }, map),
    ).toBeNull();
  });
  it('giới hạn số quote', () => {
    const q = { messageId: 'a', quote: 'anh' };
    expect(buildProposal({ field: 'quantity', value: '1', quotes: [q, q, q, q, q] }, map)).toBeNull();
  });
});

describe('runExtraction: cảnh 4 (mã hàng, giá, tín hiệu chốt)', () => {
  it('sku có đúng một đề xuất với câu gốc là chuỗi con; ngân sách cũ không bị thay bởi giá; closeSignal đúng', async () => {
    const { loadConversationSummaries } = await import('../src/followup/overview.js');
    const base = await seedBase(db, { aiEnabled: true });
    await addMessage(db, base, { text: 'Anh đang tìm sofa tầm 15 triệu', sentAt: T(0) });
    await runExtraction(deps(new OfflineExtractor()), base.conversationId);
    const text = 'Anh xem ảnh thấy ổn rồi, lấy 1 bộ Sofa Milan xám mã SF-021, giá 12 triệu như em báo nhé. Chốt luôn.';
    const m = await addMessage(db, base, { text, sentAt: T(30) });
    await runExtraction(deps(new OfflineExtractor()), base.conversationId);

    const rows = await pending(base);
    const budget = rows.filter((r) => r.field === 'budget');
    expect(budget).toHaveLength(1);
    expect(JSON.stringify(budget[0]!.value)).toContain('15.000.000');
    const sku = rows.filter((r) => r.field === 'sku');
    expect(sku).toHaveLength(1);
    expect((sku[0]!.value as { text: string }).text).toBe('SF-021');
    const ev = (sku[0]!.evidence as Array<{ messageId: string; start: number; end: number; text: string }>)[0]!;
    expect(ev.messageId).toBe(m);
    expect(text.slice(ev.start, ev.end)).toBe(ev.text);
    expect(byField(rows, 'unit_price')).toBeTruthy();

    const [s] = await loadConversationSummaries(db, base.tenantId, T(31));
    expect(s!.closeSignal).toMatchObject({ messageId: m });
    expect(s!.closeSignal!.text.toLowerCase()).toBe('chốt luôn');
  });
});
