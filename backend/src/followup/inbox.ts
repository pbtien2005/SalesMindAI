/**
 * Một trang hộp thư: sắp theo `last_message_at` mới nhất (hội thoại chưa có tin ở cuối), phân trang bằng con trỏ
 * (keyset), KHÔNG dùng OFFSET nên tin mới chen vào giữa lúc đang lật trang không làm trùng hay sót dòng.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations } from '../db/schema.js';
import { loadSummariesFor, type ConversationSummary } from './overview.js';

export interface InboxQuery {
  pageId?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

interface Cursor {
  /** `last_message_at` của dòng cuối trang trước (ISO), hoặc null nếu hội thoại chưa có tin. */
  t: string | null;
  id: string;
}

export const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(raw: string): Cursor | null {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    const okId = typeof c.id === 'string' && /^[0-9a-f-]{36}$/.test(c.id);
    const okT = c.t === null || (typeof c.t === 'string' && !Number.isNaN(Date.parse(c.t)));
    return okId && okT ? c : null;
  } catch {
    return null;
  }
}

export async function loadInboxPage(db: Db, tenantId: string, now: Date, q: InboxQuery): Promise<{ conversations: ConversationSummary[]; nextCursor: string | null }> {
  const cur = q.cursor ? decodeCursor(q.cursor) : null;
  if (q.cursor && !cur) throw new RangeError('cursor');
  const conds = [eq(conversations.tenantId, tenantId)];
  if (q.pageId) conds.push(eq(conversations.pageId, q.pageId));
  if (cur) {
    conds.push(
      cur.t === null
        ? sql`(${conversations.lastMessageAt} IS NULL AND ${conversations.id} < ${cur.id})`
        : sql`(${conversations.lastMessageAt} < ${cur.t}::timestamptz OR ${conversations.lastMessageAt} IS NULL OR (${conversations.lastMessageAt} = ${cur.t}::timestamptz AND ${conversations.id} < ${cur.id}))`,
    );
  }
  const rows = await db
    .select()
    .from(conversations)
    .where(and(...conds))
    .orderBy(sql`${conversations.lastMessageAt} DESC NULLS LAST`, sql`${conversations.id} DESC`)
    .limit(q.limit + 1);
  const more = rows.length > q.limit;
  const pageRows = more ? rows.slice(0, q.limit) : rows;
  const last = pageRows.at(-1);
  const summaries = await loadSummariesFor(db, tenantId, now, pageRows);
  // Giữ đúng thứ tự keyset của trang (summarize có thể sắp lại).
  const order = new Map(pageRows.map((r, i) => [r.id, i]));
  summaries.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
  return {
    conversations: summaries,
    nextCursor: more && last ? encodeCursor({ t: last.lastMessageAt ? last.lastMessageAt.toISOString() : null, id: last.id }) : null,
  };
}
