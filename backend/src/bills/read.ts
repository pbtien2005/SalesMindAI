/**
 * Đọc ảnh bill của khách và ghi một khoản thanh toán ĐỀ XUẤT (`payments.status = 'proposed'`).
 * AI chỉ đọc số tiền; việc xác nhận đã nhận tiền là của Sale (`orders/service.ts`).
 * Không log số tiền, nội dung chuyển khoản hay ảnh.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, eq, notExists, sql } from 'drizzle-orm';
import { checkAndReserve, recordUsage, releaseReservation, tenantCap } from '../ai/budget.js';
import type { Db } from '../db/client.js';
import { messages, orders, payments, tenants } from '../db/schema.js';
import { isAllowedMediaUrl } from '../meta/attachments.js';
import type { BillImage, BillReader } from './types.js';

export const DEMO_ASSET_PREFIX = '/api/demo/assets/';
export const DEMO_ASSET_FILES = ['bill-6000000.png', 'bill-3000000.png', 'sofa.png'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type FetchImage = (url: string) => Promise<BillImage | null>;

export interface ReadBillDeps {
  db: Db;
  reader: BillReader;
  /** Thư mục ảnh demo (chỉ dùng khi `demoMode`). */
  assetDir: string;
  demoMode: boolean;
  /** Tải ảnh thật từ máy chủ Facebook (có thể tiêm để test). Mặc định `fetchFacebookImage`. */
  fetchImage?: FetchImage;
  /** Có thì mỗi lần đọc tốn một lượt hạn mức AI ngày của doanh nghiệp. */
  budget?: { defaultCap: number };
  log: { info(o: object, m?: string): void; warn(o: object, m?: string): void };
}

export type ReadBillResult = { status: 'created' | 'skipped'; reason?: string };

/** Tải ảnh từ CDN của Facebook: chỉ https tới máy chủ cho phép, không theo chuyển hướng, giới hạn kích thước và thời gian. */
export const fetchFacebookImage: FetchImage = async (url) => {
  if (!isAllowedMediaUrl(url)) return null;
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ảnh`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
  const mediaType = type === 'image/png' ? 'image/png' : type === 'image/jpeg' ? 'image/jpeg' : null;
  if (!mediaType) return null;
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > MAX_IMAGE_BYTES) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.byteLength > MAX_IMAGE_BYTES ? null : { bytes: buf, mediaType };
};

async function loadImage(deps: ReadBillDeps, url: string): Promise<BillImage | null> {
  if (url.startsWith(DEMO_ASSET_PREFIX)) {
    if (!deps.demoMode) return null; // URL demo chỉ có nghĩa ở chế độ demo
    const file = url.slice(DEMO_ASSET_PREFIX.length);
    if (!(DEMO_ASSET_FILES as readonly string[]).includes(file)) return null;
    return { bytes: new Uint8Array(await readFile(join(deps.assetDir, file))), mediaType: 'image/png' };
  }
  return (deps.fetchImage ?? fetchFacebookImage)(url);
}

/** URL ảnh đầu tiên trong `attachments` (loại image), hoặc null. */
export function firstImageUrl(attachments: unknown): string | null {
  if (!Array.isArray(attachments)) return null;
  for (const a of attachments) {
    const o = a as { type?: unknown; payload?: { url?: unknown } } | null;
    if (o?.type === 'image' && typeof o.payload?.url === 'string') return o.payload.url;
  }
  return null;
}

export async function readBill(deps: ReadBillDeps, messageId: string, now: Date): Promise<ReadBillResult> {
  const { db } = deps;
  const [m] = await db
    .select({
      id: messages.id,
      tenantId: messages.tenantId,
      conversationId: messages.conversationId,
      direction: messages.direction,
      attachments: messages.attachments,
      aiEnabled: tenants.aiExtractionEnabled,
    })
    .from(messages)
    .innerJoin(tenants, eq(tenants.id, messages.tenantId))
    .where(eq(messages.id, messageId));
  if (!m) return { status: 'skipped', reason: 'message_missing' };
  if (m.direction !== 'inbound') return { status: 'skipped', reason: 'not_customer' };
  if (!m.aiEnabled) return { status: 'skipped', reason: 'ai_disabled' };
  const url = firstImageUrl(m.attachments);
  if (!url) return { status: 'skipped', reason: 'no_image' };
  const [done] = await db.select({ id: payments.id }).from(payments).where(eq(payments.messageId, m.id));
  if (done) return { status: 'skipped', reason: 'already_done' };

  const image = await loadImage(deps, url);
  if (!image) return { status: 'skipped', reason: 'image_unavailable' };

  if (deps.budget) {
    const cap = await tenantCap(db, m.tenantId, deps.budget.defaultCap);
    if (!(await checkAndReserve(db, m.tenantId, now, cap)).allowed) return { status: 'skipped', reason: 'budget_exhausted' };
  }
  let outcome;
  try {
    outcome = await deps.reader.read(image);
  } catch (e) {
    if (deps.budget) await releaseReservation(db, m.tenantId, now);
    throw e;
  }
  if (deps.budget && outcome.usage) await recordUsage(db, m.tenantId, outcome.usage, now);

  const [open] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.conversationId, m.conversationId), eq(orders.tenantId, m.tenantId), eq(orders.status, 'awaiting_deposit')))
    .limit(1);
  const read = outcome.kind === 'ok' ? outcome : null;
  const rows = await db
    .insert(payments)
    .values({
      tenantId: m.tenantId,
      conversationId: m.conversationId,
      orderId: open?.id ?? null,
      messageId: m.id,
      readOk: read !== null,
      amountVnd: read?.amountVnd ?? null,
      transferNote: read?.transferNote ?? null,
      billTime: read?.billTime ?? null,
      bbox: read?.bbox ?? null,
      readModel: deps.reader.model,
    })
    .onConflictDoNothing({ target: payments.messageId })
    .returning({ id: payments.id });
  deps.log.info({ bill: { messageId: m.id, kind: outcome.kind, model: deps.reader.model, created: rows.length } }, 'đã đọc ảnh bill');
  return rows.length === 1 ? { status: 'created' } : { status: 'skipped', reason: 'already_done' };
}

/** Đọc mọi ảnh của khách trong hội thoại chưa có khoản thanh toán (tối đa 5 mỗi lần, cũ nhất trước). */
export async function readPendingBills(deps: ReadBillDeps, conversationId: string, now: Date): Promise<number> {
  const rows = await deps.db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, 'inbound'),
        sql`${messages.attachments} is not null`,
        notExists(deps.db.select({ one: sql`1` }).from(payments).where(eq(payments.messageId, messages.id))),
      ),
    )
    .orderBy(asc(messages.sentAt))
    .limit(5);
  let created = 0;
  for (const r of rows) if ((await readBill(deps, r.id, now)).status === 'created') created += 1;
  return created;
}

