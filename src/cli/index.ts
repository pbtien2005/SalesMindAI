import { and, eq } from 'drizzle-orm';
import type { BackfillState } from '../backfill/backfill.js';
import { backfillOverview, isBackfillRunning } from '../backfill/status.js';
import { assessQueueHealth } from '../queue/monitor.js';
import { parseBackfillArgs, parseRedriveArgs } from './args.js';
import { queueOverview, redriveDeadLetter } from '../queue/admin.js';
import { newConnectUrl, createTenant, listTenants, tenantExists } from '../auth/tenants.js';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { pages } from '../db/schema.js';
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
  queue:status                Xem độ sâu mọi hàng đợi (webhook, backfill, dead-letter) và cảnh báo
  queue:redrive <webhook|backfill> [--limit N] [--dry-run]
                              Đưa job trong dead-letter về hàng đợi gốc để xử lý lại (sau khi đã sửa nguyên nhân)

Lệnh backfill chỉ xếp việc vào hàng đợi; server (npm run dev) mới là nơi xử lý. Meta chỉ cho lấy chi
tiết 20 tin gần nhất của mỗi hội thoại nên đây không phải là khôi phục toàn bộ lịch sử.

Liên kết kết nối dùng được MỘT lần và hết hạn sau 10 phút. Gửi cho người quản lý Page,
họ mở bằng trình duyệt và đăng nhập Facebook để cấp quyền.`;

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
