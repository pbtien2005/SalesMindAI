import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  /** Đóng pool. Gọi khi tắt server hoặc cuối test. */
  close: () => Promise<void>;
}

export interface DbOptions {
  /** Số kết nối tối đa trong pool. */
  max?: number;
  /** Nhận lỗi của kết nối nhàn rỗi. Mặc định ghi ra stderr (mốc 6 chuyển sang pino). */
  onError?: (err: Error) => void;
}

export function createDb(databaseUrl: string, opts: DbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: opts.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // Bắt buộc có handler: nếu không, lỗi của kết nối nhàn rỗi làm sập tiến trình.
  // Chỉ ghi message, không ghi connection string (có mật khẩu).
  pool.on('error', opts.onError ?? ((err) => console.error(`[db] lỗi kết nối nhàn rỗi: ${err.message}`)));
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
