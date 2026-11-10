import { describe, expect, it } from 'vitest';
import { NEEDS_CLARIFICATION } from '../api/types';
import { detail, evidenceOf, proposal } from '../test/fixtures';
import { allEvidence, buildCardRows } from './card';

const rowOf = (d: ReturnType<typeof detail>, field: string) => {
  const r = buildCardRows(d).find((x) => x.field === field);
  if (!r) throw new Error(`thiếu dòng ${field}`);
  return r;
};

describe('buildCardRows', () => {
  it('hội thoại trống: mọi trường là "thiếu"', () => {
    expect(buildCardRows(detail()).every((r) => r.state === 'missing')).toBe(true);
  });

  it('trường nhẹ AI điền: state ai, kèm câu gốc', () => {
    const t = 'Khoảng tầm 15 triệu thôi bạn.';
    const ev = evidenceOf('m1', t, 'tầm 15 triệu');
    const d = detail({ autoFill: [proposal({ id: 'p1', field: 'budget', value: { text: '15 triệu' }, evidence: [ev] })] });
    expect(rowOf(d, 'budget')).toMatchObject({ state: 'ai', text: '15 triệu', evidence: [ev] });
  });

  it('SĐT đang chờ trong Hộp đề xuất: chưa có giá trị trên thẻ', () => {
    const d = detail({ box: [{ kind: 'proposal', ...proposal({ id: 'p2', field: 'phone', value: { text: '0912 345 678' } }) }] });
    expect(rowOf(d, 'phone')).toMatchObject({ state: 'pending_review', text: '' });
  });

  it('mốc hẹn mơ hồ: needs_date và KHÔNG có ngày', () => {
    const d = detail({
      box: [{ kind: 'proposal', ...proposal({ id: 'p3', field: 'timeline', value: { text: 'cuối tuần này', kind: 'vague', sentAt: '2026-11-13T02:28:00Z' }, flags: [NEEDS_CLARIFICATION] }) }],
    });
    const r = rowOf(d, 'timeline');
    expect(r.state).toBe('needs_date');
    expect(r.text).toBe('');
  });

  it('đã duyệt thắng đề xuất: hiện người duyệt', () => {
    const d = detail({
      approved: [{ field: 'phone', value: { text: '0912 345 678' }, version: 1, updatedAt: '2026-11-13T02:31:00Z', decidedBy: 'Lan', status: 'accepted' }],
      box: [{ kind: 'proposal', ...proposal({ id: 'p2', field: 'phone', value: { text: '0999 999 999' } }) }],
    });
    expect(rowOf(d, 'phone')).toMatchObject({ state: 'approved', text: '0912 345 678', decidedBy: 'Lan', edited: false });
  });

  it('SĐT đã duyệt được chia nhóm khi hiển thị', () => {
    const d = detail({ approved: [{ field: 'phone', value: { text: '0912345678' }, version: 1, updatedAt: '2026-11-13T02:31:00Z', decidedBy: 'Lan', status: 'accepted' }] });
    expect(rowOf(d, 'phone').text).toBe('0912 345 678');
  });

  it('đã sửa được đánh dấu edited', () => {
    const d = detail({ approved: [{ field: 'phone', value: { text: '0912 345 679' }, version: 2, updatedAt: '2026-11-13T02:31:00Z', decidedBy: 'Lan', status: 'edited' }] });
    expect(rowOf(d, 'phone').edited).toBe(true);
  });

  it('mốc hẹn đã duyệt hiện ngày Sale chọn (chosenAt), theo giờ VN', () => {
    const d = detail({
      approved: [{ field: 'timeline', value: { text: 'cuối tuần này', kind: 'vague', chosenAt: '2026-11-14T10:00:00+07:00' }, version: 1, updatedAt: '2026-11-13T02:40:00Z', decidedBy: 'Lan', status: 'accepted' }],
    });
    expect(rowOf(d, 'timeline')).toMatchObject({ state: 'approved', text: 'Thứ Bảy 14/11 10:00' });
  });

  it('tín hiệu nội bộ (intent) không xuất hiện trên thẻ', () => {
    const d = detail({ autoFill: [proposal({ id: 'p9', field: 'intent', value: { text: 'interested' } })] });
    expect(buildCardRows(d).some((r) => r.field === 'intent')).toBe(false);
  });
});

describe('allEvidence', () => {
  it('gom câu gốc từ trường nhẹ và Hộp đề xuất, bỏ mục ngừng bám', () => {
    const a = evidenceOf('m1', 'tầm 15 triệu', 'tầm 15 triệu');
    const b = evidenceOf('m2', 'Số mình 0912 345 678', '0912 345 678');
    const d = detail({
      autoFill: [proposal({ id: 'p1', field: 'budget', evidence: [a] })],
      box: [{ kind: 'proposal', ...proposal({ id: 'p2', field: 'phone', evidence: [b] }) }, { kind: 'stop_followup', reason: 'x', count: 5, max: 5 }],
    });
    expect(allEvidence(d)).toEqual([a, b]);
  });
});
