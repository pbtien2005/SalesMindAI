import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/global-setup.ts'],
    // Các test DB dùng chung một database nên chạy tuần tự.
    fileParallelism: false,
  },
});
