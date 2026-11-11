import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { conversations } from '../src/db/schema.js';
import { loadConversationSummaries, loadHome } from '../src/followup/overview.js';
import { addMessage, seedBase, type Base } from './helpers/fixtures.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

const H = 3600_000;
const D = 24 * H;
const T0 = new Date('2026-11-01T02:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

/** Dựng hội thoại: khách nhắn lúc T0, rồi các tin Page tại T0 + offsets. Cập nhật mốc của hội thoại như worker thật. */
async function conv(base: Base, o: { customerAt?: number; pageAt: number[] }): Promise<void> {
  const cust = o.customerAt ?? 0;
  await addMessage(db, base, { text: 'Cho anh hỏi giá sofa', sentAt: at(cust) });
  for (const p of o.pageAt) await addMessage(db, base, { text: 'Dạ em trả lời ạ', direction: 'outbound', sentAt: at(p) });
  await db
    .update(conversations)
    .set({
      lastUserInteractionAt: at(cust),
      lastPageMessageAt: o.pageAt.length ? at(Math.max(...o.pageAt)) : null,
      lastMessageAt: at(Math.max(cust, ...o.pageAt)),
    })
    .where(eq(conversations.id, base.conversationId));
}

const summaryOf = async (tenantId: string, now: Date) => (await loadConversationSummaries(db, tenantId, now))[0]!;

describe('bám khách theo tin Page thật (dữ liệu trong DB)', () => {
  it('Page nhắn đúng 1 tin rồi khách im 10 ngày: Bám 0/5 và ĐẾN HẠN bám lần 1, không phải 5/5', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    await conv(base, { pageAt: [H] });
    const s = await summaryOf(base.tenantId, at(10 * D));
    expect(s.followup).toMatchObject({ count: 0, max: 5, due: true, suggestStop: false, stopped: false });
    const home = await loadHome(db, base.tenantId, at(10 * D));
    expect(home.suggestStop).toEqual([]);
    expect(home.reminders.map((r) => `${r.kind}:${r.title}`)).toEqual(['followup:Đến hạn bám lần 1/5']);
  });

  it('đã bám 3 lần (cách nhau 24 giờ): Bám 3/5, đến hạn lần 4 khi quá 24 giờ', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    await conv(base, { pageAt: [H, H + D, H + 2 * D, H + 3 * D] }); // 1 trả lời + 3 bám
    expect((await summaryOf(base.tenantId, at(H + 3 * D + 2 * H))).followup).toMatchObject({ count: 3, due: false });
    const due = await summaryOf(base.tenantId, at(H + 4 * D));
    expect(due.followup).toMatchObject({ count: 3, due: true });
    expect((await loadHome(db, base.tenantId, at(H + 4 * D))).reminders[0]!.title).toBe('Đến hạn bám lần 4/5');
  });

  it('đủ 5 lần và đã chờ thêm 24 giờ: đề xuất ngừng bám, không còn đến hạn', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    await conv(base, { pageAt: [0, 1, 2, 3, 4, 5].map((i) => H + i * D) });
    const lastPage = H + 5 * D;
    expect((await summaryOf(base.tenantId, at(lastPage + 23 * H))).followup).toMatchObject({ count: 5, suggestStop: false, due: false });
    expect((await summaryOf(base.tenantId, at(lastPage + D))).followup).toMatchObject({ count: 5, suggestStop: true, due: false });
    expect((await loadHome(db, base.tenantId, at(lastPage + D))).suggestStop).toHaveLength(1);
  });

  it('chỉ tính tin Page SAU lần khách nhắn cuối: tin Page cũ trước đó không dồn vào', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    // Page đã nhắn nhiều lần từ trước; khách trả lời ở ngày thứ 10; sau đó Page chỉ trả lời 1 tin.
    await addMessage(db, base, { text: 'chào', direction: 'outbound', sentAt: at(0) });
    for (let i = 1; i <= 4; i++) await addMessage(db, base, { text: `bám ${i}`, direction: 'outbound', sentAt: at(i * D) });
    await addMessage(db, base, { text: 'Ok em', sentAt: at(10 * D) });
    await addMessage(db, base, { text: 'Dạ em gửi anh ạ', direction: 'outbound', sentAt: at(10 * D + H) });
    await db
      .update(conversations)
      .set({ lastUserInteractionAt: at(10 * D), lastPageMessageAt: at(10 * D + H), lastMessageAt: at(10 * D + H) })
      .where(eq(conversations.id, base.conversationId));
    expect((await summaryOf(base.tenantId, at(10 * D + 23 * H))).followup).toMatchObject({ count: 0, due: false });
    expect((await summaryOf(base.tenantId, at(11 * D + 2 * H))).followup).toMatchObject({ count: 0, due: true });
  });

  it('khách nhắn lại thì về 0 và hết đến hạn', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    await conv(base, { pageAt: [H, H + D, H + 2 * D] });
    await addMessage(db, base, { text: 'Anh đây, anh cần xem hàng', sentAt: at(5 * D) });
    await db.update(conversations).set({ lastUserInteractionAt: at(5 * D), lastMessageAt: at(5 * D) }).where(eq(conversations.id, base.conversationId));
    const s = await summaryOf(base.tenantId, at(5 * D + H));
    expect(s.followup).toMatchObject({ count: 0, due: false, dueAt: null });
    expect(s.waitingOn).toBe('page');
  });

  it('Page chưa từng nhắn: không có gì để bám', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    await conv(base, { pageAt: [] });
    const s = await summaryOf(base.tenantId, at(20 * D));
    expect(s.followup).toMatchObject({ count: 0, due: false, dueAt: null, suggestStop: false });
    expect((await loadHome(db, base.tenantId, at(20 * D))).reminders).toEqual([]);
  });
});
