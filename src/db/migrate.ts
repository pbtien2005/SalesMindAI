import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

/**
 * Thư mục migration, tính từ vị trí file này (không phụ thuộc thư mục chạy lệnh).
 * Đúng cho cả `src/db/` (tsx) và `dist/db/` (bản build): cả hai đều cách gốc dự án hai cấp.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Chạy toàn bộ migration lên database đã cho. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, close } = createDb(databaseUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await close();
  }
}

// Chạy trực tiếp: `npm run db:migrate`
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Thiếu DATABASE_URL (xem .env.example).');
    process.exit(1);
  }
  await runMigrations(url);
  console.log('Migration xong.');
}
