import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const validKey = randomBytes(32).toString('base64');

const base = {
  APP_SECRET: 'test-app-secret',
  VERIFY_TOKEN: 'test-verify-token',
  TOKEN_ENC_KEY: validKey,
  GRAPH_API_VERSION: 'v23.0',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
};

describe('loadEnv', () => {
  it('chấp nhận cấu hình hợp lệ và dùng PORT mặc định 3000', () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.GRAPH_API_VERSION).toBe('v23.0');
  });

  it('báo lỗi khi thiếu biến bắt buộc', () => {
    const { APP_SECRET: _omit, ...rest } = base;
    expect(() => loadEnv(rest)).toThrow(/APP_SECRET/);
  });

  it('từ chối TOKEN_ENC_KEY không đủ 32 byte', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => loadEnv({ ...base, TOKEN_ENC_KEY: short })).toThrow(/TOKEN_ENC_KEY/);
  });

  it('không chép giá trị bí mật vào thông báo lỗi', () => {
    const short = randomBytes(16).toString('base64');
    try {
      loadEnv({ ...base, TOKEN_ENC_KEY: short });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain(short);
    }
  });
});
