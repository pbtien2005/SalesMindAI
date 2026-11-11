import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { advanceClock, advanceClockTo, getNow, getOffsetMs, setClockTo } from '../src/demo/clock.js';
import { DEMO_FB_PAGE_ID, DEMO_PAGE_INBOX_APP_ID, DEMO_START, DEMO_TENANT_NAME, getDemoContext, resetDemo, vn } from '../src/demo/seed.js';
import { customerPayload, pageEchoPayload, PERSONAS, sendSigned, signBody, type WebhookPoster } from '../src/demo/simulator.js';
import { followupCount, followupStatus, FollowupError, stopFollowup } from '../src/followup/followup.js';
import { loadConversationSummaries, loadHome } from '../src/followup/overview.js';
import { conversations, followupState, messages, proposals, tasks, tenants } from '../src/db/schema.js';
import { parseWebhookPayload } from '../src/meta/parse-webhook.js';
import { verifySignature } from '../src/meta/signature.js';
import { addMessage, seedBase } from './helpers/fixtures.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));
const log = { info: () => {}, warn: () => {} };
beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

const H = 3600_000;
const D = 24 * H;
const T0 = new Date('2026-11-10T00:00:00Z');

describe('followupCount (tính khi đọc, theo tin Page thật)', () => {
  /** Tin Page gửi lần lượt tại T0 + các mốc (ms), sau lần khách hành động cuối. */
  const pages = (...offsets: number[]) => ({ lastUserInteractionAt: null, pageMessagesAfterUser: offsets.map((o) => new Date(T0.getTime() + o)) });
  const at = (ms: number) => new Date(T0.getTime() + ms);

  it('Page chưa nhắn gì sau khách: 0 và không có gì để bám', () => {
    expect(followupStatus(pages(), null, at(9 * D))).toMatchObject({ count: 0, due: false, dueAt: null, suggestStop: false });
  });

  it('tin Page đầu tiên là trả lời, chưa tính là bám: im 10 ngày vẫn 0 nhưng ĐẾN HẠN bám lần 1', () => {
    const st = followupStatus(pages(0), null, at(10 * D));
    expect(st).toMatchObject({ count: 0, due: true, suggestStop: false });
    expect(st.dueAt!.getTime()).toBe(T0.getTime() + D);
  });

  it('chưa đủ 24 giờ kể từ tin Page cuối thì chưa đến hạn', () => {
    expect(followupStatus(pages(0), null, at(D - 1))).toMatchObject({ count: 0, due: false });
    expect(followupStatus(pages(0), null, at(D))).toMatchObject({ due: true });
  });

  it.each([
    [[0, D], 1],
    [[0, D - 1], 0], // cách chưa đủ 24 giờ thì không tính
    [[0, D, 2 * D], 2],
    [[0, D, 2 * D, 3 * D, 4 * D, 5 * D], 5],
    [[0, D, 2 * D, 3 * D, 4 * D, 5 * D, 6 * D, 7 * D], 5], // tối đa 5
  ])('tin Page lúc %j: bám %i', (offsets, expected) => {
    expect(followupCount(pages(...(offsets as number[])), at(30 * D))).toBe(expected);
  });

  it('nhiều tin gửi dồn trong cùng 24 giờ chỉ tính một lần', () => {
    // Trả lời, rồi 3 tin cách nhau vài phút, rồi 1 tin sau 25 giờ: chỉ 1 lần bám (tin dồn bị bỏ, tin sau 25 giờ tính).
    expect(followupCount(pages(0, 5 * 60_000, 10 * 60_000, 25 * H), at(30 * D))).toBe(1);
  });

  it('tin Page ở tương lai (so với now) bị bỏ qua', () => {
    expect(followupCount(pages(0, D, 2 * D), at(D + H))).toBe(1);
  });

  it('không phụ thuộc thứ tự đầu vào', () => {
    expect(followupCount(pages(2 * D, 0, D), at(30 * D))).toBe(2);
  });
});

describe('followupStatus và stopFollowup', () => {
  const fiveFollowups = { lastUserInteractionAt: null, pageMessagesAfterUser: [0, 1, 2, 3, 4, 5].map((i) => new Date(T0.getTime() + i * D)) };

  it('đủ 5 lần bám: chờ thêm 24 giờ rồi mới đề xuất ngừng; không còn "đến hạn" nữa', () => {
    const last = T0.getTime() + 5 * D;
    expect(followupStatus(fiveFollowups, null, new Date(last + 23 * H))).toMatchObject({ count: 5, suggestStop: false, due: false, dueAt: null });
    expect(followupStatus(fiveFollowups, null, new Date(last + D))).toMatchObject({ count: 5, suggestStop: true, due: false });
  });

  it('đã ngừng thì không đề xuất, không đến hạn; khách quay lại thì hết "đã ngừng" và về 0', () => {
    const now = new Date(T0.getTime() + 7 * D);
    expect(followupStatus(fiveFollowups, now, now)).toMatchObject({ stopped: true, suggestStop: false, due: false });
    const returned = { lastUserInteractionAt: new Date(now.getTime() + H), pageMessagesAfterUser: [] };
    expect(followupStatus(returned, now, new Date(now.getTime() + 2 * H))).toMatchObject({ stopped: false, count: 0, due: false });
  });

  it('Sale xác nhận ngừng bám; ngừng hai lần thì từ chối', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    const times = { lastUserInteractionAt: null };
    const now = new Date(T0.getTime() + 5 * D);
    await stopFollowup(db, { tenantId: base.tenantId, conversationId: base.conversationId, by: 'Lan' }, times, now);
    const [row] = await db.select().from(followupState);
    expect(row).toMatchObject({ conversationId: base.conversationId, stoppedBy: 'Lan' });
    await expect(stopFollowup(db, { tenantId: base.tenantId, conversationId: base.conversationId, by: 'Lan' }, times, now)).rejects.toBeInstanceOf(FollowupError);
  });
});

describe('đồng hồ demo', () => {
  it('ngoài DEMO_MODE luôn là giờ thật', async () => {
    await setClockTo(db, new Date('2030-01-01T00:00:00Z'), new Date('2026-11-10T00:00:00Z'));
    const real = new Date('2026-11-10T05:00:00Z');
    expect((await getNow(db, false, real)).toISOString()).toBe(real.toISOString());
  });

  it('đặt, chạy tiếp theo giờ thật, tua tới, không tua lùi', async () => {
    const real = new Date('2026-11-10T05:00:00Z');
    await setClockTo(db, DEMO_START, real);
    expect((await getNow(db, true, real)).toISOString()).toBe(DEMO_START.toISOString());
    // 90 giây thật trôi qua: đồng hồ demo cũng đi 90 giây.
    expect((await getNow(db, true, new Date(real.getTime() + 90_000))).getTime()).toBe(DEMO_START.getTime() + 90_000);

    const advanced = await advanceClock(db, 30, real);
    expect(advanced.getTime()).toBe(DEMO_START.getTime() + 30 * 60_000);
    expect(await getOffsetMs(db)).toBe(DEMO_START.getTime() - real.getTime() + 30 * 60_000);

    const to = vn(2026, 11, 13, 9, 30);
    expect((await advanceClockTo(db, to, real)).toISOString()).toBe(to.toISOString());
    await expect(advanceClockTo(db, DEMO_START, real)).rejects.toThrow();
    await expect(advanceClock(db, 0, real)).rejects.toThrow();
    await expect(advanceClock(db, -5, real)).rejects.toThrow();
    await expect(advanceClock(db, Number.NaN, real)).rejects.toThrow();
  });
});

describe('dữ liệu nền demo', () => {
  const REAL = new Date('2026-11-10T05:00:00Z');
  const reset = () => resetDemo({ db, crypto, log, realNow: REAL });

  it('đúng trạng thái 09:00 Thứ Năm 12/11: P1 = 1 (chị Thu), quá hạn = 2, Cô Mai bám 5/5 (chưa đủ 24 giờ chờ nên chưa đề xuất ngừng), số liệu AI = 0', async () => {
    const ctx = await reset();
    expect(ctx.clockNow.toISOString()).toBe(DEMO_START.toISOString());
    const home = await loadHome(db, ctx.tenantId, DEMO_START);

    // P1 = khách chờ Page trả lời quá 15 phút (không cần tín hiệu mua).
    expect(home.p1.map((c) => c.displayName).sort()).toEqual(['Anh Đức', 'Chị Ngọc', 'Chị Thu']);
    expect(home.overdue.map((t) => t.displayName).sort()).toEqual(['Anh Đức', 'Chị Ngọc']);
    expect(home.overdue.map((t) => t.title).sort()).toEqual(['Gọi lại báo giá', 'Nhắc thanh toán']);
    expect(home.suggestStop).toEqual([]);
    expect(home.ai).toEqual({ autoFilled: 0, saleEdited: 0, askedDate: 0, approved: 0 });

    const kinds = home.reminders.map((r) => `${r.kind}:${r.displayName}`);
    expect(kinds).toEqual(['overdue:Anh Đức', 'overdue:Chị Ngọc', 'followup:Cô Mai']);
    expect(home.reminders.find((r) => r.kind === 'followup')!.title).toBe('Bám 5/5');
  });

  it('chị Thu chờ 20 phút: P1 chỉ khi quá 15 phút', async () => {
    const ctx = await reset();
    const at = (min: number) => new Date(vn(2026, 11, 12, 8, 40).getTime() + min * 60_000);
    const names = async (min: number) => (await loadHome(db, ctx.tenantId, at(min))).p1.map((c) => c.displayName);
    expect(await names(10)).not.toContain('Chị Thu');
    expect(await names(15)).not.toContain('Chị Thu'); // đúng 15 phút chưa phải "quá"
    expect(await names(16)).toContain('Chị Thu');
  });

  it('P1 là khách chờ quá lâu, không cần tín hiệu mua; hết khi Page trả lời', async () => {
    const ctx = await reset();
    const [thu] = await db.select().from(conversations).where(eq(conversations.displayName, 'Chị Thu'));
    const base = { tenantId: ctx.tenantId, pageId: ctx.pageId, conversationId: thu!.id };

    // Khách nhắn thêm một câu không có tín hiệu mua: vẫn là P1 vì chỉ cần chờ quá lâu.
    await addMessage(db, base, { text: 'ok em cảm ơn', sentAt: vn(2026, 11, 12, 8, 50) });
    await db.update(conversations).set({ lastUserInteractionAt: vn(2026, 11, 12, 8, 50) }).where(eq(conversations.id, thu!.id));
    // Mốc 09:30: khách đã chờ 40 phút (quá ngưỡng 15 phút).
    const later = vn(2026, 11, 12, 9, 30);
    const [waiting] = (await loadConversationSummaries(db, ctx.tenantId, later)).filter((x) => x.id === thu!.id);
    expect(waiting).toMatchObject({ waitingOn: 'page', waitingMinutes: 40, isP1: true });
    expect((await loadHome(db, ctx.tenantId, later)).p1.map((x) => x.id)).toContain(thu!.id);

    // Page trả lời: hết chờ.
    await db.update(conversations).set({ lastPageMessageAt: vn(2026, 11, 12, 8, 55) }).where(eq(conversations.id, thu!.id));
    const [s] = (await loadConversationSummaries(db, ctx.tenantId, DEMO_START)).filter((x) => x.id === thu!.id);
    expect(s).toMatchObject({ waitingOn: 'customer', isP1: false });
  });

  it('Thứ Sáu 09:30: Cô Mai đủ 5/5 (đề xuất ngừng), khách nền khác không đổi', async () => {
    const ctx = await reset();
    const fri = vn(2026, 11, 13, 9, 30);
    const home = await loadHome(db, ctx.tenantId, fri);
    expect(home.suggestStop.map((c) => c.displayName)).toEqual(['Cô Mai']);
    expect(home.p1.map((c) => c.displayName).sort()).toEqual(['Anh Đức', 'Chị Ngọc', 'Chị Thu']);
    expect(home.overdue).toHaveLength(2);
  });

  it('chạy lại nhiều lần cho cùng kết quả và chỉ đụng tenant demo', async () => {
    const other = await seedBase(db, { aiEnabled: true });
    await addMessage(db, other, { text: 'tin của tenant khác', sentAt: DEMO_START });

    const a = await reset();
    const snapA = JSON.stringify((await loadHome(db, a.tenantId, DEMO_START)).reminders.map((r) => [r.kind, r.displayName, r.title]));
    const b = await reset();
    const snapB = JSON.stringify((await loadHome(db, b.tenantId, DEMO_START)).reminders.map((r) => [r.kind, r.displayName, r.title]));
    expect(snapB).toBe(snapA);
    expect(b.tenantId).not.toBe(a.tenantId); // dựng lại hoàn toàn

    expect(await db.select().from(tenants).where(eq(tenants.name, DEMO_TENANT_NAME))).toHaveLength(1);
    expect(await db.select().from(conversations).where(eq(conversations.tenantId, b.tenantId))).toHaveLength(4);
    // Tenant khác còn nguyên.
    expect(await db.select().from(messages).where(eq(messages.tenantId, other.tenantId))).toHaveLength(1);
    expect((await getDemoContext(db))?.tenantId).toBe(b.tenantId);
  });

  it('khách nền có đúng nguồn tin: tin của Page do Page Inbox gửi', async () => {
    const ctx = await reset();
    const rows = await db.select().from(messages).where(eq(messages.tenantId, ctx.tenantId));
    const out = rows.filter((m) => m.direction === 'outbound');
    expect(out.length).toBeGreaterThan(0);
    for (const m of out) expect(m).toMatchObject({ senderKind: 'page_inbox', appId: DEMO_PAGE_INBOX_APP_ID });
    expect((await db.select().from(tasks)).filter((t) => t.source === 'seed')).toHaveLength(2);
    expect((await db.select().from(proposals).where(eq(proposals.status, 'pending'))).every((p) => ['message_purpose', 'intent'].includes(p.field))).toBe(true);
  });
});

describe('giả lập tin nhắn', () => {
  const SECRET = 'demo-secret';

  it('chữ ký đúng chuẩn Meta (verifySignature chấp nhận, sai khóa thì từ chối)', () => {
    const raw = JSON.stringify(customerPayload({ fbPageId: DEMO_FB_PAGE_ID, psid: 'p', text: 'Chào', at: DEMO_START }));
    expect(verifySignature(Buffer.from(raw), signBody(raw, SECRET), SECRET)).toBe(true);
    expect(verifySignature(Buffer.from(raw), signBody(raw, 'khac'), SECRET)).toBe(false);
  });

  it('payload của khách parse thành tin đến; payload của Lan parse thành echo của Page Inbox', () => {
    const at = vn(2026, 11, 12, 9, 5);
    const c = parseWebhookPayload(customerPayload({ fbPageId: DEMO_FB_PAGE_ID, psid: PERSONAS.minh!.psid, text: 'Chào shop', at }));
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0]).toMatchObject({ direction: 'inbound', psid: PERSONAS.minh!.psid, text: 'Chào shop', sentAtMs: at.getTime() });

    const e = parseWebhookPayload(pageEchoPayload({ fbPageId: DEMO_FB_PAGE_ID, psid: PERSONAS.minh!.psid, text: 'Dạ em chào anh', at, appId: DEMO_PAGE_INBOX_APP_ID }));
    expect(e.messages[0]).toMatchObject({ direction: 'outbound', psid: PERSONAS.minh!.psid, appId: DEMO_PAGE_INBOX_APP_ID });
  });

  it('đi qua đúng POST /webhook: chữ ký đúng thì vào hàng đợi, sai khóa thì 403 và sendSigned ném lỗi', async () => {
    const queued: unknown[] = [];
    const app = buildApp({}, { appSecret: SECRET, verifyToken: 'v', queue: { enqueue: async (d) => void queued.push(d) } });
    const poster: WebhookPoster = {
      async post(rawBody, signature) {
        const res = await app.inject({ method: 'POST', url: '/webhook', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: rawBody });
        return { status: res.statusCode };
      },
    };
    const payload = customerPayload({ fbPageId: DEMO_FB_PAGE_ID, psid: 'p', text: 'Chào', at: DEMO_START });
    await sendSigned(poster, SECRET, payload);
    expect(queued).toHaveLength(1);
    await expect(sendSigned(poster, 'sai-khoa', payload)).rejects.toThrow(/403/);
    expect(queued).toHaveLength(1);
    await app.close();
  });
});
