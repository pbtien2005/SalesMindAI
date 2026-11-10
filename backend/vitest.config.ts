import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Test toàn tuyến có chờ polling và retry của pg-boss nên cần dư giả hơn mặc định 5 giây.
    testTimeout: 40_000,
    hookTimeout: 40_000,
    globalSetup: ['tests/global-setup.ts'],
    // Các test DB dùng chung một database nên chạy tuần tự.
    fileParallelism: false,
  },
});
