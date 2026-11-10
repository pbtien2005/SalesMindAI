import { describe, expect, it } from 'vitest';
import { safeEqual, verifySignature } from '../src/meta/signature.js';
import { APP_SECRET, sign } from './helpers/webhook.js';

const body = Buffer.from('{"object":"page","entry":[]}');

describe('verifySignature', () => {
  it('chấp nhận chữ ký đúng', () => {
    expect(verifySignature(body, sign(body), APP_SECRET)).toBe(true);
  });

  it('chấp nhận hex viết hoa', () => {
    const upper = 'sha256=' + sign(body).slice('sha256='.length).toUpperCase();
    expect(verifySignature(body, upper, APP_SECRET)).toBe(true);
  });

  it('từ chối khi sai secret', () => {
    expect(verifySignature(body, sign(body, 'other-secret'), APP_SECRET)).toBe(false);
  });

  it('từ chối khi body bị sửa dù chỉ 1 byte', () => {
    const tampered = Buffer.from(body);
    tampered[3] = tampered[3]! ^ 0x01;
    expect(verifySignature(tampered, sign(body), APP_SECRET)).toBe(false);
  });

  it('từ chối khi body bị thêm khoảng trắng (khác byte)', () => {
    expect(verifySignature(Buffer.concat([body, Buffer.from('\n')]), sign(body), APP_SECRET)).toBe(false);
  });

  it.each([
    ['thiếu header', undefined],
    ['rỗng', ''],
    ['thiếu tiền tố', sign(body).slice('sha256='.length)],
    ['tiền tố sai (sha1=)', 'sha1=' + sign(body).slice('sha256='.length)],
    ['hex quá ngắn', 'sha256=abcd'],
    ['hex quá dài', sign(body) + '00'],
    ['không phải hex', 'sha256=' + 'z'.repeat(64)],
    ['có khoảng trắng thừa', ' ' + sign(body)],
  ])('từ chối header %s', (_name, header) => {
    expect(verifySignature(body, header, APP_SECRET)).toBe(false);
  });

  it('khớp theo byte thô: tiếng Việt, escape Unicode, khoảng trắng và xuống dòng', () => {
    const raws = [
      '{"text":"Anh muốn mua 20 bộ"}',
      '{"text":"Anh mu\\u1ed1n mua"}', // Meta thường escape ký tự ngoài ASCII như thế này
      '{ "a" : 1 ,\n  "b" : [ ] }\n',
    ];
    for (const raw of raws) {
      const buf = Buffer.from(raw, 'utf8');
      expect(verifySignature(buf, sign(buf), APP_SECRET)).toBe(true);
      // parse rồi stringify lại làm đổi byte => chữ ký phải sai
      const reserialized = Buffer.from(JSON.stringify(JSON.parse(raw)), 'utf8');
      if (!reserialized.equals(buf)) {
        expect(verifySignature(reserialized, sign(buf), APP_SECRET)).toBe(false);
      }
    }
  });
});

describe('safeEqual', () => {
  it('đúng khi giống nhau, sai khi khác, kể cả khác độ dài', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'a')).toBe(false);
  });
});
