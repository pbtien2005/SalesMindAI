import { AnthropicBillReader } from './anthropic-bill-reader.js';
import { OfflineBillReader } from './offline-bill-reader.js';
import type { BillReader } from './types.js';

export interface BillReaderConfig {
  AI_MODE: 'offline' | 'live';
  ANTHROPIC_API_KEY: string | undefined;
  AI_MODEL: string;
  AI_TIMEOUT_MS: number;
}

/** `live` cần khóa API (không lặng lẽ chuyển sang bộ đọc mô phỏng). */
export function createBillReader(cfg: BillReaderConfig): BillReader {
  if (cfg.AI_MODE === 'offline') return new OfflineBillReader();
  if (!cfg.ANTHROPIC_API_KEY) throw new Error('AI_MODE=live nhưng chưa đặt ANTHROPIC_API_KEY.');
  return new AnthropicBillReader({ apiKey: cfg.ANTHROPIC_API_KEY, model: cfg.AI_MODEL, timeoutMs: cfg.AI_TIMEOUT_MS });
}
