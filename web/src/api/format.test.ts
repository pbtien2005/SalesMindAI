import { describe, expect, it } from 'vitest';
import { daysOverdue, formatDateTime, formatDay, formatInboxTime, formatPhoneDisplay, formatTime, formatWait, nextWeekendPicks, toIsoWithOffset, toLocalInput } from './format';

// Kịch bản demo: Thứ Năm 12/11/2026 09:00 giờ VN = 02:00Z.
const THU_0900 = '2026-11-12T02:00:00.000Z';
const FRI_0930 = '2026-11-13T02:30:00.000Z';

describe('định dạng thời gian theo giờ Việt Nam', () => {
  it('đổi UTC sang UTC+7 và đúng thứ trong tuần', () => {
    expect(formatDateTime(THU_0900)).toBe('Thứ Năm 12/11 09:00');
    expect(formatDateTime(FRI_0930)).toBe('Thứ Sáu 13/11 09:30');
    expect(formatDay(FRI_0930)).toBe('Thứ Sáu 13/11');
    expect(formatTime(FRI_0930)).toBe('09:30');
  });

  it('qua nửa đêm UTC vẫn tính đúng ngày VN', () => {
    // 20:00Z ngày 13/11 = 03:00 ngày 14/11 giờ VN (Thứ Bảy).
    expect(formatDateTime('2026-11-13T20:00:00Z')).toBe('Thứ Bảy 14/11 03:00');
  });

  it('chuỗi sai trả rỗng, không ném lỗi', () => {
    expect(formatDateTime('không phải ngày')).toBe('');
    expect(formatInboxTime('x', THU_0900)).toBe('');
  });

  it('nhãn thời gian ở danh sách hội thoại', () => {
    expect(formatInboxTime('2026-11-12T02:28:00Z', THU_0900)).toBe('09:28'); // cùng ngày
    expect(formatInboxTime('2026-11-11T08:00:00Z', THU_0900)).toBe('Hôm qua');
    expect(formatInboxTime('2026-11-11T02:00:00Z', THU_0900)).toBe('Hôm qua');
    expect(formatInboxTime('2026-11-11T20:00:00Z', THU_0900)).toBe('03:00'); // 03:00 ngày 12 giờ VN = cùng ngày với bây giờ
    expect(formatInboxTime('2026-11-09T02:00:00Z', THU_0900)).toBe('T2'); // 3 ngày trước
    expect(formatInboxTime('2026-10-01T02:00:00Z', THU_0900)).toBe('01/10');
  });

  it('thời gian chờ', () => {
    expect(formatWait(0)).toBe('0 phút');
    expect(formatWait(22)).toBe('22 phút');
    expect(formatWait(60)).toBe('1 giờ');
    expect(formatWait(65)).toBe('1 giờ 5 phút');
    expect(formatWait(3 * 24 * 60 + 5)).toBe('3 ngày');
    expect(formatWait(-5)).toBe('0 phút');
  });

  it('số ngày quá hạn tính theo ngày lịch VN', () => {
    // Hạn Thứ Hai 09/11 15:00 (08:00Z), bây giờ Thứ Năm 12/11 09:00.
    expect(daysOverdue('2026-11-09T08:00:00Z', THU_0900)).toBe(3);
    expect(daysOverdue('2026-11-11T10:00:00Z', THU_0900)).toBe(1);
    expect(daysOverdue('2026-11-14T03:00:00Z', THU_0900)).toBe(-2);
  });
});

describe('formatPhoneDisplay (chỉ để hiển thị)', () => {
  it('chia nhóm số di động 10 chữ số', () => {
    expect(formatPhoneDisplay('0912345678')).toBe('0912 345 678');
    expect(formatPhoneDisplay('0912 345 678')).toBe('0912 345 678');
  });
  it('dạng khác giữ nguyên, không đoán', () => {
    expect(formatPhoneDisplay('+84912345678')).toBe('+84912345678');
    expect(formatPhoneDisplay('091234567')).toBe('091234567');
    expect(formatPhoneDisplay('abc')).toBe('abc');
  });
});

describe('nextWeekendPicks (chọn nhanh, không điền sẵn)', () => {
  it('tin gửi Thứ Sáu 13/11 -> Thứ Bảy 14/11 và Chủ Nhật 15/11 lúc 10:00', () => {
    expect(nextWeekendPicks(FRI_0930)).toEqual([
      { label: 'Thứ Bảy 14/11 10:00', local: '2026-11-14T10:00' },
      { label: 'Chủ Nhật 15/11 10:00', local: '2026-11-15T10:00' },
    ]);
  });

  it('tin gửi đúng Thứ Bảy thì lấy Thứ Bảy tuần sau (luôn SAU ngày gửi)', () => {
    expect(nextWeekendPicks('2026-11-14T03:00:00Z')[0]?.local).toBe('2026-11-21T10:00');
    expect(nextWeekendPicks('2026-11-14T03:00:00Z')[1]?.local).toBe('2026-11-15T10:00');
  });

  it('qua tháng và qua năm', () => {
    expect(nextWeekendPicks('2026-12-30T03:00:00Z').map((p) => p.local)).toEqual(['2027-01-02T10:00', '2027-01-03T10:00']);
  });

  it('thời điểm sai trả mảng rỗng', () => {
    expect(nextWeekendPicks('???')).toEqual([]);
  });

  it('kết quả đi qua toIsoWithOffset thành ISO hợp lệ', () => {
    expect(toIsoWithOffset(nextWeekendPicks(FRI_0930)[0]!.local)).toBe('2026-11-14T10:00:00+07:00');
  });
});

describe('toIsoWithOffset (chosenAt gửi cho backend)', () => {
  it('đổi datetime-local thành ISO có offset +07:00', () => {
    expect(toIsoWithOffset('2026-11-14T10:00')).toBe('2026-11-14T10:00:00+07:00');
  });

  it('kết quả trỏ đúng thời điểm (10:00 VN = 03:00Z)', () => {
    expect(new Date(toIsoWithOffset('2026-11-14T10:00') as string).toISOString()).toBe('2026-11-14T03:00:00.000Z');
  });

  it('rỗng hoặc sai dạng trả null: không bao giờ tự điền ngày', () => {
    expect(toIsoWithOffset('')).toBeNull();
    expect(toIsoWithOffset('cuối tuần này')).toBeNull();
    expect(toIsoWithOffset('2026-11-14')).toBeNull();
    expect(toIsoWithOffset('2026-11-14T10:00:00')).toBeNull();
  });

  it('ngày không tồn tại bị từ chối', () => {
    expect(toIsoWithOffset('2026-02-30T10:00')).toBeNull();
    expect(toIsoWithOffset('2026-13-01T10:00')).toBeNull();
    expect(toIsoWithOffset('2026-11-14T24:00')).toBeNull();
    expect(toIsoWithOffset('2026-11-14T10:60')).toBeNull();
  });

  it('toLocalInput đảo ngược toIsoWithOffset', () => {
    const iso = toIsoWithOffset('2026-11-14T10:00') as string;
    expect(toLocalInput(iso)).toBe('2026-11-14T10:00');
  });
});
