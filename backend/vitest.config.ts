import { defineConfig } from 'vitest/config';

// Số worker song song; mỗi worker có database test riêng (xem tests/global-setup.ts). Đặt TEST_WORKERS=1 để chạy tuần tự.
const workers = Number(process.env.TEST_WORKERS ?? 5);
process.env.TEST_WORKERS = String(Number.isInteger(workers) && workers >= 1 && workers <= 16 ? workers : 5);

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Test toàn tuyến có chờ polling và retry của pg-boss nên cần dư giả hơn mặc định 5 giây.
    testTimeout: 40_000,
    hookTimeout: 40_000,
    globalSetup: ['tests/global-setup.ts'],
    // Mỗi worker dùng database riêng nên các file test chạy song song được.
    fileParallelism: true,
    maxWorkers: Number(process.env.TEST_WORKERS),
  },
});
