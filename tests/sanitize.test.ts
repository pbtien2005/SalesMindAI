import { describe, expect, it } from 'vitest';
import { quoteLargeAppIds } from '../src/meta/sanitize.js';

describe('quoteLargeAppIds (giữ chính xác app_id từ 16 chữ số trở lên)', () => {
  it('bọc app_id dài thành chuỗi, kể cả khi có khoảng trắng quanh dấu hai chấm', () => {
    expect(quoteLargeAppIds('{"app_id":1234567890123456}')).toBe('{"app_id":"1234567890123456"}');
    expect(quoteLargeAppIds('{"app_id" :  9007199254740993,"x":1}')).toBe('{"app_id" :  "9007199254740993","x":1}');
  });

  it('giữ nguyên app_id ngắn hơn 16 chữ số (an toàn trong JSON number) và app_id đã là chuỗi', () => {
    expect(quoteLargeAppIds('{"app_id":263902037430900}')).toBe('{"app_id":263902037430900}'); // 15 chữ số
    expect(quoteLargeAppIds('{"app_id":"1234567890123456"}')).toBe('{"app_id":"1234567890123456"}');
  });

  it('xử lý nhiều app_id trong một payload', () => {
    const out = quoteLargeAppIds('[{"app_id":1111111111111111},{"app_id":2222222222222222}]');
    expect(JSON.parse(out)).toEqual([{ app_id: '1111111111111111' }, { app_id: '2222222222222222' }]);
  });

  it('KHÔNG đụng vào nội dung tin nhắn dù khách gõ đúng chuỗi trông như khóa app_id (dấu nháy bị escape trong JSON)', () => {
    const text = '"app_id": 1234567890123456';
    const raw = JSON.stringify({ message: { text } });
    expect(raw).toContain('\\"app_id\\"');
    expect(quoteLargeAppIds(raw)).toBe(raw);
    expect(JSON.parse(quoteLargeAppIds(raw)).message.text).toBe(text);
  });

  it('không đổi các số dài ở khóa khác (chỉ khóa app_id)', () => {
    const raw = '{"timestamp":1234567890123456,"other_app_id":1234567890123456}';
    expect(quoteLargeAppIds(raw)).toBe(raw);
  });
});
