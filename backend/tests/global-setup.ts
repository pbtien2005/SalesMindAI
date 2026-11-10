import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { getTestDatabaseUrl } from './helpers/test-db.js';

const INVALID_CATALOG_NAME = '3D000'; // "database does not exist"

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  await client.connect();
  return client;
}

/** Tạo database test nếu chưa có (volume tạo trước khi có docker/initdb/ thì sẽ thiếu). */
async function ensureDatabase(url: string): Promise<void> {
  try {
    (await connect(url)).end();
    return;
  } catch (err) {
    if ((err as { code?: string }).code !== INVALID_CATALOG_NAME) throw err;
  }
  const target = new URL(url);
  const dbName = target.pathname.replace(/^\//, '');
  target.pathname = '/postgres';
  const admin = await connect(target.toString());
  try {
    await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }
}

/** Chạy một lần trước toàn bộ test: dựng lại schema sạch trên database *_test rồi áp migration. */
export default async function setup(): Promise<void> {
  const url = getTestDatabaseUrl();
  const where = new URL(url).host;
  let client: pg.Client;
  try {
    await ensureDatabase(url);
    client = await connect(url);
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'không rõ mã';
    throw new Error(
      `Không kết nối được database test tại ${where} (${code}): ${(err as Error).message}\n` +
        'Kiểm tra: đã chạy "docker compose up -d" chưa, và cổng/mật khẩu trong TEST_DATABASE_URL có đúng không.',
    );
  }
  try {
    await client.query('DROP SCHEMA IF EXISTS pgboss CASCADE');
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
