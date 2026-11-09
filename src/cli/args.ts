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

/** `backfill [<fbPageId>] [--force]`. */
export function parseBackfillArgs(args: string[]): { fbPageId?: string; force: boolean } {
  const { values, positionals } = parse(args, { force: { type: 'boolean' } });
  if (positionals.length > 1) throw new UsageError('Chỉ nhận tối đa một ID Page.');
  return { ...(positionals[0] ? { fbPageId: positionals[0] } : {}), force: values.force === true };
}
