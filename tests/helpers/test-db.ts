import { createDb, type DbHandle } from '../../src/db/client.js';

const DEFAULT_TEST_URL = 'postgres://salesmind:salesmind@localhost:5433/salesmind_test';

/**
 * URL của database test. Chốt chặn: tên database phải kết thúc bằng `_test`,
 * để không bao giờ xóa nhầm dữ liệu dev.
 */
export function getTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL;
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Từ chối chạy test trên database "${dbName}": tên phải kết thúc bằng _test.`);
  }
  return url;
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
