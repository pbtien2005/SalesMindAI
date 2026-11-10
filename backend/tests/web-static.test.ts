import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let dir: string;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sm-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>SalesMind</title><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app.abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  app = buildApp({}, { appSecret: 's', verifyToken: 'v', queue: { enqueue: async () => {} }, webDist: dir });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const html = { accept: 'text/html,application/xhtml+xml' };

describe('phục vụ giao diện web', () => {
  it('GET / trả index.html, không cache', async () => {
    const r = await app.inject({ method: 'GET', url: '/', headers: html });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('SalesMind');
    expect(r.headers['cache-control']).toBe('no-cache');
  });

  it('đường dẫn của SPA (không phải tệp) cũng trả index.html', async () => {
    for (const url of ['/pages', '/team/abc', '/?reset=token']) {
      const r = await app.inject({ method: 'GET', url, headers: html });
      expect(r.statusCode, url).toBe(200);
      expect(r.body, url).toContain('<div id="root">');
    }
  });

  it('tệp có băm trong /assets/ cache vô thời hạn, tệp khác kiểm lại', async () => {
    const a = await app.inject({ method: 'GET', url: '/assets/app.abc123.js' });
    expect(a.statusCode).toBe(200);
    expect(a.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const f = await app.inject({ method: 'GET', url: '/favicon.svg' });
    expect(f.statusCode).toBe(200);
    expect(f.headers['cache-control']).toBe('no-cache');
  });

  it('đường dẫn của backend không bao giờ rơi về index.html: 404 dạng JSON', async () => {
    for (const url of ['/api/khong-ton-tai', '/auth/khong-ton-tai', '/webhook/x', '/healthz/x']) {
      const r = await app.inject({ method: 'GET', url, headers: html });
      expect(r.statusCode, url).toBe(404);
      expect(r.json().error.code, url).toBe('not_found');
    }
  });

  it('tệp không tồn tại mà client không đòi HTML (script, ảnh) thì 404 JSON, không trả index.html', async () => {
    const r = await app.inject({ method: 'GET', url: '/assets/khong-co.js', headers: { accept: '*/*' } });
    expect(r.statusCode).toBe(404);
  });

  it('không cho đọc ra ngoài thư mục (../)', async () => {
    const r = await app.inject({ method: 'GET', url: '/..%2f..%2fpackage.json', headers: html });
    expect(r.body).not.toContain('"name"');
  });

  it('/webhook (xác minh Meta) và /healthz vẫn là handler của backend', async () => {
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ status: 'ok' });
    const v = await app.inject({ method: 'GET', url: '/webhook?hub.mode=subscribe&hub.verify_token=v&hub.challenge=123' });
    expect(v.statusCode).toBe(200);
    expect(v.body).toBe('123');
  });

  it('không có bản build thì không phục vụ gì (đường dẫn lạ 404 JSON mặc định của Fastify)', async () => {
    const bare = buildApp({}, { appSecret: 's', verifyToken: 'v', queue: { enqueue: async () => {} }, webDist: join(dir, 'khong-co') });
    expect((await bare.inject({ method: 'GET', url: '/', headers: html })).statusCode).toBe(404);
    await bare.close();
  });
});
