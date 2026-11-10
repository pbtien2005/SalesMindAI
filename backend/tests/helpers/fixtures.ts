import { randomBytes, randomUUID } from 'node:crypto';
import { createTokenCrypto } from '../../src/crypto/token-crypto.js';
import type { Db } from '../../src/db/client.js';
import { conversations, extractionRuns, messages, pages, proposals, tenants } from '../../src/db/schema.js';

const crypto = createTokenCrypto(randomBytes(32).toString('base64'));

export interface Base {
  tenantId: string;
  pageId: string;
  conversationId: string;
}

/** Tenant + Page + một hội thoại. `aiEnabled` bật AI cho tenant. */
export async function seedBase(db: Db, o: { aiEnabled?: boolean; psid?: string; fbPageId?: string } = {}): Promise<Base> {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: 'Tenant thử', aiExtractionEnabled: o.aiEnabled ?? false, aiEnabledAt: o.aiEnabled ? new Date('2020-01-01T00:00:00Z') : null })
    .returning();
  const fbPageId = o.fbPageId ?? `page-${randomUUID()}`;
  const [page] = await db
    .insert(pages)
    .values({ tenantId: tenant!.id, fbPageId, name: 'Page thử', tokenEnc: crypto.encrypt('t', fbPageId) })
    .returning();
  const [conv] = await db
    .insert(conversations)
    .values({ tenantId: tenant!.id, pageId: page!.id, psid: o.psid ?? `psid-${randomUUID()}` })
    .returning();
  return { tenantId: tenant!.id, pageId: page!.id, conversationId: conv!.id };
}

/** Thêm một hội thoại khác vào cùng Page. */
export async function addConversation(db: Db, base: Base, psid: string): Promise<Base> {
  const [conv] = await db.insert(conversations).values({ tenantId: base.tenantId, pageId: base.pageId, psid }).returning();
  return { ...base, conversationId: conv!.id };
}

export async function addMessage(
  db: Db,
  base: Base,
  o: { text: string | null; direction?: 'inbound' | 'outbound'; sentAt: Date; mid?: string },
): Promise<string> {
  const direction = o.direction ?? 'inbound';
  const [m] = await db
    .insert(messages)
    .values({
      tenantId: base.tenantId,
      pageId: base.pageId,
      conversationId: base.conversationId,
      mid: o.mid ?? `mid.${randomUUID()}`,
      direction,
      senderKind: direction === 'inbound' ? 'customer' : 'page_inbox',
      text: o.text,
      sentAt: o.sentAt,
      source: 'webhook',
    })
    .returning({ id: messages.id });
  return m!.id;
}

/** Một run để gắn đề xuất vào (test không cần AI thật). */
export async function addRun(db: Db, base: Base, upToMessageId: string, promptVersion = 'test'): Promise<string> {
  const [r] = await db
    .insert(extractionRuns)
    .values({ tenantId: base.tenantId, conversationId: base.conversationId, upToMessageId, promptVersion, model: 'test', status: 'succeeded' })
    .returning({ id: extractionRuns.id });
  return r!.id;
}

export async function addProposal(
  db: Db,
  base: Base,
  runId: string,
  o: {
    field: (typeof proposals.$inferInsert)['field'];
    value?: unknown;
    status?: (typeof proposals.$inferInsert)['status'];
    flags?: string[];
    evidence?: unknown;
  },
): Promise<string> {
  const [p] = await db
    .insert(proposals)
    .values({
      tenantId: base.tenantId,
      conversationId: base.conversationId,
      runId,
      field: o.field,
      value: o.value ?? { text: 'giá trị' },
      evidence: o.evidence ?? [],
      flags: o.flags ?? [],
      status: o.status ?? 'pending',
    })
    .returning({ id: proposals.id });
  return p!.id;
}
