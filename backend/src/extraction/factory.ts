import { AnthropicExtractor } from './anthropic-extractor.js';
import { OfflineExtractor } from './offline-extractor.js';
import type { Extractor } from './types.js';

export interface ExtractorConfig {
  AI_MODE: 'offline' | 'live';
  ANTHROPIC_API_KEY: string | undefined;
  AI_MODEL: string;
  AI_TIMEOUT_MS: number;
}

/**
 * `live` cần khóa API; thiếu khóa thì ném lỗi rõ ràng (không lặng lẽ chuyển sang offline, vì người vận hành
 * tưởng đang dùng AI thật).
 */
export function createExtractor(cfg: ExtractorConfig): Extractor {
  if (cfg.AI_MODE === 'offline') return new OfflineExtractor();
  if (!cfg.ANTHROPIC_API_KEY) throw new Error('AI_MODE=live nhưng chưa đặt ANTHROPIC_API_KEY.');
  return new AnthropicExtractor({ apiKey: cfg.ANTHROPIC_API_KEY, model: cfg.AI_MODEL, timeoutMs: cfg.AI_TIMEOUT_MS });
}
