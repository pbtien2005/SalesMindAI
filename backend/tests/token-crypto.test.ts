import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTokenCrypto, parseKey, TokenCryptoError } from '../src/crypto/token-crypto.js';

const newKey = () => randomBytes(32).toString('base64');
const TOKEN = 'EAAG-fake-page-token-1234567890';
const PAGE = '1234567890';

describe('token-crypto (AES-256-GCM)', () => {
  it('mã hóa rồi giải mã ra đúng token gốc', () => {
    const c = createTokenCrypto(newKey());
    expect(c.decrypt(c.encrypt(TOKEN, PAGE), PAGE)).toBe(TOKEN);
  });

  it('giữ nguyên ký tự Unicode', () => {
    const c = createTokenCrypto(newKey());
    const s = 'Tiếng Việt ✓ 🙂';
    expect(c.decrypt(c.encrypt(s, PAGE), PAGE)).toBe(s);
  });

  it('chuỗi lưu có dạng v1:iv:tag:ciphertext và không chứa token rõ', () => {
    const c = createTokenCrypto(newKey());
    const enc = c.encrypt(TOKEN, PAGE);
    const parts = enc.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(Buffer.from(parts[1]!, 'base64')).toHaveLength(12);
    expect(Buffer.from(parts[2]!, 'base64')).toHaveLength(16);
    expect(enc).not.toContain(TOKEN);
  });

  it('hai lần mã hóa cùng token cho IV và ciphertext khác nhau', () => {
    const c = createTokenCrypto(newKey());
    const ivs = new Set<string>();
    const outs = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const enc = c.encrypt(TOKEN, PAGE);
      ivs.add(enc.split(':')[1]!);
      outs.add(enc);
    }
    expect(ivs.size).toBe(50);
    expect(outs.size).toBe(50);
  });

  it('sai khóa thì giải mã thất bại', () => {
    const enc = createTokenCrypto(newKey()).encrypt(TOKEN, PAGE);
    expect(() => createTokenCrypto(newKey()).decrypt(enc, PAGE)).toThrow(TokenCryptoError);
  });

  it('sai AAD (ciphertext của Page khác) thì giải mã thất bại', () => {
    const c = createTokenCrypto(newKey());
    const enc = c.encrypt(TOKEN, PAGE);
    expect(() => c.decrypt(enc, 'another-page')).toThrow(TokenCryptoError);
  });

  it.each([
    ['iv', 1],
    ['tag', 2],
    ['ciphertext', 3],
  ])('sửa 1 byte của %s thì giải mã thất bại', (_name, idx) => {
    const c = createTokenCrypto(newKey());
    const parts = c.encrypt(TOKEN, PAGE).split(':');
    const raw = Buffer.from(parts[idx]!, 'base64');
    raw[0] = raw[0]! ^ 0x01;
    parts[idx] = raw.toString('base64');
    expect(() => c.decrypt(parts.join(':'), PAGE)).toThrow(TokenCryptoError);
  });

  it.each([
    ['rỗng', ''],
    ['thiếu phần', 'v1:abc:def'],
    ['sai phiên bản', 'v2:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA'],
    ['IV sai độ dài', 'v1:AAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA'],
  ])('từ chối định dạng không hợp lệ: %s', (_name, bad) => {
    const c = createTokenCrypto(newKey());
    expect(() => c.decrypt(bad, PAGE)).toThrow(TokenCryptoError);
  });

  it('từ chối khóa không đủ 32 byte', () => {
    expect(() => createTokenCrypto(randomBytes(16).toString('base64'))).toThrow(TokenCryptoError);
    expect(() => createTokenCrypto(randomBytes(33).toString('base64'))).toThrow(TokenCryptoError);
    expect(() => createTokenCrypto('')).toThrow(TokenCryptoError);
  });

  it('từ chối khóa base64 sai dạng dù có thể giải ra 32 byte', () => {
    const good = randomBytes(32).toString('base64'); // 44 ký tự, kết thúc bằng "="
    expect(() => parseKey(good)).not.toThrow();
    // ký tự lạ chen vào (Buffer.from sẽ bỏ qua và vẫn ra 32 byte)
    expect(() => createTokenCrypto(good.slice(0, 10) + '!' + good.slice(10))).toThrow(TokenCryptoError);
    expect(() => createTokenCrypto(good + '\n')).toThrow(TokenCryptoError);
    expect(() => createTokenCrypto(' ' + good)).toThrow(TokenCryptoError);
    // base64url (dùng - và _ thay cho + và /) không được chấp nhận
    const url = Buffer.alloc(32, 0xfb).toString('base64url') + '=';
    expect(url).toMatch(/[-_]/);
    expect(() => createTokenCrypto(url)).toThrow(TokenCryptoError);
  });

  it('thông báo lỗi không lộ khóa, token hay ciphertext', () => {
    const key = newKey();
    const c = createTokenCrypto(key);
    const enc = c.encrypt(TOKEN, PAGE);
    try {
      createTokenCrypto(newKey()).decrypt(enc, PAGE);
      expect.unreachable();
    } catch (e) {
      const msg = String(e);
      expect(msg).not.toContain(key);
      expect(msg).not.toContain(TOKEN);
      expect(msg).not.toContain(enc.split(':')[3]!);
    }
  });
});
