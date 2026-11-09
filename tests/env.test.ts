import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const validKey = randomBytes(32).toString('base64');

const base = {
  FB_APP_ID: '1234567890',
  PUBLIC_BASE_URL: 'https://salesmind.example.com',
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

  it('PUBLIC_BASE_URL: chấp nhận https và http://localhost', () => {
    expect(loadEnv({ ...base, PUBLIC_BASE_URL: 'https://abc.ngrok-free.app' }).PUBLIC_BASE_URL).toBe('https://abc.ngrok-free.app');
    expect(() => loadEnv({ ...base, PUBLIC_BASE_URL: 'http://localhost:3000' })).not.toThrow();
    expect(() => loadEnv({ ...base, PUBLIC_BASE_URL: 'http://127.0.0.1:3000' })).not.toThrow();
    expect(() => loadEnv({ ...base, PUBLIC_BASE_URL: 'http://[::1]:3000' })).not.toThrow();
    expect(() => loadEnv({ ...base, PUBLIC_BASE_URL: 'http://192.168.1.5:3000' })).toThrow(/PUBLIC_BASE_URL/);
  });

  it.each([
    ['http không phải localhost', 'http://salesmind.example.com'],
    ['dấu / ở cuối', 'https://salesmind.example.com/'],
    ['có đường dẫn', 'https://salesmind.example.com/app'],
    ['có query', 'https://salesmind.example.com?x=1'],
    ['không phải URL', 'salesmind.example.com'],
  ])('PUBLIC_BASE_URL: từ chối %s', (_n, url) => {
    expect(() => loadEnv({ ...base, PUBLIC_BASE_URL: url })).toThrow(/PUBLIC_BASE_URL/);
  });

  it('FB_LOGIN_CONFIG_ID là tùy chọn', () => {
    expect(loadEnv(base).FB_LOGIN_CONFIG_ID).toBeUndefined();
    expect(loadEnv({ ...base, FB_LOGIN_CONFIG_ID: '9988' }).FB_LOGIN_CONFIG_ID).toBe('9988');
    // `FB_LOGIN_CONFIG_ID=` để trống trong .env (dotenv trả chuỗi rỗng) = không đặt
    expect(loadEnv({ ...base, FB_LOGIN_CONFIG_ID: '' }).FB_LOGIN_CONFIG_ID).toBeUndefined();
    expect(loadEnv({ ...base, FB_LOGIN_CONFIG_ID: '   ' }).FB_LOGIN_CONFIG_ID).toBeUndefined();
  });

  it('thiếu FB_APP_ID thì báo lỗi', () => {
    const { FB_APP_ID: _omit, ...rest } = base;
    expect(() => loadEnv(rest)).toThrow(/FB_APP_ID/);
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
