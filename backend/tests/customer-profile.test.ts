import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTokenCrypto } from '../src/crypto/token-crypto.js';
import { conversations, messages, pages, tenants } from '../src/db/schema.js';
import { toAttachmentViews } from '../src/meta/attachments.js';
import { fillCustomerNames } from '../src/meta/profiles.js';
import { GraphClient } from '../src/meta/graph-client.js';
import { loadConversationDetail } from '../src/api/read-models.js';
import { API_VERSION, FB_APP_ID, FB_APP_SECRET, makeFakeFetch, metaError } from './helpers/fake-meta.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
const crypto = createTokenCrypto(randomBytes(32).toString('base64'));
const NOW = new Date('2026-11-11T03:00:00Z');
const log = { warn: () => undefined };

afterAll(() => handle.close());

async function seed(psids: string[], tokenEnc?: string) {
  const [t] = await db.insert(tenants).values({ name: 'T' }).returning({ id: tenants.id });
  const [p] = await db.insert(pages).values({ tenantId: t!.id, fbPageId: 'pg1', name: 'P', tokenEnc: tokenEnc ?? crypto.encrypt('PAGE_TOKEN', 'pg1') }).returning({ id: pages.id });
  const ids: string[] = [];
  for (const psid of psids) {
    const [c] = await db.insert(conversations).values({ tenantId: t!.id, pageId: p!.id, psid }).returning({ id: conversations.id });
    ids.push(c!.id);
  }
  return { tenantId: t!.id, pageId: p!.id, ids };
}

function graphWith(handler: Parameters<typeof makeFakeFetch>[0]) {
  const fake = makeFakeFetch(handler);
  return { graph: new GraphClient({ appId: FB_APP_ID, appSecret: FB_APP_SECRET, apiVersion: API_VERSION, fetch: fake.fetch }), fake };
}

describe('tên khách từ Graph', () => {
  beforeEach(async () => truncateAll(handle));

  it('điền tên cho hội thoại chưa có tên, làm sạch ký tự điều khiển', async () => {
    const { ids } = await seed(['psid-a']);
    const { graph } = graphWith(() => ({ body: { name: '  Nguyễn Văn A\u0000\n ', id: 'psid-a' } }));
    const r = await fillCustomerNames(db, graph, crypto, ids, log);
    expect(r).toEqual({ filled: 1, failed: 0 });
    const [c] = await db.select().from(conversations).where(eq(conversations.id, ids[0]!));
    expect(c!.displayName).toBe('Nguyễn Văn A');
  });

  it('không ghi đè tên đã có và không gọi Meta cho hội thoại demo', async () => {
    const { ids, tenantId } = await seed(['psid-b', 'demo-psid-x']);
    await db.update(conversations).set({ displayName: 'Tên cũ' }).where(eq(conversations.id, ids[0]!));
    const { graph, fake } = graphWith(() => ({ body: { name: 'Tên mới' } }));
    const r = await fillCustomerNames(db, graph, crypto, ids, log);
    expect(r.filled).toBe(0);
    expect(fake.calls.length).toBe(0);
    const [c] = await db.select().from(conversations).where(eq(conversations.id, ids[0]!));
    expect(c!.displayName).toBe('Tên cũ');
    expect(tenantId).toBeTruthy();
  });

  it('Meta lỗi chỉ được đếm, không ném và không để token trong log', async () => {
    const { ids } = await seed(['psid-c']);
    const warns: unknown[] = [];
    const { graph } = graphWith(() => metaError(100, 'lỗi PAGE_TOKEN'));
    const r = await fillCustomerNames(db, graph, crypto, ids, { warn: (o) => void warns.push(o) });
    expect(r).toEqual({ filled: 0, failed: 1 });
    expect(JSON.stringify(warns)).not.toContain('PAGE_TOKEN');
    const [c] = await db.select().from(conversations).where(eq(conversations.id, ids[0]!));
    expect(c!.displayName).toBeNull();
  });

  it('Page đã ngắt kết nối thì bỏ qua', async () => {
    const { ids, pageId } = await seed(['psid-d']);
    await db.update(pages).set({ status: 'disconnected', tokenEnc: '' }).where(eq(pages.id, pageId));
    const { graph, fake } = graphWith(() => ({ body: { name: 'X' } }));
    expect((await fillCustomerNames(db, graph, crypto, ids, log)).filled).toBe(0);
    expect(fake.calls.length).toBe(0);
  });
});

describe('tệp đính kèm', () => {
  it('chỉ cho URL https của máy chủ Facebook', () => {
    const v = toAttachmentViews([
      { type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/v/a.jpg?x=1' } },
      { type: 'image', payload: { url: 'https://evil.example.com/a.jpg' } },
      { type: 'image', payload: { url: 'http://scontent.xx.fbcdn.net/a.jpg' } },
      { type: 'image', payload: { url: 'https://fbcdn.net.evil.com/a.jpg' } },
      { type: 'image', payload: { url: 'https://user:pw@scontent.xx.fbcdn.net/a.jpg' } },
      { type: 'weird', payload: {} },
      'rác',
    ]);
    expect(v.map((a) => a.url !== null)).toEqual([true, false, false, false, false, false, false]);
    expect(v[5]!.type).toBe('other');
    expect(toAttachmentViews('không phải mảng')).toEqual([]);
  });

  it('chi tiết hội thoại trả attachments đã lọc', async () => {
    await truncateAll(handle);
    const { ids, tenantId, pageId } = await seed(['psid-e']);
    await db.insert(messages).values({
      tenantId, pageId, conversationId: ids[0]!, mid: 'm1', direction: 'inbound', senderKind: 'customer', text: null, sentAt: NOW, source: 'webhook',
      attachments: [{ type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/a.jpg' } }],
    });
    const d = await loadConversationDetail(db, tenantId, ids[0]!, NOW);
    expect(d!.messages[0]).toMatchObject({ hasAttachment: true, attachments: [{ type: 'image', url: 'https://scontent.xx.fbcdn.net/a.jpg' }] });
  });
});
