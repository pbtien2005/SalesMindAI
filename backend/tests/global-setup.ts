import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { getBaseTestDatabaseUrl, testWorkerCount, withDatabaseName, workerDatabaseName } from './helpers/test-db.js';

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  await client.connect();
  return client;
}

/** Kết nối vào database `postgres` của cùng máy chủ để tạo/xóa các database test. */
async function admin(baseUrl: string): Promise<pg.Client> {
  return connect(withDatabaseName(baseUrl, 'postgres'));
}

/**
 * Chạy một lần trước toàn bộ test. Mỗi worker song song có MỘT database riêng (`<tên>_r<mã>_w<n>_test`, mã = pid
 * của lần chạy này, nên hai lần chạy vitest cùng lúc cũng không giẫm lên nhau). Database được tạo mới, tắt chờ ghi
 * đĩa khi commit (chỉ cho database thử này) rồi áp migration; xong test thì xóa.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const base = getBaseTestDatabaseUrl();
  const baseName = new URL(base).pathname.replace(/^\//, '');
  const runId = String(process.pid);
  const names = Array.from({ length: testWorkerCount() }, (_, i) => workerDatabaseName(baseName, runId, i + 1));

  let a: pg.Client;
  try {
    a = await admin(base);
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'không rõ mã';
    throw new Error(
      `Không kết nối được máy chủ database test tại ${new URL(base).host} (${code}): ${(err as Error).message}\n` +
        'Kiểm tra: đã chạy "docker compose up -d" chưa, và cổng/mật khẩu trong TEST_DATABASE_URL có đúng không.',
    );
  }
  try {
    // Dọn database còn sót của các lần chạy trước bị ngắt giữa chừng (chỉ xóa cái không còn ai kết nối).
    const prefix = baseName.replace(/_test$/, '');
    const { rows } = await a.query<{ datname: string }>(
      `SELECT d.datname FROM pg_database d
       WHERE d.datname ~ $1 AND NOT EXISTS (SELECT 1 FROM pg_stat_activity s WHERE s.datname = d.datname)`,
      [`^${prefix.replace(/[^a-zA-Z0-9_]/g, '')}_r[0-9]+_w[0-9]+_test$`],
    );
    for (const r of rows) await a.query(`DROP DATABASE IF EXISTS ${quote(r.datname)}`);
    for (const name of names) {
      await a.query(`CREATE DATABASE ${quote(name)}`);
      await a.query(`ALTER DATABASE ${quote(name)} SET synchronous_commit = off`);
    }
  } finally {
    await a.end();
  }

  await Promise.all(names.map((name) => runMigrations(withDatabaseName(base, name))));

  // Worker kế thừa biến môi trường này (được tạo sau global-setup).
  process.env.TEST_RUN_ID = runId;

  return async () => {
    const t = await admin(base);
    try {
      for (const name of names) await t.query(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
    } finally {
      await t.end();
    }
  };
}
