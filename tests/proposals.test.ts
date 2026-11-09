import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { profileFields, proposals, tasks } from '../src/db/schema.js';
import { decideProposal, listPending, ProposalError } from '../src/extraction/proposals.js';
import { addMessage, addProposal, addRun, seedBase, type Base } from './helpers/fixtures.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

const NOW = new Date('2026-11-13T02:41:00Z');
const T = new Date('2026-11-13T02:40:00Z');

async function setup() {
  const base = await seedBase(db, { aiEnabled: true });
  const m = await addMessage(db, base, { text: 'Cuối tuần này anh ghé', sentAt: T });
  const run = await addRun(db, base, m);
  return { base, m, run };
}
const decide = (base: Base, proposalId: string, over: Partial<Parameters<typeof decideProposal>[1]> = {}) =>
  decideProposal(db, { tenantId: base.tenantId, proposalId, action: 'accept', by: 'Lan', ...over }, NOW);
const profile = (base: Base) => db.select().from(profileFields).where(eq(profileFields.conversationId, base.conversationId));
const row = async (id: string) => (await db.select().from(proposals).where(eq(proposals.id, id)))[0]!;

describe('decideProposal', () => {
  it('accept: ghi hồ sơ đã duyệt (version 1) và lịch sử người quyết định', async () => {
    const { base, run } = await setup();
    const id = await addProposal(db, base, run, { field: 'customer_name', value: { text: 'Minh' }, evidence: [{ messageId: 'x', start: 0, end: 4, text: 'Minh' }] });
    expect(await profile(base)).toHaveLength(0); // chưa duyệt thì chưa có gì

    const r = await decide(base, id);
    expect(r).toMatchObject({ status: 'accepted', field: 'customer_name', value: { text: 'Minh' } });
    const p = await row(id);
    expect(p).toMatchObject({ status: 'accepted', decidedBy: 'Lan', decidedValue: { text: 'Minh' } });
    expect(p.decidedAt?.toISOString()).toBe(NOW.toISOString());
    expect(p.evidence).toEqual([{ messageId: 'x', start: 0, end: 4, text: 'Minh' }]); // căn cứ giữ nguyên
    const [f] = await profile(base);
    expect(f).toMatchObject({ field: 'customer_name', value: { text: 'Minh' }, version: 1, proposalId: id });
  });

  it('edit: lưu giá trị Sale sửa vào hồ sơ, giữ nguyên giá trị AI đề xuất', async () => {
    const { base, run } = await setup();
    const id = await addProposal(db, base, run, { field: 'budget', value: { text: '≈ 15.000.000 ₫' } });
    const r = await decide(base, id, { action: 'edit', editedText: '12.000.000 ₫' });
    expect(r).toMatchObject({ status: 'edited', value: { text: '12.000.000 ₫' } });
    const p = await row(id);
    expect(p.value).toEqual({ text: '≈ 15.000.000 ₫' }); // lịch sử: AI đã đề xuất gì
    expect(p.decidedValue).toEqual({ text: '12.000.000 ₫' });
    expect((await profile(base))[0]!.value).toEqual({ text: '12.000.000 ₫' });
  });

  it('edit thiếu hoặc quá dài thì bị từ chối', async () => {
    const { base, run } = await setup();
    const id = await addProposal(db, base, run, { field: 'budget' });
    for (const editedText of [undefined, '', '   ', 'x'.repeat(201)]) {
      await expect(decide(base, id, { action: 'edit', editedText })).rejects.toMatchObject({ code: 'invalid' });
    }
    expect((await row(id)).status).toBe('pending');
  });

  it('dismiss: không ghi hồ sơ', async () => {
    const { base, run } = await setup();
    const id = await addProposal(db, base, run, { field: 'phone', value: { text: '0912345678' } });
    expect(await decide(base, id, { action: 'dismiss' })).toMatchObject({ status: 'dismissed' });
    expect(await profile(base)).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: 'dismissed', decidedBy: 'Lan' });
  });

  it('chỉ quyết định được đề xuất đang pending; superseded hay đã quyết định thì bị từ chối', async () => {
    const { base, run } = await setup();
    const superseded = await addProposal(db, base, run, { field: 'budget', status: 'superseded' });
    const done = await addProposal(db, base, run, { field: 'customer_name', status: 'accepted' });
    for (const id of [superseded, done]) {
      await expect(decide(base, id)).rejects.toMatchObject({ code: 'not_pending' });
    }
    expect(await profile(base)).toHaveLength(0);
  });

  it('hai quyết định đồng thời cho cùng một đề xuất: chỉ một cái thắng', async () => {
    const { base, run } = await setup();
    const id = await addProposal(db, base, run, { field: 'customer_name', value: { text: 'Minh' } });
    const results = await Promise.allSettled([decide(base, id, { by: 'Lan' }), decide(base, id, { action: 'dismiss', by: 'Hà' }), decide(base, id, { by: 'Ngọc' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect((r.reason as ProposalError).code).toBe('not_pending');
  });

  it('không quyết định được đề xuất của tenant khác, hoặc không tồn tại', async () => {
    const { base, run } = await setup();
    const other = await seedBase(db);
    const id = await addProposal(db, base, run, { field: 'budget' });
    await expect(decideProposal(db, { tenantId: other.tenantId, proposalId: id, action: 'accept', by: 'Lan' }, NOW)).rejects.toMatchObject({ code: 'not_found' });
    await expect(decide(base, '00000000-0000-7000-8000-000000000000')).rejects.toMatchObject({ code: 'not_found' });
    expect((await row(id)).status).toBe('pending');
  });

  it('thiếu tên người quyết định thì từ chối', async () => {
    const { base, run } = await setup();
    const id = await addProposal(db, base, run, { field: 'budget' });
    await expect(decide(base, id, { by: '  ' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('duyệt giá trị mới cho cùng trường: ghi đè hồ sơ và tăng version', async () => {
    const { base, run } = await setup();
    const a = await addProposal(db, base, run, { field: 'budget', value: { text: '15 triệu' } });
    await decide(base, a);
    const b = await addProposal(db, base, run, { field: 'budget', value: { text: '20 triệu' } });
    await decide(base, b);
    const [f] = await profile(base);
    expect(f).toMatchObject({ value: { text: '20 triệu' }, version: 2, proposalId: b });
  });
});

describe('timeline: không bao giờ tự điền ngày', () => {
  const tl = { text: 'cuối tuần này', kind: 'relative', sentAt: T.toISOString() };

  it('cụm tương đối chưa có ngày: duyệt bị từ chối, không ghi hồ sơ, không tạo việc', async () => {
    const { base, run } = await setup();
    const id = await addProposal(db, base, run, { field: 'timeline', value: tl, flags: ['needs_clarification'] });
    await expect(decide(base, id)).rejects.toMatchObject({ code: 'needs_date' });
    await expect(decide(base, id, { action: 'edit', editedText: 'thứ Bảy' })).rejects.toMatchObject({ code: 'needs_date' });
    expect((await row(id)).status).toBe('pending');
    expect(await profile(base)).toHaveLength(0);
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it('Sale chọn ngày giờ: duyệt, lưu ngày Sale chọn, tạo việc đúng thời điểm đó', async () => {
    const { base, run } = await setup();
    const id = await addProposal(db, base, run, { field: 'timeline', value: tl, flags: ['needs_clarification'] });
    const r = await decide(base, id, { chosenAt: '2026-11-14T10:00:00+07:00' });
    expect(r.status).toBe('accepted');
    expect(r.value).toMatchObject({ text: 'cuối tuần này', chosenAt: '2026-11-14T03:00:00.000Z' });
    const [f] = await profile(base);
    expect(f!.value).toMatchObject({ chosenAt: '2026-11-14T03:00:00.000Z' });
    const [t] = await db.select().from(tasks);
    expect(t).toMatchObject({ title: 'Khách hẹn ghé xem', source: 'appointment', conversationId: base.conversationId });
    expect(t!.dueAt.toISOString()).toBe('2026-11-14T03:00:00.000Z');
    expect(t!.doneAt).toBeNull();
    // Đề xuất gốc không bị gắn ngày: ngày chỉ nằm ở quyết định của Sale.
    expect(JSON.stringify((await row(id)).value)).not.toContain('2026-11-14');
  });

  it('ngày giờ sai dạng hoặc thiếu múi giờ thì bị từ chối', async () => {
    const { base, run } = await setup();
    const id = await addProposal(db, base, run, { field: 'timeline', value: tl, flags: ['needs_clarification'] });
    for (const chosenAt of ['14/11/2026', '2026-11-14', '2026-11-14T10:00:00', 'thứ bảy']) {
      await expect(decide(base, id, { chosenAt })).rejects.toMatchObject({ code: 'invalid' });
    }
    expect((await row(id)).status).toBe('pending');
  });

  it('chọn lịch hẹn mới thì lịch hẹn cũ được đóng', async () => {
    const { base, run } = await setup();
    const a = await addProposal(db, base, run, { field: 'timeline', value: tl, flags: ['needs_clarification'] });
    await decide(base, a, { chosenAt: '2026-11-14T10:00:00+07:00' });
    const b = await addProposal(db, base, run, { field: 'timeline', value: { ...tl, text: 'chủ nhật' }, flags: ['needs_clarification'] });
    await decide(base, b, { chosenAt: '2026-11-15T09:00:00+07:00' });
    const all = await db.select().from(tasks).orderBy(tasks.dueAt);
    expect(all.map((t) => t.doneAt !== null)).toEqual([true, false]);
  });

  it('cụm có ngày rõ ràng (absolute, không cờ) duyệt được không cần chọn ngày, và không tạo việc', async () => {
    const { base, run } = await setup();
    const id = await addProposal(db, base, run, { field: 'timeline', value: { text: '14/11', kind: 'absolute' }, flags: [] });
    expect((await decide(base, id)).status).toBe('accepted');
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it('chosenAt chỉ dành cho timeline', async () => {
    const { base, run } = await setup();
    const id = await addProposal(db, base, run, { field: 'budget' });
    await expect(decide(base, id, { chosenAt: '2026-11-14T10:00:00+07:00' })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('listPending', () => {
  it('chỉ trả đề xuất pending của đúng hội thoại và tenant', async () => {
    const { base, run } = await setup();
    const other = await seedBase(db);
    await addProposal(db, base, run, { field: 'budget' });
    await addProposal(db, base, run, { field: 'customer_name', status: 'dismissed' });
    expect((await listPending(db, base.tenantId, base.conversationId)).map((p) => p.field)).toEqual(['budget']);
    expect(await listPending(db, other.tenantId, base.conversationId)).toEqual([]);
  });
});
