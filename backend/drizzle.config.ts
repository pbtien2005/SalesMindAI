import { defineConfig } from 'drizzle-kit';

// Chỉ dùng để sinh migration (`npm run db:generate`), việc này không cần kết nối DB.
// Áp migration lên DB do `npm run db:migrate` làm, đọc DATABASE_URL từ .env.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
