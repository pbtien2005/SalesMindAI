import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  claimOAuthState,
  consumeOAuthState,
  createOAuthState,
  newNonce,
  NONCE_FORMAT,
} from '../src/auth/oauth-state.js';
import { connectUrl, createTenant, listTenants, newConnectUrl, tenantExists } from '../src/auth/tenants.js';
import { pages } from '../src/db/schema.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;

beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

async function freshState(ttl?: number) {
  const tenant = await createTenant(db, 'Công ty A');
  const state = await createOAuthState(db, tenant.id, ttl);
  return { tenant, state };
}

describe('OAuth state (dùng một lần, gắn với trình duyệt)', () => {
  it('tạo, nhận bằng nonce, rồi tiêu thụ trả đúng tenant; dùng lần hai thì null', async () => {
    const { tenant, state } = await freshState();
    const nonce = newNonce();
    expect(await claimOAuthState(db, state, nonce)).toBe(true);
    expect(await consumeOAuthState(db, state, nonce)).toEqual({ tenantId: tenant.id });
    expect(await consumeOAuthState(db, state, nonce)).toBeNull();
    expect(await claimOAuthState(db, state, nonce)).toBe(false); // đã dùng thì không nhận lại được
  });

  it('state và nonce ngẫu nhiên đủ dài và không trùng', async () => {
    const t = await createTenant(db, 'A');
    const states = await Promise.all(Array.from({ length: 20 }, () => createOAuthState(db, t.id)));
    expect(new Set(states).size).toBe(20);
    for (const s of states) expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 byte base64url
    const nonces = Array.from({ length: 20 }, newNonce);
    expect(new Set(nonces).size).toBe(20);
    for (const n of nonces) expect(n).toMatch(NONCE_FORMAT);
  });

  it('DB chỉ lưu băm SHA-256 của state và nonce, không lưu giá trị thô', async () => {
    const { state } = await freshState();
    const nonce = newNonce();
    await claimOAuthState(db, state, nonce);
    const { rows } = await handle.pool.query('SELECT * FROM oauth_states');
    expect(rows).toHaveLength(1);
    expect(rows[0].state_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].nonce_hash).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(state);
    expect(dump).not.toContain(nonce);
  });

  it('chưa nhận (claim) thì không tiêu thụ được dù đúng state', async () => {
    const { state } = await freshState();
    expect(await consumeOAuthState(db, state, newNonce())).toBeNull();
  });

  it('sai nonce thì không tiêu thụ được, và state vẫn còn dùng được với nonce đúng', async () => {
    const { tenant, state } = await freshState();
    const nonce = newNonce();
    await claimOAuthState(db, state, nonce);
    expect(await consumeOAuthState(db, state, newNonce())).toBeNull();
    expect(await consumeOAuthState(db, state, nonce)).toEqual({ tenantId: tenant.id });
  });

  it('trình duyệt thứ hai có state nhưng khác nonce: không nhận được (chống chiếm luồng bằng state bị lộ)', async () => {
    const { state } = await freshState();
    const victim = newNonce();
    const attacker = newNonce();
    expect(await claimOAuthState(db, state, victim)).toBe(true);
    expect(await claimOAuthState(db, state, attacker)).toBe(false);
    expect(await consumeOAuthState(db, state, attacker)).toBeNull();
    // người dùng thật tải lại trang (cùng nonce) vẫn được
    expect(await claimOAuthState(db, state, victim)).toBe(true);
    expect(await consumeOAuthState(db, state, victim)).not.toBeNull();
  });

  it('nhiều trình duyệt đồng thời cùng nhận một state: đúng một bên thắng', async () => {
    const { state } = await freshState();
    const results = await Promise.all(Array.from({ length: 12 }, () => claimOAuthState(db, state, newNonce())));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('state sai hoặc không tồn tại: không nhận, không tiêu thụ', async () => {
    const fake = 'x'.repeat(43);
    expect(await claimOAuthState(db, fake, newNonce())).toBe(false);
    expect(await consumeOAuthState(db, fake, newNonce())).toBeNull();
  });

  it('state hết hạn: không nhận và không tiêu thụ được', async () => {
    const { state } = await freshState(-1);
    const nonce = newNonce();
    expect(await claimOAuthState(db, state, nonce)).toBe(false);
    expect(await consumeOAuthState(db, state, nonce)).toBeNull();
  });

  it('nhiều callback đồng thời với cùng state và nonce: đúng một bên thành công (nguyên tử)', async () => {
    const { state } = await freshState();
    const nonce = newNonce();
    await claimOAuthState(db, state, nonce);
    const results = await Promise.all(Array.from({ length: 12 }, () => consumeOAuthState(db, state, nonce)));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('state của tenant này không dùng được cho tenant khác', async () => {
    const a = await createTenant(db, 'A');
    const b = await createTenant(db, 'B');
    const sa = await createOAuthState(db, a.id);
    const sb = await createOAuthState(db, b.id);
    const n = newNonce();
    await claimOAuthState(db, sa, n);
    await claimOAuthState(db, sb, n);
    expect((await consumeOAuthState(db, sb, n))!.tenantId).toBe(b.id);
    expect((await consumeOAuthState(db, sa, n))!.tenantId).toBe(a.id);
  });

  it('dọn state đã hết hạn quá 1 ngày khi tạo state mới (bảng không phình mãi)', async () => {
    const t = await createTenant(db, 'A');
    const count = async () => (await handle.pool.query('SELECT count(*)::int AS n FROM oauth_states')).rows[0].n as number;

    await createOAuthState(db, t.id, -2 * 24 * 3600); // hết hạn từ 2 ngày trước
    expect(await count()).toBe(1);

    await createOAuthState(db, t.id, -60); // lần tạo này dọn bản 2 ngày tuổi; bản mới hết hạn 1 phút thì giữ
    expect(await count()).toBe(1);
    const { rows } = await handle.pool.query(`SELECT expires_at > now() - interval '1 day' AS recent FROM oauth_states`);
    expect(rows[0].recent).toBe(true); // dòng còn lại là bản mới, không phải bản cũ

    await createOAuthState(db, t.id); // bản hết hạn 1 phút chưa đủ 1 ngày nên vẫn còn
    expect(await count()).toBe(2);
  });
});

describe('tenant và liên kết kết nối (CLI)', () => {
  it('createTenant cắt khoảng trắng; tên rỗng thì lỗi', async () => {
    expect((await createTenant(db, '  Công ty Á  ')).name).toBe('Công ty Á');
    await expect(createTenant(db, '   ')).rejects.toThrow();
  });

  it('connectUrl ghép đúng đường dẫn và mã hóa state', () => {
    expect(connectUrl('https://x.example', 'a+b/c=')).toBe('https://x.example/auth/facebook/start?state=a%2Bb%2Fc%3D');
  });

  it('newConnectUrl tạo state hợp lệ trong DB gắn với tenant', async () => {
    const t = await createTenant(db, 'A');
    const url = new URL(await newConnectUrl(db, 'https://x.example', t.id));
    expect(url.origin + url.pathname).toBe('https://x.example/auth/facebook/start');
    const state = url.searchParams.get('state')!;
    const nonce = newNonce();
    expect(await claimOAuthState(db, state, nonce)).toBe(true);
    expect(await consumeOAuthState(db, state, nonce)).toEqual({ tenantId: t.id });
  });

  it('tenantExists và listTenants (kèm số Page)', async () => {
    const a = await createTenant(db, 'A');
    await createTenant(db, 'B');
    expect(await tenantExists(db, a.id)).toBe(true);
    expect(await tenantExists(db, '019e0000-0000-7000-8000-000000000000')).toBe(false);
    await db.insert(pages).values([
      { tenantId: a.id, fbPageId: 'p1', name: 'P1', tokenEnc: 'x' },
      { tenantId: a.id, fbPageId: 'p2', name: 'P2', tokenEnc: 'x' },
    ]);
    const list = await listTenants(db);
    expect(list.map((r) => [r.name, r.pages])).toEqual([['A', 2], ['B', 0]]);
  });
});
