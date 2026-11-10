/**
 * Extractor gọi Claude qua `@anthropic-ai/sdk` với structured outputs (`output_config.format`).
 * CHƯA được thử với khóa API thật (xem PROGRESS.md). Test dùng `fetch` giả.
 *
 * Quy tắc từ tài liệu API cho Haiku 5.5: không gửi `thinking` (mặc định adaptive, `budget_tokens` bị 400),
 * không gửi `temperature`/`top_p`/`top_k`, không prefill; `effort` mặc định `medium`, ở đây đặt `low`.
 * `max_tokens` để dư vì thinking tính vào `max_tokens`. Không có fallback phía server cho Haiku 5.5:
 * từ chối thì trả `refused`, pipeline ghi run `failed`.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { buildUserContent, SYSTEM_PROMPT } from './prompt.js';
import {
  type Candidate,
  type Extractor,
  type ExtractorInput,
  type ExtractorOutcome,
  INTENTS,
  MESSAGE_PURPOSES,
  MODEL_FIELDS,
  type TokenUsage,
} from './types.js';

/** Schema đầu ra của mô hình. Chỉ dùng tính năng JSON Schema cơ bản (enum, mảng, chuỗi). */
export const modelOutputSchema = z.object({
  fields: z.array(
    z.object({
      field: z.enum(MODEL_FIELDS),
      value: z.string(),
      quotes: z.array(z.object({ message_id: z.string(), quote: z.string() })),
    }),
  ),
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** Lỗi tạm thời (mạng, 429, 5xx, timeout) hoặc cấu hình sai (401/400): ném để hàng đợi retry hoặc dừng. */
export class ExtractorProviderError extends Error {
  override readonly name = 'ExtractorProviderError';
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export interface AnthropicExtractorOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxTokens?: number;
  /** Tiêm client (test). Mặc định tạo client mới với `apiKey`. */
  client?: Anthropic;
  /** Tiêm `fetch` (test). Bỏ qua nếu đã truyền `client`. */
  fetch?: typeof fetch;
}

const ENUM_VALUE_CHECK: Record<string, readonly string[]> = {
  message_purpose: MESSAGE_PURPOSES,
  intent: INTENTS,
};

export function toCandidates(output: ModelOutput): Candidate[] {
  const out: Candidate[] = [];
  for (const f of output.fields) {
    const allowed = ENUM_VALUE_CHECK[f.field];
    if (allowed && !allowed.includes(f.value)) continue; // giá trị ngoài danh sách thì bỏ
    out.push({ field: f.field, value: f.value, quotes: f.quotes.map((q) => ({ messageId: q.message_id, quote: q.quote })) });
  }
  return out;
}

export class AnthropicExtractor implements Extractor {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly apiKey: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicExtractorOptions) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.maxTokens = opts.maxTokens ?? 8000;
    this.client =
      opts.client ??
      new Anthropic({
        apiKey: opts.apiKey,
        timeout: opts.timeoutMs,
        maxRetries: 0, // retry do hàng đợi (có backoff và dead-letter), không để SDK retry ngầm
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      });
  }

  /** Bỏ khóa API khỏi mọi thông điệp lỗi trước khi ném ra ngoài (log, dead-letter). */
  private scrub(message: string): string {
    return this.apiKey ? message.split(this.apiKey).join('[đã ẩn]') : message;
  }

  async extract(input: ExtractorInput): Promise<ExtractorOutcome> {
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    try {
      // Dùng `create` (không phải `parse`): `parse` ném lỗi khi đầu ra bị cắt, trước khi ta đọc được `stop_reason`.
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: buildUserContent(input) }],
        output_config: { effort: 'low', format: zodOutputFormat(modelOutputSchema) },
      });
      usage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      };
      // Kiểm tra dừng bất thường TRƯỚC khi đọc đầu ra.
      if (res.stop_reason === 'refusal') return { kind: 'refused', usage };
      if (res.stop_reason === 'max_tokens') return { kind: 'max_tokens', usage };
      const textBlock = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      if (!textBlock) return { kind: 'invalid', usage };
      let json: unknown;
      try {
        json = JSON.parse(textBlock.text);
      } catch {
        return { kind: 'invalid', usage };
      }
      const checked = modelOutputSchema.safeParse(json);
      if (!checked.success) return { kind: 'invalid', usage };
      return { kind: 'ok', candidates: toCandidates(checked.data), usage };
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionError) {
        // Con của APIError: kiểm trước.
        throw new ExtractorProviderError(this.scrub(`lỗi kết nối tới Anthropic: ${err.message}`), null);
      }
      if (err instanceof Anthropic.APIError) {
        throw new ExtractorProviderError(this.scrub(`Anthropic trả lỗi ${err.status ?? 'không rõ'}: ${err.message}`), err.status ?? null);
      }
      throw new ExtractorProviderError(this.scrub(err instanceof Error ? err.message : String(err)), null);
    }
  }
}
