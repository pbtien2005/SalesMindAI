import { describe, expect, it } from 'vitest';
import { findPhones } from '../src/extraction/phone.js';
import { classifyTime, needsClarification } from '../src/extraction/time-expr.js';
import { locateQuote } from '../src/extraction/verify-evidence.js';

describe('locateQuote (kiểm chứng câu gốc)', () => {
  const msg = 'Chào shop, anh đang tìm sofa phòng khách tầm 15 triệu';

  it('khớp nguyên văn và trả offset đúng trên văn bản gốc', () => {
    const r = locateQuote(msg, 'tầm 15 triệu');
    expect(r).not.toBeNull();
    expect(msg.slice(r!.start, r!.end)).toBe('tầm 15 triệu');
    expect(r!.text).toBe('tầm 15 triệu');
  });

  it('khớp khi mô hình bỏ dấu, đổi hoa thường hoặc thêm khoảng trắng; vẫn trả đoạn GỐC có dấu', () => {
    for (const q of ['tam 15 trieu', 'TẦM  15   TRIỆU', ' Tầm 15 triệu ']) {
      const r = locateQuote(msg, q);
      expect(r?.text, q).toBe('tầm 15 triệu');
    }
  });

  it('xử lý chữ đ', () => {
    expect(locateQuote(msg, 'đang tim sofa')?.text).toBe('đang tìm sofa');
    expect(locateQuote(msg, 'DANG TIM')?.text).toBe('đang tìm');
  });

  it('văn bản dạng NFD (dấu rời): offset vẫn bao cả dấu', () => {
    const nfd = 'anh tàm 15 triệu thoi'; // "anh tàm 15 triệu thoi" ở dạng tổ hợp
    const r = locateQuote(nfd, 'trieu thoi');
    expect(r).not.toBeNull();
    expect(nfd.slice(r!.start, r!.end)).toBe(r!.text);
    expect(r!.text.normalize('NFC')).toBe('triệu thoi');
  });

  it('gộp khoảng trắng và xuống dòng trong tin gốc', () => {
    const r = locateQuote('sofa   xám\n\ngiá  rẻ', 'sofa xám giá rẻ');
    expect(r?.text).toBe('sofa   xám\n\ngiá  rẻ');
  });

  it('câu bịa, gần giống nhưng không phải chuỗi con, hoặc rỗng thì bị loại', () => {
    expect(locateQuote(msg, 'tầm 20 triệu')).toBeNull();
    expect(locateQuote(msg, 'ngân sách 15 triệu')).toBeNull();
    expect(locateQuote(msg, 'tầm 15 triệu đồng')).toBeNull();
    expect(locateQuote(msg, '')).toBeNull();
    expect(locateQuote(msg, '   ')).toBeNull();
  });

  it('không phụ thuộc phiên bản Unicode của quote', () => {
    expect(locateQuote(msg, 'tầm 15 triệu'.normalize('NFD'))?.text).toBe('tầm 15 triệu');
  });

  it('emoji trước quote không làm lệch offset', () => {
    const t = '😀😀 sofa xám';
    const r = locateQuote(t, 'sofa xam');
    expect(t.slice(r!.start, r!.end)).toBe('sofa xám');
  });
});

describe('findPhones', () => {
  const cases: Array<[string, string[]]> = [
    ['SĐT anh 0912 345 678. Cuối tuần này anh ghé', ['0912345678']],
    ['0912345678', ['0912345678']],
    ['gọi 0912.345.678 nhé', ['0912345678']],
    ['gọi 0912-345-678 nhé', ['0912345678']],
    ['số +84 912 345 678', ['0912345678']],
    ['số +84912345678', ['0912345678']],
    ['số 84912345678', ['0912345678']],
    ['0345678901 và 0987654321', ['0345678901', '0987654321']],
    ['0123456789', []], // đầu số 01 không phải di động hiện hành
    ['01234567890', []], // 11 chữ số kiểu cũ
    ['09123456789', []], // 11 chữ số: không cắt 10 chữ số đầu
    ['tài khoản 1234567890123', []],
    ['mã đơn 100912345678', []], // số 0912345678 nằm giữa chuỗi số dài
    ['giá 15.000.000', []],
    ['cần 84 triệu', []],
    ['0212345678', []], // đầu số 02 là số bàn
  ];
  it.each(cases)('%s', (text, expected) => {
    expect(findPhones(text).map((p) => p.value)).toEqual(expected);
  });

  it('trả đúng offset và đoạn gốc', () => {
    const t = 'SĐT anh 0912 345 678. Cuối tuần';
    const [p] = findPhones(t);
    expect(t.slice(p!.start, p!.end)).toBe('0912 345 678');
    expect(p!.text).toBe('0912 345 678');
  });
});

describe('classifyTime (chỉ phân loại, không giải ngày)', () => {
  const cases: Array<[string, ReturnType<typeof classifyTime>]> = [
    ['cuối tuần này', 'relative'],
    ['Cuối tuần này anh ghé shop', 'relative'],
    ['cuoi tuan nay', 'relative'],
    ['mai', 'relative'],
    ['ngày mai', 'relative'],
    ['sáng mai', 'relative'],
    ['thứ 6', 'relative'],
    ['thứ sáu', 'relative'],
    ['chủ nhật', 'relative'],
    ['tuần sau', 'relative'],
    ['tháng sau', 'relative'],
    ['3 ngày nữa', 'relative'],
    ['14/11', 'absolute'],
    ['14/11/2026', 'absolute'],
    ['ngày 14 tháng 11', 'absolute'],
    ['ngày 14', 'absolute'],
    ['khi nào rảnh', 'vague'],
    ['sớm', 'vague'],
    ['sắp tới', 'vague'],
    ['một bộ sofa', 'none'],
    ['sofa màu xám', 'none'],
    ['15 triệu', 'none'],
    ['', 'none'],
  ];
  it.each(cases)('%s → %s', (phrase, kind) => {
    expect(classifyTime(phrase)).toBe(kind);
  });

  it('relative và vague cần hỏi lại; absolute và none thì không', () => {
    expect(needsClarification('relative')).toBe(true);
    expect(needsClarification('vague')).toBe(true);
    expect(needsClarification('absolute')).toBe(false);
    expect(needsClarification('none')).toBe(false);
  });

  it('module không xuất hàm nào trả ngày', async () => {
    const mod = await import('../src/extraction/time-expr.js');
    expect(Object.keys(mod).sort()).toEqual(['classifyTime', 'needsClarification']);
  });
});

import { findSkus } from '../src/extraction/sku.js';

describe('findSkus', () => {
  it('tìm mã hàng kèm offset đúng; không phân biệt hoa thường, trả về chữ hoa', () => {
    const text = 'lấy mã SF-021 nhé';
    const [s] = findSkus(text);
    expect(s).toMatchObject({ value: 'SF-021', text: 'SF-021' });
    expect(text.slice(s!.start, s!.end)).toBe('SF-021');
    expect(findSkus('mã sf-021')[0]!.value).toBe('SF-021');
  });
  it('không khớp mã quá ngắn hoặc dính vào chữ khác', () => {
    expect(findSkus('SF-0')).toEqual([]);
    expect(findSkus('1SF-021')).toEqual([]);
    expect(findSkus('SF-02111')).toEqual([]);
    expect(findSkus('không có mã')).toEqual([]);
  });
});
