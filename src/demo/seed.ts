/**
 * Dữ liệu nền cho demo và `demo:reset`. Chỉ đụng tới tenant demo (tìm theo tên), không bao giờ xóa tenant khác.
 * Toàn bộ nội dung là câu TỰ VIẾT, không phải dữ liệu khách thật.
 */
import { eq, sql } from 'drizzle-orm';
import type { TokenCrypto } from '../crypto/token-crypto.js';
import type { Db } from '../db/client.js';
import { conversations, messages, pages, tasks, tenants } from '../db/schema.js';
import { OfflineExtractor } from '../extraction/offline-extractor.js';
import { runExtraction } from '../extraction/run.js';
import { setClockTo } from './clock.js';
import { PERSONAS, type Persona } from './simulator.js';

export const DEMO_TENANT_NAME = 'Nội thất Minh Phát (demo)';
export const DEMO_FB_PAGE_ID = 'demo-page-minh-phat';
/** app_id của Page Inbox dùng cho tin do Lan gõ (khớp mặc định `PAGE_INBOX_APP_IDS`). */
export const DEMO_PAGE_INBOX_APP_ID = '263902037430900';

/** Thứ Năm 12/11/2026 09:00 giờ Việt Nam (UTC+7). */
export const DEMO_START = new Date(Date.UTC(2026, 10, 12, 2, 0));

/** Đổi giờ Việt Nam (UTC+7) sang Date. */
export const vn = (y: number, m: number, d: number, h: number, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 7, min));

export interface DemoContext {
  tenantId: string;
  pageId: string;
  fbPageId: string;
}

export async function getDemoContext(db: Db): Promise<DemoContext | null> {
  const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.name, DEMO_TENANT_NAME));
  if (!t) return null;
  const [p] = await db.select({ id: pages.id, fbPageId: pages.fbPageId }).from(pages).where(eq(pages.tenantId, t.id));
  return p ? { tenantId: t.id, pageId: p.id, fbPageId: p.fbPageId } : null;
}

/** Xóa mọi dữ liệu của tenant demo theo thứ tự khóa ngoại. */
async function wipeDemoTenant(db: Db, tenantId: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [
      'profile_fields',
      'proposals',
      'extraction_runs',
      'tasks',
      'followup_state',
      'messages',
      'conversations',
      'page_policy_events',
      'pages',
      'oauth_states',
    ]) {
      await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`);
    }
    await tx.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}`);
  });
}

type SeedMsg = { dir: 'in' | 'out'; at: Date; text: string };

interface SeedCustomer {
  persona: Persona;
  messages: SeedMsg[];
  task?: { title: string; dueAt: Date };
}

const CUSTOMERS: SeedCustomer[] = [
  {
    // Khách có tín hiệu thanh toán, chưa ai trả lời: P1.
    persona: PERSONAS.thu!,
    messages: [
      { dir: 'in', at: vn(2026, 11, 11, 14, 0), text: 'Chị xem mẫu sofa góc L giúp chị nhé' },
      { dir: 'out', at: vn(2026, 11, 11, 14, 20), text: 'Dạ em gửi chị mẫu sofa góc L ạ' },
      { dir: 'in', at: vn(2026, 11, 12, 8, 40), text: 'Chị muốn hỏi cách thanh toán đơn sofa, chuyển khoản vào đâu vậy em?' },
    ],
  },
  {
    persona: PERSONAS.duc!,
    messages: [
      { dir: 'in', at: vn(2026, 11, 10, 10, 0), text: 'Báo giá giúp anh bộ bàn ăn 6 ghế' },
      { dir: 'out', at: vn(2026, 11, 10, 10, 30), text: 'Dạ em gửi anh báo giá bộ bàn ăn 6 ghế, 18 triệu ạ' },
      { dir: 'in', at: vn(2026, 11, 11, 16, 0), text: 'Anh xem rồi, để anh cân nhắc nhé' },
    ],
    task: { title: 'Gọi lại báo giá', dueAt: vn(2026, 11, 12, 8, 0) },
  },
  {
    persona: PERSONAS.ngoc!,
    messages: [
      { dir: 'in', at: vn(2026, 11, 10, 9, 0), text: 'Chị muốn xem bộ ghế ăn mã GA-05' },
      { dir: 'out', at: vn(2026, 11, 10, 9, 15), text: 'Dạ bộ ghế ăn GA-05 giá 6 triệu ạ' },
      { dir: 'in', at: vn(2026, 11, 11, 17, 0), text: 'Ok em, chị sẽ báo lại sau nhé' },
    ],
    task: { title: 'Nhắc thanh toán', dueAt: vn(2026, 11, 12, 8, 30) },
  },
  {
    // Bám 4/5 lúc 09:00 Thứ Năm; đủ 5/5 sau 09:00 Thứ Sáu.
    persona: PERSONAS.mai!,
    messages: [
      { dir: 'in', at: vn(2026, 11, 7, 10, 0), text: 'Cô muốn xem báo giá bộ sofa góc' },
      { dir: 'out', at: vn(2026, 11, 8, 8, 50), text: 'Dạ em gửi cô báo giá bộ sofa góc 25 triệu ạ' },
    ],
  },
];

export interface ResetDeps {
  db: Db;
  crypto: TokenCrypto;
  log: { info(o: object, m?: string): void; warn(o: object, m?: string): void };
  /** Giờ thật dùng để đặt đồng hồ demo (test truyền cố định). */
  realNow?: Date;
}

/**
 * Đưa demo về trạng thái ban đầu: xóa tenant demo cũ, tạo lại tenant + Page giả + 4 khách nền, trích xuất AI cho
 * các tin nền (qua đúng đường chạy thật, chế độ offline), và đặt đồng hồ về Thứ Năm 12/11/2026 09:00.
 * Chạy lại nhiều lần cho cùng kết quả.
 */
export async function resetDemo(deps: ResetDeps): Promise<DemoContext & { clockNow: Date }> {
  const { db, crypto } = deps;
  const realNow = deps.realNow ?? new Date();

  const existing = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.name, DEMO_TENANT_NAME));
  for (const t of existing) await wipeDemoTenant(db, t.id);

  // aiEnabledAt xa trong quá khứ: tin nền (giờ demo) không bị coi là "trước lúc bật AI".
  const [tenant] = await db
    .insert(tenants)
    .values({ name: DEMO_TENANT_NAME, aiExtractionEnabled: true, aiEnabledAt: new Date('2020-01-01T00:00:00Z') })
    .returning({ id: tenants.id });
  const [page] = await db
    .insert(pages)
    .values({
      tenantId: tenant!.id,
      fbPageId: DEMO_FB_PAGE_ID,
      name: 'Nội thất Minh Phát (Page demo)',
      tokenEnc: crypto.encrypt('demo-token-khong-dung-that', DEMO_FB_PAGE_ID),
      subscribedAt: realNow,
    })
    .returning({ id: pages.id });
  const ctx: DemoContext = { tenantId: tenant!.id, pageId: page!.id, fbPageId: DEMO_FB_PAGE_ID };

  let n = 0;
  const convIds: string[] = [];
  for (const c of CUSTOMERS) {
    const inbound = c.messages.filter((m) => m.dir === 'in');
    const outbound = c.messages.filter((m) => m.dir === 'out');
    const max = (xs: SeedMsg[]) => (xs.length ? new Date(Math.max(...xs.map((m) => m.at.getTime()))) : null);
    const [conv] = await db
      .insert(conversations)
      .values({
        tenantId: ctx.tenantId,
        pageId: ctx.pageId,
        psid: c.persona.psid,
        displayName: c.persona.displayName,
        lastMessageAt: max(c.messages),
        lastUserInteractionAt: max(inbound),
        lastPageMessageAt: max(outbound),
      })
      .returning({ id: conversations.id });
    convIds.push(conv!.id);
    await db.insert(messages).values(
      c.messages.map((m) => ({
        tenantId: ctx.tenantId,
        pageId: ctx.pageId,
        conversationId: conv!.id,
        mid: `demo.seed.${++n}`,
        direction: m.dir === 'in' ? ('inbound' as const) : ('outbound' as const),
        senderKind: m.dir === 'in' ? ('customer' as const) : ('page_inbox' as const),
        appId: m.dir === 'out' ? DEMO_PAGE_INBOX_APP_ID : null,
        text: m.text,
        sentAt: m.at,
        source: 'webhook' as const,
      })),
    );
    if (c.task) {
      await db.insert(tasks).values({ tenantId: ctx.tenantId, conversationId: conv!.id, title: c.task.title, dueAt: c.task.dueAt, source: 'seed' });
    }
  }

  // Trích xuất tin nền qua đúng pipeline (offline: tất định, không gọi mạng). Chỉ GIỮ tín hiệu mua (để chị Thu
  // là P1): các trường khác của khách nền bị đánh `superseded` để số liệu AI ở Trang chủ chỉ đếm những gì AI
  // làm TRONG buổi demo (bắt đầu từ 0).
  const extractor = new OfflineExtractor();
  for (const id of convIds) await runExtraction({ db, extractor, log: deps.log, contextMessages: 30 }, id);
  await db.execute(
    sql`UPDATE proposals SET status = 'superseded' WHERE tenant_id = ${ctx.tenantId} AND field NOT IN ('message_purpose', 'intent')`,
  );

  const clockNow = await setClockTo(db, DEMO_START, realNow);
  deps.log.info({ demo: { tenantId: ctx.tenantId, conversations: convIds.length } }, 'đã dựng lại dữ liệu demo');
  return { ...ctx, clockNow };
}
