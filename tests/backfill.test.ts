import { randomBytes } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  handleBackfillConversation,
  handleBackfillPage,
  RECENT_MESSAGE_LIMIT,
  type BackfillConversationJob,
  type BackfillDeps,
  type BackfillPageJob,
  type BackfillQueue,
  type BackfillState,
} from '../src/backfill/backfill.js';
import { backfillOverview, isBackfillRunning } from '../src/backfill/status.js';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { conversations, messages, pages, tenants } from '../src/db/schema.js';
import { GraphApiError, type GraphMessage } from '../src/meta/graph-client.js';
import type { InboundMessage } from '../src/meta/parse-webhook.js';
import { storeInbound } from '../src/workers/store-messages.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));

const FB_PAGE = 'FB_PAGE_1';
const TOKEN = 'PAGE_TOKEN_SECRET';
const T0 = Date.parse('2026-11-09T07:00:00Z');

beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

async function seedPage(status: 'active' | 'token_invalid' = 'active', fbPageId = FB_PAGE) {
  const [tenant] = await db.insert(tenants).values({ name: 'Công ty A' }).returning();
  const [page] = await db
    .insert(pages)
    .values({ tenantId: tenant!.id, fbPageId, name: 'Page 1', tokenEnc: crypto.encrypt(TOKEN, fbPageId), status })
    .returning();
  return { tenant: tenant!, page: page! };
}

class FakeQueue implements BackfillQueue {
  pages: BackfillPageJob[] = [];
  conversations: BackfillConversationJob[] = [];
  async enqueuePage(j: BackfillPageJob) {
    this.pages.push(j);
    return true;
  }
  async enqueueConversation(j: BackfillConversationJob) {
    this.conversations.push(j);
    return true;
  }
}

interface GraphScript {
  /** Các trang hội thoại theo thứ tự gọi. */
  convPages?: Array<{ conversations: Array<{ id: string; updatedTime: string | null }>; after?: string }>;
  /** ID tin của từng hội thoại (thứ tự tùy ý, để thử cả trường hợp Meta không trả mới nhất trước). */
  convMessages?: Record<string, Array<{ id: string; createdAt: Date }>>;
  /** Meta báo danh sách tin còn trang sau. */
  hasMore?: boolean;
  /** Chi tiết từng tin; giá trị là lỗi thì ném. */
  details?: Record<string, GraphMessage | Error>;
  listError?: Error;
}

function stubGraph(script: GraphScript) {
  const calls = { list: [] as Array<{ token: string; fbPageId: string; after?: string }>, ids: [] as string[], detail: [] as string[] };
  let listIdx = 0;
  const graph: BackfillDeps['graph'] = {
    async listConversations(token, fbPageId, opts = {}) {
      calls.list.push({ token, fbPageId, ...(opts.after ? { after: opts.after } : {}) });
      if (script.listError) throw script.listError;
      return script.convPages![listIdx++] ?? { conversations: [] };
    },
    async listConversationMessages(_token, conversationId) {
      calls.ids.push(conversationId);
      return { messages: script.convMessages?.[conversationId] ?? [], hasMore: script.hasMore ?? false };
    },
    async getMessage(token, id) {
      expect(token).toBe(TOKEN); // đã giải mã đúng Page token
      calls.detail.push(id);
      const d = script.details?.[id];
      if (d instanceof Error) throw d;
      if (!d) throw new GraphApiError('không có', 400, 100, null, 'OAuthException');
      return d;
    },
  };
  return { graph, calls };
}

const logs: Array<{ level: string; obj: object }> = [];
const log = {
  info: (obj: object) => void logs.push({ level: 'info', obj }),
  warn: (obj: object) => void logs.push({ level: 'warn', obj }),
};

function deps(graph: BackfillDeps['graph'], queue: BackfillQueue = new FakeQueue(), extra: Partial<BackfillDeps> = {}): BackfillDeps {
  return { db, graph, crypto, queue, log, pacingMs: 0, sleep: async () => {}, ...extra };
}

const gm = (id: string, fromId: string | null, text: string | null, atMs: number): GraphMessage => ({
  id,
  createdAt: new Date(atMs),
  fromId,
  text,
});

const ids = (...list: Array<[string, number]>) => list.map(([id, at]) => ({ id, createdAt: new Date(at) }));

describe('handleBackfillPage', () => {
  it('liệt kê một trang: mỗi hội thoại một job, job trang kế tiếp có con trỏ, trạng thái running', async () => {
    const { page } = await seedPage();
    const q = new FakeQueue();
    const { graph, calls } = stubGraph({
      convPages: [{ conversations: [{ id: 't_1', updatedTime: null }, { id: 't_2', updatedTime: null }], after: 'CUR1' }],
    });
    await handleBackfillPage(deps(graph, q), { pageId: page.id });

    expect(calls.list).toEqual([{ token: TOKEN, fbPageId: FB_PAGE }]); // dùng Page token đã giải mã và ID Facebook của Page
    expect(q.conversations).toEqual([
      { pageId: page.id, conversationId: 't_1' },
      { pageId: page.id, conversationId: 't_2' },
    ]);
    expect(q.pages).toEqual([{ pageId: page.id, after: 'CUR1' }]);
    const [row] = await db.select().from(pages).where(eq(pages.id, page.id));
    const state = row!.backfillState as BackfillState;
    expect(state).toMatchObject({ status: 'running', conversationsEnqueued: 2 });
  });

  it('trang cuối: không có job kế tiếp, trạng thái listed; con trỏ được truyền cho lần gọi Meta', async () => {
    const { page } = await seedPage();
    const q = new FakeQueue();
    const { graph, calls } = stubGraph({ convPages: [{ conversations: [{ id: 't_9', updatedTime: null }] }] });
    await handleBackfillPage(deps(graph, q), { pageId: page.id, after: 'CUR1' });
    expect(calls.list[0]).toMatchObject({ after: 'CUR1' });
    expect(q.pages).toEqual([]);
    const [row] = await db.select().from(pages).where(eq(pages.id, page.id));
    expect((row!.backfillState as BackfillState).status).toBe('listed');
  });

  it('chạy nối tiếp nhiều trang: cộng dồn số hội thoại và giữ startedAt', async () => {
    const { page } = await seedPage();
    const q = new FakeQueue();
    const { graph } = stubGraph({
      convPages: [
        { conversations: [{ id: 'a', updatedTime: null }, { id: 'b', updatedTime: null }], after: 'C1' },
        { conversations: [{ id: 'c', updatedTime: null }] },
      ],
    });
    const d = deps(graph, q);
    await handleBackfillPage(d, { pageId: page.id });
    const first = ((await db.select().from(pages).where(eq(pages.id, page.id)))[0]!.backfillState as BackfillState);
    await handleBackfillPage(d, q.pages[0]!);
    const second = ((await db.select().from(pages).where(eq(pages.id, page.id)))[0]!.backfillState as BackfillState);
    expect(second).toMatchObject({ status: 'listed', conversationsEnqueued: 3 });
    expect(second.startedAt).toBe(first.startedAt);
  });

  it('chạy lại từ đầu (không có after) thì đếm lại từ 0', async () => {
    const { page } = await seedPage();
    const { graph } = stubGraph({ convPages: [{ conversations: [{ id: 'a', updatedTime: null }] }, { conversations: [{ id: 'a', updatedTime: null }] }] });
    const d = deps(graph);
    await handleBackfillPage(d, { pageId: page.id });
    await handleBackfillPage(d, { pageId: page.id });
    const [row] = await db.select().from(pages).where(eq(pages.id, page.id));
    expect((row!.backfillState as BackfillState).conversationsEnqueued).toBe(1);
  });

  it('Page không còn hoặc token_invalid: bỏ qua, không gọi Meta', async () => {
    const { graph, calls } = stubGraph({ convPages: [] });
    await handleBackfillPage(deps(graph), { pageId: '019e0000-0000-7000-8000-000000000000' });
    const { page } = await seedPage('token_invalid');
    await handleBackfillPage(deps(graph), { pageId: page.id });
    expect(calls.list).toHaveLength(0);
  });

  it('Meta báo 190: đánh dấu token_invalid, trạng thái failed, KHÔNG ném lỗi (không retry vô ích)', async () => {
    const { page } = await seedPage();
    const { graph } = stubGraph({ listError: new GraphApiError('hết hạn', 400, 190, null, 'OAuthException') });
    await expect(handleBackfillPage(deps(graph), { pageId: page.id })).resolves.toBeUndefined();
    const [row] = await db.select().from(pages).where(eq(pages.id, page.id));
    expect(row!.status).toBe('token_invalid');
    expect((row!.backfillState as BackfillState)).toMatchObject({ status: 'failed', reason: 'token_invalid' });
  });

  it('giới hạn tốc độ hoặc lỗi mạng: ném lỗi để pg-boss retry, trạng thái không đổi', async () => {
    const { page } = await seedPage();
    const { graph } = stubGraph({ listError: new GraphApiError('quá nhiều', 400, 4, null, 'OAuthException') });
    await expect(handleBackfillPage(deps(graph), { pageId: page.id })).rejects.toBeInstanceOf(GraphApiError);
    const [row] = await db.select().from(pages).where(eq(pages.id, page.id));
    expect(row!.status).toBe('active');
    expect(row!.backfillState).toBeNull();
  });
});

describe('handleBackfillConversation', () => {
  const conv = 't_1';

  it('lưu tin của khách, bỏ tin do Page gửi; đúng nội dung, thời điểm, hội thoại, nguồn backfill', async () => {
    const { page } = await seedPage();
    const { graph } = stubGraph({
      convMessages: { [conv]: ids(['m_3', T0 + 3000], ['m_2', T0 + 2000], ['m_1', T0 + 1000]) },
      details: {
        m_1: gm('m_1', 'PSID_A', 'Anh muốn mua 20 bộ, ngân sách 50 triệu', T0 + 1000),
        m_2: gm('m_2', FB_PAGE, 'Dạ em gửi báo giá ạ', T0 + 2000),
        m_3: gm('m_3', 'PSID_A', 'Cần trước thứ Sáu', T0 + 3000),
      },
    });
    const stats = await handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: conv });
    expect(stats).toMatchObject({ listed: 3, outbound: 1, stored: 2, unavailable: 0 });

    const rows = await db.select().from(messages).orderBy(asc(messages.sentAt));
    expect(rows.map((r) => [r.mid, r.text, r.source])).toEqual([
      ['m_1', 'Anh muốn mua 20 bộ, ngân sách 50 triệu', 'backfill'],
      ['m_3', 'Cần trước thứ Sáu', 'backfill'],
    ]);
    expect(rows[0]!.sentAt.getTime()).toBe(T0 + 1000);
    const [c] = await db.select().from(conversations);
    expect(c).toMatchObject({ psid: 'PSID_A', pageId: page.id });
    expect(c!.lastMessageAt!.getTime()).toBe(T0 + 3000);
  });

  it(`chỉ xử lý ${RECENT_MESSAGE_LIMIT} tin gần nhất (Meta chỉ cho chi tiết chừng đó)`, async () => {
    const { page } = await seedPage();
    const many = Array.from({ length: 30 }, (_, i): [string, number] => [`m_${i}`, T0 + (30 - i) * 1000]); // mới nhất trước
    const details: Record<string, GraphMessage> = {};
    for (const [id, at] of many) details[id] = gm(id, 'PSID_A', `tin ${id}`, at);
    const { graph, calls } = stubGraph({ convMessages: { [conv]: ids(...many) }, details });
    const stats = await handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: conv });
    expect(calls.detail).toHaveLength(RECENT_MESSAGE_LIMIT);
    expect(calls.detail[0]).toBe('m_0'); // lấy từ những tin mới nhất
    expect(stats.stored).toBe(RECENT_MESSAGE_LIMIT);
  });

  it('tin quá cũ Meta báo lỗi: bỏ qua tin đó, vẫn lưu các tin còn lại', async () => {
    const { page } = await seedPage();
    const { graph } = stubGraph({
      convMessages: { [conv]: ids(['m_new', T0 + 2000], ['m_old', T0 + 1000]) },
      details: {
        m_new: gm('m_new', 'PSID_A', 'mới', T0 + 2000),
        m_old: new GraphApiError('(#100) Message was deleted', 400, 100, null, 'GraphMethodException'),
      },
    });
    const stats = await handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: conv });
    expect(stats).toMatchObject({ stored: 1, unavailable: 1 });
  });

  it('tin đã có trong DB (cùng mid) thì không gọi lấy chi tiết; chạy lại không tạo trùng và không gọi Meta thêm', async () => {
    const { page } = await seedPage();
    const { graph, calls } = stubGraph({
      convMessages: { [conv]: ids(['m_2', T0 + 2000], ['m_1', T0 + 1000]) },
      details: { m_1: gm('m_1', 'PSID_A', 'một', T0 + 1000), m_2: gm('m_2', 'PSID_A', 'hai', T0 + 2000) },
    });
    const d = deps(graph);
    await handleBackfillConversation(d, { pageId: page.id, conversationId: conv });
    expect(calls.detail).toHaveLength(2);
    const second = await handleBackfillConversation(d, { pageId: page.id, conversationId: conv });
    expect(second).toMatchObject({ alreadyStored: 2, stored: 0 });
    expect(calls.detail).toHaveLength(2); // lần hai không gọi thêm
    expect(await db.select().from(messages)).toHaveLength(2);
  });

  it('bị giới hạn tốc độ giữa chừng: ném lỗi nhưng GIỮ phần đã lấy; retry chỉ làm phần còn lại', async () => {
    const { page } = await seedPage();
    const rateLimited = new GraphApiError('quá nhiều lời gọi', 400, 4, null, 'OAuthException');
    const script: GraphScript = {
      convMessages: { [conv]: ids(['m_3', T0 + 3000], ['m_2', T0 + 2000], ['m_1', T0 + 1000]) },
      details: {
        m_3: gm('m_3', 'PSID_A', 'ba', T0 + 3000),
        m_2: gm('m_2', 'PSID_A', 'hai', T0 + 2000),
        m_1: rateLimited, // tin thứ ba bị chặn
      },
    };
    const first = stubGraph(script);
    await expect(handleBackfillConversation(deps(first.graph), { pageId: page.id, conversationId: conv })).rejects.toBe(rateLimited);
    expect((await db.select().from(messages)).map((m) => m.mid).sort()).toEqual(['m_2', 'm_3']); // đã giữ lại

    script.details!.m_1 = gm('m_1', 'PSID_A', 'một', T0 + 1000); // hết bị chặn
    const retry = stubGraph(script);
    const stats = await handleBackfillConversation(deps(retry.graph), { pageId: page.id, conversationId: conv });
    expect(retry.calls.detail).toEqual(['m_1']); // chỉ lấy phần còn thiếu
    expect(stats).toMatchObject({ alreadyStored: 2, stored: 1 });
    expect(await db.select().from(messages)).toHaveLength(3);
  });

  it('Meta báo 190 giữa chừng: đánh dấu token_invalid, giữ phần đã lấy, không ném lỗi', async () => {
    const { page } = await seedPage();
    const { graph } = stubGraph({
      convMessages: { [conv]: ids(['m_2', T0 + 2000], ['m_1', T0 + 1000]) },
      details: { m_2: gm('m_2', 'PSID_A', 'hai', T0 + 2000), m_1: new GraphApiError('hết hạn', 400, 190, null, 'OAuthException') },
    });
    await expect(handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: conv })).resolves.toMatchObject({ stored: 1 });
    const [row] = await db.select().from(pages).where(eq(pages.id, page.id));
    expect(row!.status).toBe('token_invalid');
    expect(await db.select().from(messages)).toHaveLength(1);
  });

  it('lỗi mạng khi liệt kê tin: ném lỗi để retry', async () => {
    const { page } = await seedPage();
    const net = new GraphApiError('Không gọi được Graph API (TimeoutError).', null, null, null, null);
    const graph: BackfillDeps['graph'] = {
      listConversations: async () => ({ conversations: [] }),
      listConversationMessages: async () => {
        throw net;
      },
      getMessage: async () => {
        throw new Error('không được gọi');
      },
    };
    await expect(handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: conv })).rejects.toBe(net);
  });

  it('Page không còn hoặc token_invalid: bỏ qua, không gọi Meta', async () => {
    const { graph, calls } = stubGraph({});
    await handleBackfillConversation(deps(graph), { pageId: '019e0000-0000-7000-8000-000000000000', conversationId: conv });
    const { page } = await seedPage('token_invalid');
    await handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: conv });
    expect(calls.ids).toHaveLength(0);
  });

  it('tin không có text (chỉ có ảnh) KHÔNG được lưu thành dòng rỗng và được đếm riêng; ký tự NUL bị bỏ', async () => {
    const { page } = await seedPage();
    const { graph } = stubGraph({
      convMessages: { [conv]: ids(['m_3', T0 + 3000], ['m_2', T0 + 2000], ['m_1', T0 + 1000]) },
      details: {
        m_3: gm('m_3', 'PSID_A', '', T0 + 3000),
        m_2: gm('m_2', 'PSID_A', null, T0 + 2000),
        m_1: gm('m_1', 'PSID_A', 'có\u0000nul', T0 + 1000),
      },
    });
    const stats = await handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: conv });
    expect(stats).toMatchObject({ noText: 2, stored: 1 });
    const rows = await db.select().from(messages);
    expect(rows.map((r) => r.text)).toEqual(['cónul']);
  });

  it('Meta KHÔNG trả theo thứ tự mới nhất trước: vẫn lấy đúng 20 tin mới nhất theo created_time', async () => {
    const { page } = await seedPage();
    // 30 tin, trả theo thứ tự CŨ NHẤT TRƯỚC (ngược với giả định)
    const asc30 = Array.from({ length: 30 }, (_, i): [string, number] => [`m_${i}`, T0 + i * 1000]);
    const details: Record<string, GraphMessage> = {};
    for (const [id, at] of asc30) details[id] = gm(id, 'PSID_A', `tin ${id}`, at);
    const { graph, calls } = stubGraph({ convMessages: { [conv]: ids(...asc30) }, details });
    await handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: conv });
    expect(calls.detail).toHaveLength(RECENT_MESSAGE_LIMIT);
    expect(calls.detail).not.toContain('m_0'); // tin cũ nhất (Meta sẽ báo đã xóa) không được gọi
    expect(calls.detail).toContain('m_29'); // tin mới nhất được lấy
    expect(calls.detail).toContain('m_10'); // 20 tin cuối: m_10 tới m_29
  });

  it('lỗi 5xx, lỗi mạng hoặc phản hồi sai dạng KHÔNG bị nuốt như "tin không lấy được": ném lỗi để retry, giữ phần đã lấy', async () => {
    const { page } = await seedPage();
    const server500 = new GraphApiError('Graph API trả HTTP 500.', 500, null, null, null);
    const { graph } = stubGraph({
      convMessages: { [conv]: ids(['m_2', T0 + 2000], ['m_1', T0 + 1000]) },
      details: { m_2: gm('m_2', 'PSID_A', 'hai', T0 + 2000), m_1: server500 },
    });
    await expect(handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: conv })).rejects.toBe(server500);
    expect((await db.select().from(messages)).map((m) => m.mid)).toEqual(['m_2']);

    const parse = new GraphApiError('Phản hồi của Meta không đúng dạng (message).', 200, null, null, null);
    const g2 = stubGraph({ convMessages: { [conv]: ids(['m_9', T0 + 9000]) }, details: { m_9: parse } });
    await expect(handleBackfillConversation(deps(g2.graph), { pageId: page.id, conversationId: conv })).rejects.toBe(parse);
    const net = new GraphApiError('Không gọi được Graph API (TimeoutError).', null, null, null, null);
    const g3 = stubGraph({ convMessages: { [conv]: ids(['m_8', T0 + 8000]) }, details: { m_8: net } });
    await expect(handleBackfillConversation(deps(g3.graph), { pageId: page.id, conversationId: conv })).rejects.toBe(net);
  });

  it('lỗi ghi DB lúc giữ phần đã lấy KHÔNG che mất lỗi 190: Page vẫn được đánh dấu token_invalid', async () => {
    const { page } = await seedPage();
    const { graph } = stubGraph({
      convMessages: { [conv]: ids(['m_2', T0 + 2000], ['m_1', T0 + 1000]) },
      details: { m_2: gm('m_2', 'PSID_A', 'hai', T0 + 2000), m_1: new GraphApiError('hết hạn', 400, 190, null, 'OAuthException') },
    });
    // DB lỗi khi lưu tin (transaction), nhưng vẫn ghi được trạng thái Page
    const flakyDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'transaction') return () => Promise.reject(new Error('db down khi lưu tin'));
        return Reflect.get(target, prop, receiver);
      },
    });
    logs.length = 0;
    const d = { ...deps(graph), db: flakyDb };
    await expect(handleBackfillConversation(d, { pageId: page.id, conversationId: conv })).resolves.toBeDefined(); // không ném lỗi DB
    const [row] = await db.select().from(pages).where(eq(pages.id, page.id));
    expect(row!.status).toBe('token_invalid'); // lỗi gốc 190 vẫn được xử lý
    expect(logs.some((l) => l.level === 'warn' && 'err' in l.obj)).toBe(true); // lỗi DB được ghi lại, không biến mất
  });

  it('lỗi giới hạn tốc độ gốc vẫn được ném ra dù ghi DB lúc giữ phần đã lấy cũng lỗi', async () => {
    const { page } = await seedPage();
    const rate = new GraphApiError('quá nhiều', 400, 4, null, 'OAuthException');
    const { graph } = stubGraph({
      convMessages: { [conv]: ids(['m_2', T0 + 2000], ['m_1', T0 + 1000]) },
      details: { m_2: gm('m_2', 'PSID_A', 'hai', T0 + 2000), m_1: rate },
    });
    const flakyDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'transaction') return () => Promise.reject(new Error('db down'));
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(handleBackfillConversation({ ...deps(graph), db: flakyDb }, { pageId: page.id, conversationId: conv })).rejects.toBe(rate);
  });

  it('Meta báo danh sách tin còn trang sau: ghi nhận truncated và cảnh báo', async () => {
    const { page } = await seedPage();
    logs.length = 0;
    const { graph } = stubGraph({
      convMessages: { [conv]: ids(['m_1', T0]) },
      details: { m_1: gm('m_1', 'PSID_A', 'một', T0) },
      hasMore: true,
    });
    const stats = await handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: conv });
    expect(stats.truncated).toBe(true);
    expect(logs.some((l) => l.level === 'warn' && JSON.stringify(l.obj).includes(page.id))).toBe(true);
  });

  it('nghỉ giữa các lời gọi chi tiết (pacing) và không nghỉ khi không có gì để gọi', async () => {
    const { page } = await seedPage();
    const slept: number[] = [];
    const { graph } = stubGraph({
      convMessages: { [conv]: ids(['m_3', T0 + 3000], ['m_2', T0 + 2000], ['m_1', T0 + 1000]) },
      details: {
        m_1: gm('m_1', 'P', 'a', T0 + 1000),
        m_2: gm('m_2', 'P', 'b', T0 + 2000),
        m_3: gm('m_3', 'P', 'c', T0 + 3000),
      },
    });
    const d = deps(graph, new FakeQueue(), { pacingMs: 250, sleep: async (ms) => void slept.push(ms) });
    await handleBackfillConversation(d, { pageId: page.id, conversationId: conv });
    expect(slept).toEqual([250, 250]); // giữa 3 lời gọi chỉ có 2 lần nghỉ
    slept.length = 0;
    await handleBackfillConversation(d, { pageId: page.id, conversationId: conv }); // đã lưu hết
    expect(slept).toEqual([]);
  });
});

describe('khử trùng dự phòng giữa backfill và webhook (khi id Graph khác mid webhook)', () => {
  const inbound = (mid: string, text: string | null, atMs: number): InboundMessage => ({
    fbPageId: FB_PAGE, psid: 'PSID_A', mid, text, attachments: null, sentAtMs: atMs,
  });

  async function storeWebhook(page: { id: string; tenantId: string }, m: InboundMessage) {
    await db.transaction((tx) => storeInbound(tx, [{ m, page }], 'webhook'));
  }

  it('cùng nội dung, cách nhau dưới 2 giây, khác mid: bỏ qua bản backfill (không có hai dòng cho một tin)', async () => {
    const { page, tenant } = await seedPage();
    await storeWebhook({ id: page.id, tenantId: tenant.id }, inbound('mid.webhook.1', 'Cần báo giá', T0 + 1234));
    const { graph } = stubGraph({
      convMessages: { t_1: ids(['m_graph_1', T0 + 1000]) }, // Graph chỉ chính xác tới giây
      details: { m_graph_1: gm('m_graph_1', 'PSID_A', 'Cần báo giá', T0 + 1000) },
    });
    const stats = await handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: 't_1' });
    expect(stats).toMatchObject({ stored: 0, heuristicSkipped: 1 });
    expect(await db.select().from(messages)).toHaveLength(1);
    expect(logs.some((l) => l.level === 'warn' && 'heuristicSkipped' in l.obj)).toBe(true); // có cảnh báo để người vận hành biết
  });

  it('cùng nội dung nhưng cách nhau hơn 2 giây: là hai tin khác nhau, cả hai được giữ', async () => {
    const { page, tenant } = await seedPage();
    await storeWebhook({ id: page.id, tenantId: tenant.id }, inbound('mid.webhook.1', 'ok', T0));
    const { graph } = stubGraph({
      convMessages: { t_1: ids(['m_graph_1', T0 + 10_000]) },
      details: { m_graph_1: gm('m_graph_1', 'PSID_A', 'ok', T0 + 10_000) },
    });
    const stats = await handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: 't_1' });
    expect(stats).toMatchObject({ stored: 1, heuristicSkipped: 0 });
  });

  it('tin không có text không bao giờ bị khử trùng dự phòng (không đủ thông tin để so khớp)', async () => {
    const { page, tenant } = await seedPage();
    await storeWebhook({ id: page.id, tenantId: tenant.id }, inbound('mid.webhook.img', null, T0));
    const pageRef = { id: page.id, tenantId: tenant.id };
    const r = await db.transaction((tx) =>
      storeInbound(tx, [{ m: inbound('m_graph_img', null, T0 + 500), page: pageRef }], 'backfill', { heuristicDedupe: true }),
    );
    expect(r).toMatchObject({ stored: 1, heuristicSkipped: 0 });
  });

  it('cùng thời điểm nhưng khác nội dung: giữ cả hai', async () => {
    const { page, tenant } = await seedPage();
    await storeWebhook({ id: page.id, tenantId: tenant.id }, inbound('mid.webhook.1', 'A', T0));
    const { graph } = stubGraph({
      convMessages: { t_1: ids(['m_graph_1', T0]) },
      details: { m_graph_1: gm('m_graph_1', 'PSID_A', 'B', T0) },
    });
    expect((await handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: 't_1' })).stored).toBe(1);
  });

  it('cùng mid là trùng bình thường (ON CONFLICT), không tính là khử trùng dự phòng', async () => {
    const { page, tenant } = await seedPage();
    await storeWebhook({ id: page.id, tenantId: tenant.id }, inbound('m_same', 'xin chào', T0 + 500));
    const { graph, calls } = stubGraph({
      convMessages: { t_1: ids(['m_same', T0]) },
      details: { m_same: gm('m_same', 'PSID_A', 'xin chào', T0) },
    });
    const stats = await handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: 't_1' });
    expect(stats).toMatchObject({ alreadyStored: 1, heuristicSkipped: 0, stored: 0 });
    expect(calls.detail).toHaveLength(0); // đã có mid thì khỏi gọi chi tiết
  });

  it('chỉ so với tin webhook: hai tin backfill giống nhau cách nhau 1 giây đều được giữ', async () => {
    const { page } = await seedPage();
    const { graph } = stubGraph({
      convMessages: { t_1: ids(['m_2', T0 + 1000], ['m_1', T0]) },
      details: { m_1: gm('m_1', 'PSID_A', 'ok', T0), m_2: gm('m_2', 'PSID_A', 'ok', T0 + 1000) },
    });
    const stats = await handleBackfillConversation(deps(graph), { pageId: page.id, conversationId: 't_1' });
    expect(stats.stored).toBe(2);
  });
});

describe('isBackfillRunning (chặn chạy backfill chồng nhau)', () => {
  const st = (status: BackfillState['status'], updatedAt: string): BackfillState => ({ status, startedAt: updatedAt, conversationsEnqueued: 1, updatedAt });
  const now = new Date('2026-11-09T08:00:00Z');

  it('running và vừa cập nhật: đang chạy', () => {
    expect(isBackfillRunning(st('running', '2026-11-09T07:50:00Z'), now)).toBe(true);
  });
  it('running nhưng đã quá 30 phút không cập nhật (chết giữa chừng): không coi là đang chạy', () => {
    expect(isBackfillRunning(st('running', '2026-11-09T07:00:00Z'), now)).toBe(false);
  });
  it('listed, failed, chưa chạy hoặc ngày hỏng: không chặn', () => {
    expect(isBackfillRunning(st('listed', '2026-11-09T07:59:00Z'), now)).toBe(false);
    expect(isBackfillRunning(st('failed', '2026-11-09T07:59:00Z'), now)).toBe(false);
    expect(isBackfillRunning(null, now)).toBe(false);
    expect(isBackfillRunning(st('running', 'không phải ngày'), now)).toBe(false);
  });
});

describe('backfillOverview (lệnh backfill:status)', () => {
  it('đếm đúng số tin từ backfill của từng Page, không đếm tin từ webhook', async () => {
    const a = await seedPage('active', 'PAGE_A');
    const [pageB] = await db.insert(pages).values({ tenantId: a.tenant.id, fbPageId: 'PAGE_B', name: 'B', tokenEnc: 'x' }).returning();
    const [convA] = await db.insert(conversations).values({ tenantId: a.tenant.id, pageId: a.page.id, psid: 'U' }).returning();
    const mk = (mid: string, source: 'webhook' | 'backfill') => ({
      tenantId: a.tenant.id, pageId: a.page.id, conversationId: convA!.id, mid, text: 't', sentAt: new Date(), source,
    });
    await db.insert(messages).values([mk('1', 'backfill'), mk('2', 'backfill'), mk('3', 'webhook')]);
    await db.update(pages).set({ backfillState: { status: 'listed', conversationsEnqueued: 7 } }).where(eq(pages.id, a.page.id));

    const rows = await backfillOverview(db);
    const ra = rows.find((r) => r.fbPageId === 'PAGE_A')!;
    const rb = rows.find((r) => r.fbPageId === 'PAGE_B')!;
    expect(ra.stored).toBe(2);
    expect(ra.state).toMatchObject({ status: 'listed', conversationsEnqueued: 7 });
    expect(rb.stored).toBe(0);
    expect(rb.state).toBeNull();
    expect(pageB).toBeTruthy();
  });
});
