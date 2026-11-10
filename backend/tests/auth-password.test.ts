import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, normalizeEmail, validatePassword, verifyPassword } from '../src/auth/password.js';

describe('hashPassword / verifyPassword', () => {
  it('băm hai lần cùng mật khẩu ra hai chuỗi khác nhau (salt riêng), cả hai đều xác minh đúng', async () => {
    const a = await hashPassword('mat-khau-dai-123');
    const b = await hashPassword('mat-khau-dai-123');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('mat-khau-dai-123', a)).toBe(true);
    expect(await verifyPassword('mat-khau-dai-123', b)).toBe(true);
  });

  it('sai mật khẩu thì false; không phân biệt chữ hoa thường được', async () => {
    const h = await hashPassword('Mat-Khau-Dai-123');
    expect(await verifyPassword('mat-khau-dai-123', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
  });

  it('chuỗi băm hỏng hoặc thiếu trường thì false, không ném', async () => {
    for (const bad of ['', 'abc', 'scrypt$1$2', 'scrypt$x$y$z$a$b', 'bcrypt$a$b$c$d$e', 'scrypt$32768$8$1$!!$!!']) {
      await expect(verifyPassword('x', bad)).resolves.toBe(false);
    }
  });

  it('mật khẩu tiếng Việt có dấu và emoji xác minh đúng', async () => {
    const h = await hashPassword('Mật-khẩu-Việt-😀-2026');
    expect(await verifyPassword('Mật-khẩu-Việt-😀-2026', h)).toBe(true);
  });

  it('needsRehash: tham số hiện hành thì không cần, tham số yếu hơn thì cần', async () => {
    const h = await hashPassword('mat-khau-dai-123');
    expect(needsRehash(h)).toBe(false);
    expect(needsRehash(h.replace('scrypt$32768$', 'scrypt$16384$'))).toBe(true);
    expect(needsRehash('rác')).toBe(true);
  });
});

describe('validatePassword', () => {
  it('9 ký tự bị từ chối, 10 ký tự được', () => {
    expect(validatePassword('123456789', 'a@b.vn')).not.toBeNull();
    expect(validatePassword('1234567890', 'a@b.vn')).toBeNull();
  });
  it('tối đa 128 ký tự', () => {
    expect(validatePassword('a'.repeat(128), 'a@b.vn')).toBeNull();
    expect(validatePassword('a'.repeat(129), 'a@b.vn')).not.toBeNull();
  });
  it('không được trùng email', () => {
    expect(validatePassword('nguyen.an@gmail.com', 'nguyen.an@gmail.com')).not.toBeNull();
    expect(validatePassword('NGUYEN.AN@gmail.com', 'nguyen.an@gmail.com')).not.toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('trim, hạ chữ thường, chuẩn hóa NFC', () => {
    expect(normalizeEmail('  Nguyen.AN@Gmail.COM ')).toBe('nguyen.an@gmail.com');
  });
  it('từ chối thiếu @, nhiều @, rỗng, quá dài, có khoảng trắng', () => {
    for (const bad of ['', 'abc', 'a@b@c.vn', 'a b@c.vn', `${'a'.repeat(250)}@b.vn`, '@b.vn', 'a@']) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });
});
