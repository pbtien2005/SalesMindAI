/**
 * Hành động giả lập dùng chung cho CLI và API demo: gửi tin "của khách" hoặc tin "của Lan ở Page Inbox" bằng cách
 * dựng payload Meta có chữ ký và gửi vào đúng `/webhook`. Giờ gửi là giờ của đồng hồ demo.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations } from '../db/schema.js';
import { DEMO_PAGE_INBOX_APP_ID, type DemoContext } from './seed.js';
import { customerImagePayload, customerPayload, pageEchoPayload, PERSONAS, sendSigned, type Persona, type WebhookPoster } from './simulator.js';

export interface SimDeps {
  db: Db;
  poster: WebhookPoster;
  appSecret: string;
  ctx: DemoContext;
}

export class SimError extends Error {
  override readonly name = 'SimError';
  constructor(
    message: string,
    readonly code: 'invalid' | 'not_found' = 'invalid',
  ) {
    super(message);
  }
}

const MAX_TEXT = 2000;

/** Tạo hội thoại cho persona nếu chưa có (kèm tên hiển thị). Trả về ID hội thoại. */
export async function ensurePersonaConversation(db: Db, ctx: DemoContext, persona: Persona): Promise<string> {
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.pageId, ctx.pageId), eq(conversations.psid, persona.psid)));
  if (existing) return existing.id;
  const [row] = await db
    .insert(conversations)
    .values({ tenantId: ctx.tenantId, pageId: ctx.pageId, psid: persona.psid, displayName: persona.displayName })
    .onConflictDoNothing({ target: [conversations.pageId, conversations.psid] })
    .returning({ id: conversations.id });
  if (row) return row.id;
  const [again] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.pageId, ctx.pageId), eq(conversations.psid, persona.psid)));
  return again!.id;
}

function checkText(text: string): string {
  const t = text.trim();
  if (t === '') throw new SimError('Tin nhắn trống.');
  if (t.length > MAX_TEXT) throw new SimError(`Tin nhắn quá dài (tối đa ${MAX_TEXT} ký tự).`);
  return t;
}

/** Tìm PSID của một hội thoại thuộc tenant demo. */
async function psidOf(db: Db, ctx: DemoContext, conversationId: string): Promise<string> {
  const [c] = await db
    .select({ psid: conversations.psid })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, ctx.tenantId)));
  if (!c) throw new SimError('Không có hội thoại này.', 'not_found');
  return c.psid;
}

export async function simulateCustomerMessage(
  d: SimDeps,
  target: { persona: string } | { conversationId: string },
  text: string,
  now: Date,
): Promise<{ conversationId: string }> {
  const t = checkText(text);
  let conversationId: string;
  let psid: string;
  if ('persona' in target) {
    const persona = PERSONAS[target.persona];
    if (!persona) throw new SimError(`Không có khách demo "${target.persona}". Có: ${Object.keys(PERSONAS).join(', ')}.`);
    conversationId = await ensurePersonaConversation(d.db, d.ctx, persona);
    psid = persona.psid;
  } else {
    conversationId = target.conversationId;
    psid = await psidOf(d.db, d.ctx, conversationId);
  }
  await sendSigned(d.poster, d.appSecret, customerPayload({ fbPageId: d.ctx.fbPageId, psid, text: t, at: now }));
  return { conversationId };
}

export const DEMO_IMAGE_FILES = ['bill-6000000.png', 'bill-3000000.png', 'sofa.png'] as const;

/** Khách gửi một ảnh mẫu (bill hoặc ảnh sofa). Ảnh nằm ở `demo-assets/` và được phục vụ qua `/api/demo/assets/`. */
export async function simulateCustomerImage(
  d: SimDeps,
  target: { persona: string } | { conversationId: string },
  file: string,
  now: Date,
): Promise<{ conversationId: string }> {
  if (!(DEMO_IMAGE_FILES as readonly string[]).includes(file)) throw new SimError('Ảnh mẫu không hợp lệ.');
  let conversationId: string;
  let psid: string;
  if ('persona' in target) {
    const persona = PERSONAS[target.persona];
    if (!persona) throw new SimError(`Không có khách demo "${target.persona}".`);
    conversationId = await ensurePersonaConversation(d.db, d.ctx, persona);
    psid = persona.psid;
  } else {
    conversationId = target.conversationId;
    psid = await psidOf(d.db, d.ctx, conversationId);
  }
  await sendSigned(d.poster, d.appSecret, customerImagePayload({ fbPageId: d.ctx.fbPageId, psid, url: `/api/demo/assets/${file}`, at: now }));
  return { conversationId };
}

/** Tin do nhân viên (Lan) gõ ở Page Inbox: Meta gửi về dưới dạng echo. */
export async function simulatePageMessage(d: SimDeps, conversationId: string, text: string, now: Date, appId: string = DEMO_PAGE_INBOX_APP_ID): Promise<void> {
  const t = checkText(text);
  const psid = await psidOf(d.db, d.ctx, conversationId);
  await sendSigned(d.poster, d.appSecret, pageEchoPayload({ fbPageId: d.ctx.fbPageId, psid, text: t, at: now, appId }));
}
