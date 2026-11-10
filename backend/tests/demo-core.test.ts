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

describe('followupCount (tính khi đọc)', () => {
  const page = T0;
  const c = (user: Date | null) => ({ lastPageMessageAt: page, lastUserInteractionAt: user });
  it.each([
    [0, 0],
    [23 * H + 59 * 60_000, 0],
    [24 * H, 1],
    [47 * H, 1],
    [48 * H, 2],
    [4 * D + 10 * 60_000, 4],
    [5 * D, 5],
    [30 * D, 5], // tối đa 5
  ])('sau %i ms kể từ tin Page cuối: bám %i', (elapsed, expected) => {
    expect(followupCount(c(null), new Date(page.getTime() + elapsed))).toBe(expected);
  });

  it('khách có hành động sau (hoặc đúng lúc) tin Page cuối thì về 0', () => {
    const now = new Date(page.getTime() + 3 * D);
    expect(followupCount(c(new Date(page.getTime() + H)), now)).toBe(0);
    expect(followupCount(c(page), now)).toBe(0);
    // Khách nhắn TRƯỚC tin Page cuối thì vẫn đang bị bám.
    expect(followupCount(c(new Date(page.getTime() - H)), now)).toBe(3);
  });

  it('Page chưa nhắn gì, hoặc giờ hiện tại trước tin Page cuối: 0', () => {
    expect(followupCount({ lastPageMessageAt: null, lastUserInteractionAt: page }, new Date(page.getTime() + 9 * D))).toBe(0);
    expect(followupCount(c(null), new Date(page.getTime() - D))).toBe(0);
  });
});

describe('followupStatus và stopFollowup', () => {
  it('đủ 5/5 thì đề xuất ngừng; đã ngừng thì không đề xuất nữa; khách quay lại thì hết "đã ngừng"', () => {
    const times = { lastPageMessageAt: T0, lastUserInteractionAt: null };
    const now = new Date(T0.getTime() + 5 * D);
    expect(followupStatus(times, null, now)).toMatchObject({ count: 5, stopped: false, suggestStop: true });
    expect(followupStatus(times, now, now)).toMatchObject({ stopped: true, suggestStop: false });
    const returned = { ...times, lastUserInteractionAt: new Date(now.getTime() + H) };
    expect(followupStatus(returned, now, new Date(now.getTime() + 2 * H))).toMatchObject({ stopped: false, count: 0 });
  });

  it('Sale xác nhận ngừng bám; ngừng hai lần thì từ chối', async () => {
    const base = await seedBase(db, { aiEnabled: true });
    const times = { lastPageMessageAt: T0, lastUserInteractionAt: null };
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

  it('đúng trạng thái 09:00 Thứ Năm 12/11: P1 = 1 (chị Thu), quá hạn = 2, Cô Mai bám 4/5, số liệu AI = 0', async () => {
    const ctx = await reset();
    expect(ctx.clockNow.toISOString()).toBe(DEMO_START.toISOString());
    const home = await loadHome(db, ctx.tenantId, DEMO_START);

    expect(home.p1.map((c) => c.displayName)).toEqual(['Chị Thu']);
    expect(home.overdue.map((t) => t.displayName).sort()).toEqual(['Anh Đức', 'Chị Ngọc']);
    expect(home.overdue.map((t) => t.title).sort()).toEqual(['Gọi lại báo giá', 'Nhắc thanh toán']);
    expect(home.suggestStop).toEqual([]);
    expect(home.ai).toEqual({ autoFilled: 0, saleEdited: 0, askedDate: 0, approved: 0 });

    const kinds = home.reminders.map((r) => `${r.kind}:${r.displayName}`);
    expect(kinds).toEqual(['overdue:Anh Đức', 'overdue:Chị Ngọc', 'followup:Cô Mai']);
    expect(home.reminders.find((r) => r.kind === 'followup')!.title).toBe('Bám 4/5');
  });

  it('chị Thu chờ 20 phút: P1 chỉ khi quá 15 phút', async () => {
    const ctx = await reset();
    const at = (min: number) => new Date(vn(2026, 11, 12, 8, 40).getTime() + min * 60_000);
    expect((await loadHome(db, ctx.tenantId, at(10))).p1).toEqual([]);
    expect((await loadHome(db, ctx.tenantId, at(15))).p1).toEqual([]); // đúng 15 phút chưa phải "quá"
    expect((await loadHome(db, ctx.tenantId, at(16))).p1).toHaveLength(1);
  });

  it('P1 hết khi Page trả lời, hoặc khi khách nhắn tin mới không còn tín hiệu mua', async () => {
    const ctx = await reset();
    const [thu] = await db.select().from(conversations).where(eq(conversations.displayName, 'Chị Thu'));
    const base = { tenantId: ctx.tenantId, pageId: ctx.pageId, conversationId: thu!.id };

    // Khách nhắn thêm một câu không có tín hiệu mua: tín hiệu cũ không được ở lại mãi.
    await addMessage(db, base, { text: 'ok em cảm ơn', sentAt: vn(2026, 11, 12, 8, 50) });
    await db.update(conversations).set({ lastUserInteractionAt: vn(2026, 11, 12, 8, 50) }).where(eq(conversations.id, thu!.id));
    // Mốc 09:30: khách đã chờ 40 phút (quá ngưỡng 15 phút), nên P1 tắt chỉ vì tín hiệu mua đã cũ.
    const later = vn(2026, 11, 12, 9, 30);
    const [waiting] = (await loadConversationSummaries(db, ctx.tenantId, later)).filter((x) => x.id === thu!.id);
    expect(waiting).toMatchObject({ waitingOn: 'page', waitingMinutes: 40, isP1: false });
    expect((await loadHome(db, ctx.tenantId, later)).p1).toEqual([]);

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
    expect(home.p1.map((c) => c.displayName)).toEqual(['Chị Thu']);
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
