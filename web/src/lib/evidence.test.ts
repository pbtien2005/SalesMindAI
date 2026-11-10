import { describe, expect, it } from 'vitest';
import { evidenceOf } from '../test/fixtures';
import { quoteContext, segmentText, validRanges } from './evidence';

const TEXT = 'Số mình là 0912 345 678. Cuối tuần này mình ghé xem được không?';

describe('segmentText', () => {
  it('tô đúng đoạn câu gốc', () => {
    const parts = segmentText(TEXT, [evidenceOf('m', TEXT, '0912 345 678')]);
    expect(parts).toEqual([
      { text: 'Số mình là ', mark: false },
      { text: '0912 345 678', mark: true },
      { text: '. Cuối tuần này mình ghé xem được không?', mark: false },
    ]);
    expect(parts.map((p) => p.text).join('')).toBe(TEXT);
  });

  it('nhiều câu gốc trong một tin, đúng thứ tự dù đưa vào lộn xộn', () => {
    const parts = segmentText(TEXT, [evidenceOf('m', TEXT, 'Cuối tuần này'), evidenceOf('m', TEXT, '0912 345 678')]);
    expect(parts.filter((p) => p.mark).map((p) => p.text)).toEqual(['0912 345 678', 'Cuối tuần này']);
    expect(parts.map((p) => p.text).join('')).toBe(TEXT);
  });

  it('câu gốc chồng nhau được gộp', () => {
    const a = evidenceOf('m', TEXT, '0912 345');
    const b = evidenceOf('m', TEXT, '345 678');
    expect(segmentText(TEXT, [a, b]).filter((p) => p.mark).map((p) => p.text)).toEqual(['0912 345 678']);
  });

  it('không có câu gốc thì trả nguyên văn', () => {
    expect(segmentText(TEXT, [])).toEqual([{ text: TEXT, mark: false }]);
  });

  it('offset lệch chữ thì KHÔNG tô (không tô nhầm chỗ)', () => {
    const wrong = { messageId: 'm', start: 0, end: 5, text: '0912 ' };
    expect(segmentText(TEXT, [wrong])).toEqual([{ text: TEXT, mark: false }]);
    expect(validRanges(TEXT, [wrong])).toEqual([]);
  });

  it('offset ngoài phạm vi hoặc rỗng bị bỏ', () => {
    expect(validRanges('abc', [{ messageId: 'm', start: 2, end: 99, text: 'c' }])).toEqual([]);
    expect(validRanges('abc', [{ messageId: 'm', start: 1, end: 1, text: '' }])).toEqual([]);
    expect(validRanges('abc', [{ messageId: 'm', start: -1, end: 2, text: 'ab' }])).toEqual([]);
    expect(validRanges('abc', [{ messageId: 'm', start: 0.5, end: 2, text: 'b' }])).toEqual([]);
  });

  it('emoji (ngoài BMP) đứng trước câu gốc vẫn tô đúng vì dùng đơn vị UTF-16', () => {
    const text = 'Dạ 😀 tầm 15 triệu nhé';
    const parts = segmentText(text, [evidenceOf('m', text, 'tầm 15 triệu')]);
    expect(parts.find((p) => p.mark)?.text).toBe('tầm 15 triệu');
  });
});

describe('quoteContext', () => {
  it('lấy chữ xung quanh và báo có cắt', () => {
    const q = quoteContext(TEXT, evidenceOf('m', TEXT, '0912 345 678'), 6);
    expect(q).toEqual({ before: 'mình là ' .slice(-6), match: '0912 345 678', after: '. Cuối', cutBefore: true, cutAfter: true });
  });

  it('không cắt khi câu gốc nằm sát đầu/cuối', () => {
    const t = 'tầm 15 triệu';
    expect(quoteContext(t, evidenceOf('m', t, 'tầm 15 triệu'))).toEqual({ before: '', match: t, after: '', cutBefore: false, cutAfter: false });
  });

  it('trả null khi offset không khớp', () => {
    expect(quoteContext(TEXT, { messageId: 'm', start: 0, end: 4, text: 'XXXX' })).toBeNull();
  });
});
