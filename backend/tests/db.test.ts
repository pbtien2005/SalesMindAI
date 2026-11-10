import { randomBytes } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { conversations, messages, pagePolicyEvents, pages, tenants } from '../src/db/schema.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));

beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

async function seed(fbPageId = 'page-1') {
  const [tenant] = await db.insert(tenants).values({ name: 'Công ty A' }).returning();
  const [page] = await db
    .insert(pages)
    .values({
      tenantId: tenant!.id,
      fbPageId,
      name: 'Page A',
      tokenEnc: crypto.encrypt('token-of-' + fbPageId, fbPageId),
    })
    .returning();
  const [conv] = await db
    .insert(conversations)
    .values({ tenantId: tenant!.id, pageId: page!.id, psid: 'psid-1' })
    .returning();
  return { tenant: tenant!, page: page!, conv: conv! };
}

const msg = (s: Awaited<ReturnType<typeof seed>>, mid: string, sentAt: Date, text: string | null = 'xin chào') => ({
  tenantId: s.tenant.id,
  pageId: s.page.id,
  conversationId: s.conv.id,
  mid,
  text,
  sentAt,
  source: 'webhook' as const,
});

describe('schema và migration', () => {
  it('migration đã tạo đủ 4 bảng', async () => {
    const r = await handle.pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name`,
      [['conversations', 'messages', 'pages', 'tenants']],
    );
    expect(r.rows.map((x) => x.table_name)).toEqual(['conversations', 'messages', 'pages', 'tenants']);
  });

  it('id mặc định là UUID v7', async () => {
    const [t] = await db.insert(tenants).values({ name: 'x' }).returning();
    expect(t!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('khóa ngoại: không tạo được Page cho tenant không tồn tại', async () => {
    await expect(
      db.insert(pages).values({
        tenantId: '019e0000-0000-7000-8000-000000000000',
        fbPageId: 'p',
        name: 'n',
        tokenEnc: 'x',
      }),
    ).rejects.toThrow();
  });

  it('đa tenant: DB từ chối tin có tenant/page/conversation không khớp nhau', async () => {
    const a = await seed('page-a');
    const b = await seed('page-b'); // tenant khác, page khác, conversation khác
    // tenant của A nhưng page của B
    await expect(
      db.insert(messages).values({ ...msg(a, 'mid.x1', new Date()), pageId: b.page.id }),
    ).rejects.toThrow();
    // page và tenant của A nhưng conversation của B
    await expect(
      db.insert(messages).values({ ...msg(a, 'mid.x2', new Date()), conversationId: b.conv.id }),
    ).rejects.toThrow();
    // tenant của B nhưng page và conversation của A
    await expect(
      db.insert(messages).values({ ...msg(a, 'mid.x3', new Date()), tenantId: b.tenant.id }),
    ).rejects.toThrow();
    // conversation gắn page của A nhưng tenant của B
    await expect(
      db.insert(conversations).values({ tenantId: b.tenant.id, pageId: a.page.id, psid: 'psid-z' }),
    ).rejects.toThrow();
    // cặp khớp thì được
    await expect(db.insert(messages).values(msg(a, 'mid.ok', new Date()))).resolves.toBeDefined();
  });

  it('fb_page_id là duy nhất', async () => {
    const s = await seed('dup');
    await expect(
      db.insert(pages).values({ tenantId: s.tenant.id, fbPageId: 'dup', name: 'n', tokenEnc: 'x' }),
    ).rejects.toThrow();
  });

  it('status chỉ nhận active hoặc token_invalid', async () => {
    const s = await seed();
    await expect(
      handle.pool.query(`UPDATE pages SET status = 'bogus' WHERE id = $1`, [s.page.id]),
    ).rejects.toThrow();
    await db.update(pages).set({ status: 'token_invalid' }).where(eq(pages.id, s.page.id));
    const [p] = await db.select().from(pages).where(eq(pages.id, s.page.id));
    expect(p!.status).toBe('token_invalid');
  });
});

describe('Page token trong DB', () => {
  it('lưu dạng mã hóa, đọc lại giải mã được, không có token rõ trong DB', async () => {
    const s = await seed('page-77');
    const raw = await handle.pool.query('SELECT token_enc FROM pages WHERE id = $1', [s.page.id]);
    const stored: string = raw.rows[0].token_enc;
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain('token-of-page-77');
    expect(crypto.decrypt(stored, 'page-77')).toBe('token-of-page-77');
  });

  it('chép ciphertext của Page này sang Page khác thì không giải mã được', async () => {
    const a = await seed('page-A');
    const stored = a.page.tokenEnc;
    expect(() => crypto.decrypt(stored, 'page-B')).toThrow();
  });
});

describe('khử trùng và sắp xếp tin nhắn', () => {
  it('cùng mid chỉ lưu một dòng (ON CONFLICT DO NOTHING)', async () => {
    const s = await seed();
    const first = await db
      .insert(messages)
      .values(msg(s, 'mid.1', new Date(1_700_000_000_000)))
      .onConflictDoNothing({ target: messages.mid })
      .returning({ id: messages.id });
    const second = await db
      .insert(messages)
      .values(msg(s, 'mid.1', new Date(1_700_000_000_000)))
      .onConflictDoNothing({ target: messages.mid })
      .returning({ id: messages.id });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(messages)) as [{ n: number }];
    expect(n).toBe(1);
  });

  it('insert trùng mid mà không có ON CONFLICT thì bị DB từ chối', async () => {
    const s = await seed();
    await db.insert(messages).values(msg(s, 'mid.dup', new Date()));
    await expect(db.insert(messages).values(msg(s, 'mid.dup', new Date()))).rejects.toThrow();
  });

  it('một conversation duy nhất cho mỗi (page, psid)', async () => {
    const s = await seed();
    await expect(
      db.insert(conversations).values({ tenantId: s.tenant.id, pageId: s.page.id, psid: 'psid-1' }),
    ).rejects.toThrow();
    const again = await db
      .insert(conversations)
      .values({ tenantId: s.tenant.id, pageId: s.page.id, psid: 'psid-1' })
      .onConflictDoNothing()
      .returning();
    expect(again).toHaveLength(0);
  });

  it('sắp theo sent_at dù tin được chèn sai thứ tự', async () => {
    const s = await seed();
    const t = 1_700_000_000_000;
    await db.insert(messages).values(msg(s, 'mid.c', new Date(t + 3000)));
    await db.insert(messages).values(msg(s, 'mid.a', new Date(t + 1000)));
    await db.insert(messages).values(msg(s, 'mid.b', new Date(t + 2000)));
    const rows = await db
      .select({ mid: messages.mid })
      .from(messages)
      .where(eq(messages.conversationId, s.conv.id))
      .orderBy(asc(messages.sentAt));
    expect(rows.map((r) => r.mid)).toEqual(['mid.a', 'mid.b', 'mid.c']);
  });

  it('giữ nguyên độ chính xác mili giây của timestamp', async () => {
    const s = await seed();
    const ms = 1_458_692_752_478; // ví dụ timestamp trong tài liệu Meta
    await db.insert(messages).values(msg(s, 'mid.ms', new Date(ms)));
    const [row] = await db.select().from(messages).where(eq(messages.mid, 'mid.ms'));
    expect(row!.sentAt.getTime()).toBe(ms);
  });

  it('tin chỉ có attachment: text null, attachments lưu dạng JSON', async () => {
    const s = await seed();
    const attachments = [{ type: 'image', payload: { url: 'https://example.com/a.jpg' } }];
    await db.insert(messages).values({ ...msg(s, 'mid.att', new Date(), null), attachments });
    const [row] = await db.select().from(messages).where(eq(messages.mid, 'mid.att'));
    expect(row!.text).toBeNull();
    expect(row!.attachments).toEqual(attachments);
  });

  it('lưu đúng tiếng Việt có dấu', async () => {
    const s = await seed();
    const text = 'Anh muốn mua 20 bộ, ngân sách khoảng 50 triệu, cần trước thứ Sáu.';
    await db.insert(messages).values(msg(s, 'mid.vi', new Date(), text));
    const [row] = await db.select().from(messages).where(eq(messages.mid, 'mid.vi'));
    expect(row!.text).toBe(text);
  });
});

describe('schema cho echo, tương tác và chính sách', () => {
  it('tin mới mặc định là inbound/customer, app_id null; echo lưu được direction, sender_kind, app_id', async () => {
    const s = await seed();
    const [def] = await db.insert(messages).values(msg(s, 'mid.def', new Date())).returning();
    expect(def).toMatchObject({ direction: 'inbound', senderKind: 'customer', appId: null });
    const [echo] = await db
      .insert(messages)
      .values({ ...msg(s, 'mid.echo', new Date()), direction: 'outbound', senderKind: 'page_inbox', appId: '263902037430900' })
      .returning();
    expect(echo).toMatchObject({ direction: 'outbound', senderKind: 'page_inbox', appId: '263902037430900' });
  });

  it('direction và sender_kind chỉ nhận giá trị hợp lệ', async () => {
    const s = await seed();
    await expect(
      handle.pool.query(
        `INSERT INTO messages (tenant_id, page_id, conversation_id, mid, sent_at, source, direction) VALUES ($1,$2,$3,'x',now(),'webhook','sideways')`,
        [s.tenant.id, s.page.id, s.conv.id],
      ),
    ).rejects.toThrow();
    await expect(
      handle.pool.query(
        `INSERT INTO messages (tenant_id, page_id, conversation_id, mid, sent_at, source, sender_kind) VALUES ($1,$2,$3,'y',now(),'webhook','robot')`,
        [s.tenant.id, s.page.id, s.conv.id],
      ),
    ).rejects.toThrow();
  });

  it('hội thoại có hai mốc mới, mặc định null', async () => {
    const s = await seed();
    expect(s.conv.lastUserInteractionAt).toBeNull();
    expect(s.conv.lastPageMessageAt).toBeNull();
  });

  it('page_policy_events: lưu được, khử trùng theo (Page, thời điểm, hành động), reason có thể null', async () => {
    const s = await seed();
    const at = new Date(1_700_000_000_000);
    const base = { tenantId: s.tenant.id, pageId: s.page.id, occurredAt: at };
    await db.insert(pagePolicyEvents).values({ ...base, action: 'warning', reason: 'làm phiền' });
    await expect(db.insert(pagePolicyEvents).values({ ...base, action: 'warning', reason: 'lần gửi lại' })).rejects.toThrow(); // trùng
    await db.insert(pagePolicyEvents).values({ ...base, action: 'unblock', reason: null }); // khác hành động cùng thời điểm: được
    expect(await db.select().from(pagePolicyEvents)).toHaveLength(2);
  });

  it('page_policy_events: khóa ngoại ghép chặn tenant không khớp với Page', async () => {
    const a = await seed('page-a');
    const b = await seed('page-b');
    await expect(
      db.insert(pagePolicyEvents).values({ tenantId: b.tenant.id, pageId: a.page.id, action: 'block', occurredAt: new Date() }),
    ).rejects.toThrow();
  });
});
