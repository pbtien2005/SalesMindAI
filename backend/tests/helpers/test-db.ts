import { createDb, type DbHandle } from '../../src/db/client.js';

const DEFAULT_TEST_URL = 'postgres://salesmind:salesmind@localhost:5433/salesmind_test';

/** Số worker chạy song song; mỗi worker có một database riêng. Cùng giá trị cho cấu hình vitest, global-setup và helper. */
export function testWorkerCount(): number {
  const n = Number(process.env.TEST_WORKERS ?? 5);
  return Number.isInteger(n) && n >= 1 && n <= 16 ? n : 5;
}

/**
 * URL database test GỐC. Chốt chặn: tên database phải kết thúc bằng `_test`,
 * để không bao giờ xóa nhầm dữ liệu dev. Các database riêng của worker được đặt tên dẫn xuất từ đây
 * (`<tên>_r<mã lần chạy>_w<số>_test`) nên cũng luôn kết thúc bằng `_test`.
 */
export function getBaseTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL;
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Từ chối chạy test trên database "${dbName}": tên phải kết thúc bằng _test.`);
  }
  return url;
}

/** Tên database riêng của worker `n` (1..N) trong lần chạy `runId`. */
export function workerDatabaseName(baseName: string, runId: string, n: number): string {
  return `${baseName.replace(/_test$/, '')}_r${runId}_w${n}_test`;
}

export function withDatabaseName(url: string, dbName: string): string {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

/**
 * URL database mà tiến trình hiện tại phải dùng. Trong worker của vitest (có `VITEST_POOL_ID` và mã lần chạy do
 * global-setup đặt) là database riêng của worker, nên các file test chạy song song không giẫm lên nhau.
 * Ngoài worker thì là database gốc.
 */
export function getTestDatabaseUrl(): string {
  const base = getBaseTestDatabaseUrl();
  const runId = process.env.TEST_RUN_ID;
  const poolId = Number(process.env.VITEST_POOL_ID);
  if (!runId || !Number.isInteger(poolId) || poolId < 1) return base;
  const n = ((poolId - 1) % testWorkerCount()) + 1;
  return withDatabaseName(base, workerDatabaseName(new URL(base).pathname.replace(/^\//, ''), runId, n));
}

export function openTestDb(): DbHandle {
  return createDb(getTestDatabaseUrl(), { max: 4 });
}

/** Xóa sạch dữ liệu mọi bảng trong schema public giữa các test, giữ nguyên schema. */
export async function truncateAll(handle: DbHandle): Promise<void> {
  const { rows } = await handle.pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await handle.pool.query(`TRUNCATE TABLE ${list} CASCADE`);
}
