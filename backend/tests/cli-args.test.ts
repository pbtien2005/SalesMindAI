import { describe, expect, it } from 'vitest';
import { parseBackfillArgs, parseRedriveArgs, UsageError } from '../src/cli/args.js';

describe('parseRedriveArgs', () => {
  it.each([
    ['chỉ đích', ['webhook'], { target: 'webhook', dryRun: false }],
    ['backfill', ['backfill'], { target: 'backfill', dryRun: false }],
    ['đích trước, cờ sau', ['webhook', '--limit', '5'], { target: 'webhook', limit: 5, dryRun: false }],
    ['cờ trước, đích sau (lỗi cũ: đọc nhầm "50" thành đích)', ['--limit', '50', 'webhook'], { target: 'webhook', limit: 50, dryRun: false }],
    ['--limit=N', ['--limit=7', 'backfill'], { target: 'backfill', limit: 7, dryRun: false }],
    ['--dry-run đứng trước', ['--dry-run', 'webhook'], { target: 'webhook', dryRun: true }],
    ['đủ cờ, thứ tự bất kỳ', ['--dry-run', '--limit', '3', 'webhook'], { target: 'webhook', limit: 3, dryRun: true }],
  ])('chấp nhận %s', (_n, args, expected) => {
    expect(parseRedriveArgs(args)).toEqual(expected);
  });

  it.each([
    ['thiếu đích', []],
    ['chỉ có cờ', ['--dry-run']],
    ['đích không hợp lệ', ['dead']],
    ['hai đích', ['webhook', 'backfill']],
    ['--limit không phải số', ['webhook', '--limit', 'abc']],
    ['--limit bằng 0', ['webhook', '--limit', '0']],
    ['--limit âm', ['webhook', '--limit=-3']],
    ['--limit thập phân', ['webhook', '--limit', '2.5']],
    ['--limit quá lớn', ['webhook', '--limit', '99999999999999999999']],
    ['--limit thiếu giá trị', ['webhook', '--limit']],
    ['cờ lạ (không bị bỏ qua im lặng)', ['webhook', '--force']],
  ])('từ chối %s bằng UsageError', (_n, args) => {
    expect(() => parseRedriveArgs(args)).toThrow(UsageError);
  });
});

describe('parseBackfillArgs', () => {
  it.each([
    ['không tham số', [], { force: false }],
    ['một Page', ['123'], { fbPageId: '123', force: false }],
    ['--force', ['--force'], { force: true }],
    ['Page rồi --force', ['123', '--force'], { fbPageId: '123', force: true }],
    ['--force rồi Page', ['--force', '123'], { fbPageId: '123', force: true }],
  ])('chấp nhận %s', (_n, args, expected) => {
    expect(parseBackfillArgs(args)).toEqual(expected);
  });

  it.each([
    ['hai Page', ['1', '2']],
    ['cờ lạ', ['--all']],
  ])('từ chối %s', (_n, args) => {
    expect(() => parseBackfillArgs(args)).toThrow(UsageError);
  });
});
