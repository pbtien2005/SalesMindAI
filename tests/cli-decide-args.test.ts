import { describe, expect, it } from 'vitest';
import { parseDecideArgs, parseRedriveArgs, UsageError } from '../src/cli/args.js';

describe('parseDecideArgs', () => {
  it('accept với tên người duyệt', () => {
    expect(parseDecideArgs(['abc', 'accept', '--by', 'Lan'])).toEqual({ proposalId: 'abc', action: 'accept', by: 'Lan' });
  });
  it('thứ tự cờ không quan trọng; edit có --text; timeline có --at', () => {
    expect(parseDecideArgs(['--by', 'Lan', 'abc', 'edit', '--text', '12 triệu'])).toEqual({ proposalId: 'abc', action: 'edit', by: 'Lan', text: '12 triệu' });
    expect(parseDecideArgs(['abc', 'accept', '--by', 'Lan', '--at', '2026-11-14T10:00:00+07:00'])).toMatchObject({ at: '2026-11-14T10:00:00+07:00' });
  });
  it('từ chối đầu vào sai', () => {
    expect(() => parseDecideArgs(['abc', 'accept'])).toThrow(UsageError); // thiếu --by
    expect(() => parseDecideArgs(['abc', 'accept', '--by', ' '])).toThrow(UsageError);
    expect(() => parseDecideArgs(['abc', 'edit', '--by', 'Lan'])).toThrow(UsageError); // edit thiếu --text
    expect(() => parseDecideArgs(['abc', 'xoa', '--by', 'Lan'])).toThrow(UsageError);
    expect(() => parseDecideArgs(['abc', '--by', 'Lan'])).toThrow(UsageError);
    expect(() => parseDecideArgs(['abc', 'accept', '--by', 'Lan', '--la'])).toThrow(UsageError);
  });
});

describe('parseRedriveArgs nhận extraction', () => {
  it('nhận extraction, từ chối đích lạ', () => {
    expect(parseRedriveArgs(['extraction', '--dry-run'])).toEqual({ target: 'extraction', dryRun: true });
    expect(() => parseRedriveArgs(['khac'])).toThrow(UsageError);
  });
});
