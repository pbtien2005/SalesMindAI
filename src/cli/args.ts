import { parseArgs } from 'node:util';
import type { DeadLetterTarget } from '../queue/admin.js';

/** Lỗi do người dùng nhập sai tham số; thông báo dành cho người dùng. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

function parse<T extends Record<string, { type: 'string' | 'boolean' }>>(args: string[], options: T) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (err) {
    const code = (err as { code?: string }).code;
    const msg = err instanceof Error ? err.message : String(err);
    const opt = /'(--[^']+)'/.exec(msg)?.[1];
    if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') throw new UsageError(`Cờ không hợp lệ: ${opt ?? msg}.`);
    if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') throw new UsageError(`Cờ ${opt ?? ''} thiếu giá trị.`.replace('  ', ' '));
    throw new UsageError(msg);
  }
}

/**
 * `queue:redrive <webhook|backfill> [--limit N] [--dry-run]`.
 * Dùng parseArgs của Node nên thứ tự tham số không quan trọng (`--limit 5 webhook` cũng đúng) và cờ
 * lạ bị từ chối thay vì bị bỏ qua.
 */
export function parseRedriveArgs(args: string[]): { target: DeadLetterTarget; limit?: number; dryRun: boolean } {
  const { values, positionals } = parse(args, { limit: { type: 'string' }, 'dry-run': { type: 'boolean' } });
  if (positionals.length !== 1) throw new UsageError('Cần đúng một đích: webhook, backfill hoặc extraction.');
  const target = positionals[0];
  if (target !== 'webhook' && target !== 'backfill' && target !== 'extraction') {
    throw new UsageError(`Đích không hợp lệ "${target}": chỉ nhận webhook, backfill hoặc extraction.`);
  }

  let limit: number | undefined;
  if (values.limit !== undefined) {
    limit = Number(values.limit);
    if (!/^\d+$/.test(values.limit) || !Number.isSafeInteger(limit) || limit < 1) {
      throw new UsageError('--limit phải là số nguyên dương.');
    }
  }
  return { target, ...(limit !== undefined ? { limit } : {}), dryRun: values['dry-run'] === true };
}

/** `proposals:decide <proposalId> <accept|edit|dismiss> --by <tên> [--text <giá trị sửa>] [--at <ISO 8601 có múi giờ>]`. */
export function parseDecideArgs(args: string[]): {
  proposalId: string;
  action: 'accept' | 'edit' | 'dismiss';
  by: string;
  text?: string;
  at?: string;
} {
  const { values, positionals } = parse(args, { by: { type: 'string' }, text: { type: 'string' }, at: { type: 'string' } });
  if (positionals.length !== 2) throw new UsageError('Cần đúng hai tham số: <proposalId> <accept|edit|dismiss>.');
  const [proposalId, action] = positionals as [string, string];
  if (action !== 'accept' && action !== 'edit' && action !== 'dismiss') throw new UsageError(`Hành động không hợp lệ "${action}": chỉ nhận accept, edit hoặc dismiss.`);
  if (!values.by?.trim()) throw new UsageError('Thiếu --by <tên người quyết định>.');
  if (action === 'edit' && !values.text?.trim()) throw new UsageError('edit cần --text <giá trị mới>.');
  return { proposalId, action, by: values.by, ...(values.text !== undefined ? { text: values.text } : {}), ...(values.at !== undefined ? { at: values.at } : {}) };
}

/** `demo:send <persona> <nội dung...> [--page]`: `--page` gửi như Lan ở Page Inbox (persona là khách nhận). */
export function parseDemoSendArgs(args: string[]): { persona: string; text: string; asPage: boolean } {
  const { values, positionals } = parse(args, { page: { type: 'boolean' } });
  const [persona, ...rest] = positionals;
  if (!persona || rest.length === 0) throw new UsageError('Dùng: demo:send <persona> <nội dung> [--page].');
  return { persona, text: rest.join(' '), asPage: values.page === true };
}

/** `demo:clock [--advance <phút>] [--to <ISO có múi giờ>]`: không tham số thì chỉ in giờ demo. */
export function parseDemoClockArgs(args: string[]): { advanceMinutes?: number; to?: string } {
  const { values, positionals } = parse(args, { advance: { type: 'string' }, to: { type: 'string' } });
  if (positionals.length > 0) throw new UsageError('demo:clock không nhận tham số vị trí.');
  if (values.advance !== undefined && values.to !== undefined) throw new UsageError('Chỉ dùng một trong --advance hoặc --to.');
  if (values.advance !== undefined) {
    const n = Number(values.advance);
    if (!Number.isFinite(n) || n <= 0) throw new UsageError('--advance phải là số phút dương.');
    return { advanceMinutes: n };
  }
  if (values.to !== undefined) {
    if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(values.to) || Number.isNaN(Date.parse(values.to))) throw new UsageError('--to phải là ISO 8601 có múi giờ, ví dụ 2026-11-13T09:30:00+07:00.');
    return { to: values.to };
  }
  return {};
}

/** `backfill [<fbPageId>] [--force]`. */
export function parseBackfillArgs(args: string[]): { fbPageId?: string; force: boolean } {
  const { values, positionals } = parse(args, { force: { type: 'boolean' } });
  if (positionals.length > 1) throw new UsageError('Chỉ nhận tối đa một ID Page.');
  return { ...(positionals[0] ? { fbPageId: positionals[0] } : {}), force: values.force === true };
}
