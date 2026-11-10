import { and, eq } from 'drizzle-orm';
import type { BackfillState } from '../backfill/backfill.js';
import { backfillOverview, isBackfillRunning } from '../backfill/status.js';
import { assessQueueHealth } from '../queue/monitor.js';
import { resubscribePages } from '../auth/resubscribe.js';
import { createTokenCrypto } from '../crypto/token-crypto.js';
import { GraphClient } from '../meta/graph-client.js';
import { parseBackfillArgs, parseDecideArgs, parseRedriveArgs, parseDemoSendArgs, parseDemoClockArgs } from './args.js';
import { ensurePersonaConversation, simulateCustomerMessage, simulatePageMessage, SimError } from '../demo/actions.js';
import { advanceClock, advanceClockTo, getNow } from '../demo/clock.js';
import { getDemoContext, resetDemo } from '../demo/seed.js';
import { PERSONAS, type WebhookPoster } from '../demo/simulator.js';
import { decideProposal, listPending, ProposalError } from '../extraction/proposals.js';
import { queueOverview, redriveDeadLetter } from '../queue/admin.js';
import { newConnectUrl, createTenant, listTenants, tenantExists } from '../auth/tenants.js';
import { extractionStatus, setAiEnabled } from '../extraction/admin.js';
import { createExtractor } from '../extraction/factory.js';
import { runExtraction } from '../extraction/run.js';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { conversations, pages, proposals } from '../db/schema.js';
import {
  BACKFILL_CONVERSATION_QUEUE,
  BACKFILL_DEAD_QUEUE,
  BACKFILL_PAGE_QUEUE,
  createBackfillQueue,
  createBoss,
} from '../queue/boss.js';

const USAGE = `Dùng: npm run cli -- <lệnh>

  tenant:create <tên>         Tạo doanh nghiệp (tenant) và in liên kết kết nối Page
  tenant:connect-url <id>     Tạo liên kết kết nối Page mới cho tenant đã có
  tenant:list                 Liệt kê tenant và số Page đã kết nối
  backfill [<fbPageId>] [--force]  Đưa việc lấy lại tin cũ vào hàng đợi (mọi Page đang dùng được, hoặc một Page).
                              Bỏ qua Page đang có backfill chạy dở, trừ khi dùng --force
  backfill:status             Xem tiến độ backfill và độ sâu hàng đợi
  pages:resubscribe [<fbPageId>]  Đăng ký lại webhook (danh sách field hiện hành) cho Page đã kết nối.
                              Cần sau khi danh sách field đổi, vì Page cũ chỉ nhận các field lúc kết nối
  queue:status                Xem độ sâu mọi hàng đợi (webhook, backfill, trích xuất, dead-letter) và cảnh báo
  queue:redrive <webhook|backfill|extraction> [--limit N] [--dry-run]
                              Đưa job trong dead-letter về hàng đợi gốc để xử lý lại (sau khi đã sửa nguyên nhân)
  ai:enable <tenantId>        Bật AI trích xuất cho tenant (tin trước lúc bật không tự được trích)
  ai:disable <tenantId>       Tắt AI trích xuất cho tenant
  extract:run <conversationId>  Chạy trích xuất cho một hội thoại ngay (đồng bộ, theo AI_MODE hiện hành)
  extract:status              Số lần trích xuất theo trạng thái và lý do lỗi
  user:create <email> <tên> --tenant <id> --role <owner|manager|sale>
                              Tạo tài khoản đăng nhập (mật khẩu đọc từ stdin hoặc nhập khi được hỏi qua --password-stdin)
  user:reset-password <email> Đặt mật khẩu mới (đọc từ stdin), thu hồi mọi phiên của người đó
  demo:reset                  (DEMO_MODE) Dựng lại dữ liệu demo và đặt đồng hồ về Thứ Năm 12/11/2026 09:00
  demo:send <persona> <nội dung> [--page]
                              (DEMO_MODE) Gửi tin giả có ký tên vào server đang chạy (persona: minh, thu, duc, ngoc, mai).
                              --page: gửi như Lan gõ ở Page Inbox
  demo:clock [--advance <phút>] [--to <ISO>]   (DEMO_MODE) Xem hoặc tua đồng hồ demo
  proposals:list <conversationId>   Đề xuất đang chờ của một hội thoại
  proposals:decide <proposalId> <accept|edit|dismiss> --by <tên> [--text <giá trị sửa>] [--at <ISO có múi giờ>]
                              Duyệt, sửa hoặc bỏ qua một đề xuất. Mốc thời gian mơ hồ bắt buộc có --at (ngày giờ Sale chọn)

Lệnh backfill chỉ xếp việc vào hàng đợi; server (npm run dev) mới là nơi xử lý. Meta chỉ cho lấy chi
tiết 20 tin gần nhất của mỗi hội thoại nên đây không phải là khôi phục toàn bộ lịch sử.

Liên kết kết nối dùng được MỘT lần và hết hạn sau 10 phút. Gửi cho người quản lý Page,
họ mở bằng trình duyệt và đăng nhập Facebook để cấp quyền.`;

/** Đọc một dòng từ stdin (mật khẩu không đi qua tham số dòng lệnh để khỏi lọt vào lịch sử shell). */
async function readStdinLine(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('Đưa mật khẩu qua stdin, ví dụ: echo "mật-khẩu" | npm run cli -- user:create ...');
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  const line = data.split(/\r?\n/)[0] ?? '';
  if (!line) throw new Error('Không đọc được mật khẩu từ stdin.');
  return line;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  const env = loadEnv();
  const { db, close } = createDb(env.DATABASE_URL, { max: 2 });
  try {
    switch (command) {
      case 'tenant:create': {
        const name = args.join(' ');
        const tenant = await createTenant(db, name);
        console.log(`Đã tạo tenant "${tenant.name}" (${tenant.id}).`);
        console.log('Liên kết kết nối Page (một lần, 10 phút):');
        console.log(await newConnectUrl(db, env.PUBLIC_BASE_URL, tenant.id));
        return 0;
      }
      case 'tenant:connect-url': {
        const id = args[0];
        if (!id) throw new Error('Thiếu ID tenant.');
        if (!(await tenantExists(db, id))) throw new Error(`Không có tenant ${id}.`);
        console.log(await newConnectUrl(db, env.PUBLIC_BASE_URL, id));
        return 0;
      }
      case 'user:create': {
        const { parseArgs } = await import('node:util');
        const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { tenant: { type: 'string' }, role: { type: 'string' } }, strict: true });
        const [email, ...nameParts] = positionals;
        if (!email || nameParts.length === 0) throw new Error('Cú pháp: user:create <email> <tên> --tenant <id> --role <owner|manager|sale>');
        if (!values.tenant || !(await tenantExists(db, values.tenant))) throw new Error('Thiếu hoặc sai --tenant.');
        if (!values.role || !['owner', 'manager', 'sale'].includes(values.role)) throw new Error('--role phải là owner, manager hoặc sale.');
        const password = await readStdinLine();
        const { createUser } = await import('../auth/users.js');
        const { userId } = await createUser(db, { email, password, displayName: nameParts.join(' '), tenantId: values.tenant, role: values.role as 'owner' | 'manager' | 'sale', emailVerified: true }, new Date());
        console.log(`Đã tạo tài khoản ${email} (${userId}), vai trò ${values.role}.`);
        return 0;
      }
      case 'user:reset-password': {
        const email = args[0];
        if (!email) throw new Error('Thiếu email.');
        const { findUserByEmail, setPassword } = await import('../auth/users.js');
        const u = await findUserByEmail(db, email);
        if (!u) throw new Error('Không có người dùng này.');
        await setPassword(db, u.id, await readStdinLine());
        console.log('Đã đặt mật khẩu mới và thu hồi mọi phiên.');
        return 0;
      }
      case 'tenant:list': {
        const rows = await listTenants(db);
        if (rows.length === 0) console.log('Chưa có tenant nào.');
        for (const r of rows) console.log(`${r.id}  ${r.pages} Page  ${r.name}`);
        return 0;
      }
      case 'backfill': {
        const { force, fbPageId: target } = parseBackfillArgs(args);
        const rows = await db
          .select({ id: pages.id, fbPageId: pages.fbPageId, name: pages.name, state: pages.backfillState })
          .from(pages)
          .where(target ? and(eq(pages.status, 'active'), eq(pages.fbPageId, target)) : eq(pages.status, 'active'));
        if (rows.length === 0) {
          throw new Error(target ? `Không có Page đang dùng được với ID ${target}.` : 'Chưa có Page nào đang dùng được.');
        }
        const boss = await createBoss(env.DATABASE_URL);
        try {
          const queue = createBackfillQueue(boss);
          for (const p of rows) {
            if (!force && isBackfillRunning(p.state as BackfillState | null)) {
              console.log(`Bỏ qua Page "${p.name}" (${p.fbPageId}): backfill đang chạy. Dùng --force nếu chắc chắn muốn chạy chồng.`);
              continue;
            }
            const queued = await queue.enqueuePage({ pageId: p.id });
            console.log(
              queued
                ? `Đã xếp backfill cho Page "${p.name}" (${p.fbPageId}).`
                : `Page "${p.name}" (${p.fbPageId}) đã có việc backfill đang chờ, không xếp thêm.`,
            );
          }
        } finally {
          await boss.stop({ graceful: true, timeout: 5000 });
        }
        console.log('Server (npm run dev) sẽ xử lý. Xem tiến độ: npm run cli -- backfill:status');
        return 0;
      }
      case 'backfill:status': {
        const rows = await backfillOverview(db);
        if (rows.length === 0) console.log('Chưa có Page nào.');
        for (const r of rows) {
          const s = r.state;
          const st = s ? `${s.status}, ${s.conversationsEnqueued} hội thoại, cập nhật ${s.updatedAt}${s.reason ? `, lý do: ${s.reason}` : ''}` : 'chưa chạy';
          console.log(`${r.name} (${r.fbPageId}) [token ${r.status}] backfill: ${st}; đã lưu từ backfill: ${r.stored} tin`);
        }
        const boss = await createBoss(env.DATABASE_URL);
        try {
          for (const q of [BACKFILL_PAGE_QUEUE, BACKFILL_CONVERSATION_QUEUE, BACKFILL_DEAD_QUEUE]) {
            const [st] = await boss.getQueueStats(q, { force: true }); // force: không dùng cache (có thể trễ tới ~1 giờ)
            console.log(`Hàng đợi ${q} (số liệu có thể trễ tới ~1 phút): chờ ${st?.queuedCount ?? 0}, đang chạy ${st?.activeCount ?? 0}, lỗi ${st?.failedCount ?? 0}`);
          }
        } finally {
          await boss.stop({ graceful: true, timeout: 5000 });
        }
        return 0;
      }
      case 'pages:resubscribe': {
        const fbPageId = args.find((a) => !a.startsWith('--'));
        const graph = new GraphClient({ apiVersion: env.GRAPH_API_VERSION, appId: env.FB_APP_ID, appSecret: env.APP_SECRET });
        const outcomes = await resubscribePages({ db, graph, crypto: createTokenCrypto(env.TOKEN_ENC_KEY) }, fbPageId);
        if (outcomes.length === 0) {
          throw new Error(fbPageId ? `Không có Page đang dùng được với ID ${fbPageId}.` : 'Chưa có Page nào đang dùng được.');
        }
        for (const o of outcomes) {
          const msg =
            o.status === 'subscribed'
              ? 'đã đăng ký lại'
              : o.status === 'token_invalid'
                ? 'token không hợp lệ (190), cần kết nối lại Page bằng liên kết mới'
                : `THẤT BẠI (mã Meta ${o.graphCode ?? 'không rõ'})`;
          console.log(`${o.name} (${o.fbPageId}): ${msg}`);
        }
        return outcomes.every((o) => o.status === 'subscribed') ? 0 : 2;
      }
      case 'queue:status': {
        const boss = await createBoss(env.DATABASE_URL);
        try {
          const health = assessQueueHealth(await queueOverview(boss));
          for (const q of health.queues) {
            console.log(`${q.name.padEnd(28)} chờ ${q.queued}, đang chạy ${q.active}, lỗi ${q.failed}`);
          }
          console.log('(số liệu có thể trễ tới ~1 phút)');
          if (health.problems.length === 0) console.log('Không có vấn đề.');
          for (const p of health.problems) console.log(`CHÚ Ý: ${p}`);
          return health.problems.length === 0 ? 0 : 2;
        } finally {
          await boss.stop({ graceful: true, timeout: 5000 });
        }
      }
      case 'queue:redrive': {
        const { target, limit, dryRun } = parseRedriveArgs(args);
        const boss = await createBoss(env.DATABASE_URL);
        try {
          const r = await redriveDeadLetter(boss, target, { ...(limit ? { limit } : {}), dryRun });
          console.log(
            r.dryRun
              ? `[thử] Sẽ chuyển ${r.jobs} job của ${r.target} về hàng đợi gốc (${r.unroutable} job không có queue nguồn).`
              : `Đã chuyển ${r.jobs} job của ${r.target} về hàng đợi gốc. Server sẽ xử lý lại.`,
          );
          if (r.unroutable > 0) {
            console.log(`CHÚ Ý: ${r.unroutable} job không có queue nguồn nên không chuyển được, vẫn nằm trong dead-letter.`);
          }
          return 0;
        } finally {
          await boss.stop({ graceful: true, timeout: 5000 });
        }
      }
      case 'ai:enable':
      case 'ai:disable': {
        const id = args[0];
        if (!id) throw new Error('Thiếu ID tenant.');
        const enabled = command === 'ai:enable';
        if (!(await setAiEnabled(db, id, enabled))) throw new Error(`Không có tenant ${id}.`);
        console.log(enabled ? `Đã bật AI trích xuất cho tenant ${id} (chế độ ${env.AI_MODE}).` : `Đã tắt AI trích xuất cho tenant ${id}.`);
        if (enabled && env.AI_MODE === 'live') {
          console.log('CHÚ Ý: AI_MODE=live gửi nội dung chat ra API nước ngoài. Chỉ dùng cho khách thật sau khi kiểm tra pháp lý.');
        }
        return 0;
      }
      case 'extract:run': {
        const id = args[0];
        if (!id) throw new Error('Thiếu ID hội thoại.');
        const r = await runExtraction(
          { db, extractor: createExtractor(env), log: { info: () => undefined, warn: (o) => console.warn(JSON.stringify(o)) }, contextMessages: env.AI_CONTEXT_MESSAGES },
          id,
        );
        console.log(JSON.stringify(r));
        return r.status === 'failed' ? 2 : 0;
      }
      case 'extract:status': {
        const rows = await extractionStatus(db);
        if (rows.length === 0) console.log('Chưa có lần trích xuất nào.');
        for (const r of rows) console.log(`${r.status}${r.failureReason ? ` (${r.failureReason})` : ''}: ${r.runs}`);
        return 0;
      }
      case 'demo:reset':
      case 'demo:send':
      case 'demo:clock': {
        if (!env.DEMO_MODE) throw new Error('Lệnh demo chỉ chạy khi DEMO_MODE=true trong .env.');
        if (command === 'demo:reset') {
          const r = await resetDemo({ db, crypto: createTokenCrypto(env.TOKEN_ENC_KEY), log: { info: () => undefined, warn: (o) => console.warn(JSON.stringify(o)) } });
          console.log(`Đã dựng lại dữ liệu demo (tenant ${r.tenantId}). Đồng hồ demo: ${r.clockNow.toISOString()}`);
          return 0;
        }
        if (command === 'demo:clock') {
          const a = parseDemoClockArgs(args);
          if (a.advanceMinutes !== undefined) await advanceClock(db, a.advanceMinutes);
          else if (a.to !== undefined) await advanceClockTo(db, new Date(a.to));
          console.log(`Đồng hồ demo: ${(await getNow(db, true)).toISOString()}`);
          return 0;
        }
        const a = parseDemoSendArgs(args);
        const ctx = await getDemoContext(db);
        if (!ctx) throw new Error('Chưa có dữ liệu demo. Chạy: npm run cli -- demo:reset');
        const poster: WebhookPoster = {
          async post(rawBody, signature) {
            const res = await fetch(`http://127.0.0.1:${env.PORT}/webhook`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
              body: rawBody,
            }).catch(() => {
              throw new Error(`Không gọi được server tại cổng ${env.PORT}. Đã chạy "npm run dev" chưa?`);
            });
            return { status: res.status };
          },
        };
        const sim = { db, poster, appSecret: env.APP_SECRET, ctx };
        const now = await getNow(db, true);
        try {
          if (a.asPage) {
            const persona = PERSONAS[a.persona];
            if (!persona) throw new SimError(`Không có khách demo "${a.persona}". Có: ${Object.keys(PERSONAS).join(', ')}.`);
            await simulatePageMessage(sim, await ensurePersonaConversation(db, ctx, persona), a.text, now);
            console.log(`Đã gửi tin của Lan (Page Inbox) tới "${a.persona}" lúc ${now.toISOString()}.`);
            return 0;
          }
          const r = await simulateCustomerMessage(sim, { persona: a.persona }, a.text, now);
          console.log(`Đã gửi tin của "${a.persona}" lúc ${now.toISOString()} (hội thoại ${r.conversationId}).`);
          return 0;
        } catch (err) {
          if (err instanceof SimError) throw new Error(err.message);
          throw err;
        }
      }
      case 'proposals:list': {
        const id = args[0];
        if (!id) throw new Error('Thiếu ID hội thoại.');
        const [conv] = await db.select({ tenantId: conversations.tenantId }).from(conversations).where(eq(conversations.id, id));
        if (!conv) throw new Error(`Không có hội thoại ${id}.`);
        const rows = await listPending(db, conv.tenantId, id);
        if (rows.length === 0) console.log('Không có đề xuất đang chờ.');
        for (const r of rows) {
          console.log(`${r.id}  ${r.field.padEnd(16)} ${JSON.stringify(r.value)}${r.flags.length ? `  [${r.flags.join(', ')}]` : ''}`);
        }
        return 0;
      }
      case 'proposals:decide': {
        const a = parseDecideArgs(args);
        const [p] = await db.select({ tenantId: proposals.tenantId }).from(proposals).where(eq(proposals.id, a.proposalId));
        if (!p) throw new Error(`Không có đề xuất ${a.proposalId}.`);
        try {
          const r = await decideProposal(db, { tenantId: p.tenantId, proposalId: a.proposalId, action: a.action, by: a.by, editedText: a.text, chosenAt: a.at }, new Date());
          console.log(`Đã ${r.status}: ${r.field}${r.value ? ` = ${JSON.stringify(r.value)}` : ''}`);
          return 0;
        } catch (err) {
          if (err instanceof ProposalError) throw new Error(err.message);
          throw err;
        }
      }
      default:
        console.error(`Lệnh không hợp lệ: ${command}\n\n${USAGE}`);
        return 1;
    }
  } finally {
    await close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`Lỗi: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
