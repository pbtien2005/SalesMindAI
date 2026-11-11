import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnthropicBillReader, BillProviderError } from '../src/bills/anthropic-bill-reader.js';
import { createBillReader } from '../src/bills/factory.js';
import { OfflineBillReader } from '../src/bills/offline-bill-reader.js';
import { normalizeOutcome } from '../src/bills/types.js';

const KEY = 'sk-ant-test-KEY-123456';
const IMG = { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' as const };

function apiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const message = (payload: unknown, over: Record<string, unknown> = {}) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 60, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  ...over,
});
const good = { readable: true, amount_vnd: 6_000_000, transfer_note: 'Minh coc SF-021', bill_time: '13/11/2026 10:09', amount_box: { x: 0.05, y: 0.17, w: 0.9, h: 0.14 } };

function make(handler: (init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? '{}')) });
    return handler(init ?? {});
  }) as typeof fetch;
  return { reader: new AnthropicBillReader({ apiKey: KEY, model: 'claude-haiku-5-5', timeoutMs: 5000, fetch: fakeFetch }), calls };
}

describe('AnthropicBillReader (fetch giả)', () => {
  it('thành công: số tiền, nội dung, thời gian, vùng khoanh; request có khối ảnh base64 và đúng quy tắc Haiku 5.5', async () => {
    const { reader, calls } = make(() => apiResponse(message(good)));
    const r = await reader.read(IMG);
    expect(r).toMatchObject({ kind: 'ok', amountVnd: 6_000_000, transferNote: 'Minh coc SF-021', billTime: '13/11/2026 10:09', bbox: { x: 0.05, y: 0.17, w: 0.9, h: 0.14 }, usage: { inputTokens: 1200, outputTokens: 60 } });
    const body = calls[0]!.body;
    for (const k of ['thinking', 'temperature', 'top_p', 'top_k']) expect(body, k).not.toHaveProperty(k);
    const content = (body.messages as Array<{ content: Array<{ type: string; source?: { type: string; media_type: string; data: string } }> }>)[0]!.content;
    expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(IMG.bytes).toString('base64') } });
    expect((body.output_config as { format: { type: string } }).format.type).toBe('json_schema');
  });

  it('không đọc được thì unreadable', async () => {
    const { reader } = make(() => apiResponse(message({ readable: false, amount_vnd: null, transfer_note: null, bill_time: null, amount_box: null })));
    expect((await reader.read(IMG)).kind).toBe('unreadable');
  });

  it('số tiền âm, 0, không nguyên hoặc quá lớn thì invalid', async () => {
    for (const amount of [-5, 0, 1.5, 20_000_000_000, null]) {
      const { reader } = make(() => apiResponse(message({ ...good, amount_vnd: amount })));
      expect((await reader.read(IMG)).kind, String(amount)).toBe('invalid');
    }
  });

  it('số tiền dạng chữ hoặc sai schema thì invalid', async () => {
    const { reader } = make(() => apiResponse(message({ ...good, amount_vnd: '6.000.000' })));
    expect((await reader.read(IMG)).kind).toBe('invalid');
    const { reader: r2 } = make(() => apiResponse({ ...message(good), content: [{ type: 'text', text: 'không phải json' }] }));
    expect((await r2.read(IMG)).kind).toBe('invalid');
  });

  it('vùng khoanh ngoài [0,1] bị bỏ nhưng số tiền vẫn nhận', async () => {
    const { reader } = make(() => apiResponse(message({ ...good, amount_box: { x: 0.5, y: 0.5, w: 0.9, h: 2 } })));
    expect(await reader.read(IMG)).toMatchObject({ kind: 'ok', amountVnd: 6_000_000, bbox: null });
  });

  it('từ chối và hết token', async () => {
    expect((await make(() => apiResponse(message(good, { stop_reason: 'refusal' }))).reader.read(IMG)).kind).toBe('refused');
    expect((await make(() => apiResponse(message(good, { stop_reason: 'max_tokens' }))).reader.read(IMG)).kind).toBe('invalid');
  });

  it('429 và 500 ném lỗi để retry; khóa API không lọt vào thông điệp lỗi', async () => {
    for (const status of [429, 500]) {
      const { reader } = make(() => apiResponse({ type: 'error', error: { type: 'api_error', message: `lỗi ${KEY}` } }, status));
      const err = await reader.read(IMG).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BillProviderError);
      expect((err as BillProviderError).status).toBe(status);
      expect((err as Error).message).not.toContain(KEY);
    }
  });
});

describe('OfflineBillReader và factory', () => {
  const asset = (n: string) => ({ bytes: new Uint8Array(readFileSync(new URL(`../demo-assets/${n}`, import.meta.url))), mediaType: 'image/png' as const });
  it('nhận đúng hai bill mẫu, ảnh khác là unreadable', async () => {
    const r = new OfflineBillReader();
    expect(await r.read(asset('bill-6000000.png'))).toMatchObject({ kind: 'ok', amountVnd: 6_000_000 });
    expect(await r.read(asset('bill-3000000.png'))).toMatchObject({ kind: 'ok', amountVnd: 3_000_000 });
    expect((await r.read(asset('sofa.png'))).kind).toBe('unreadable');
    expect((await r.read(IMG)).kind).toBe('unreadable');
  });

  it('factory: offline mặc định; live thiếu khóa thì ném lỗi', () => {
    const base = { AI_MODE: 'offline' as const, ANTHROPIC_API_KEY: undefined, AI_MODEL: 'm', AI_TIMEOUT_MS: 1000 };
    expect(createBillReader(base)).toBeInstanceOf(OfflineBillReader);
    expect(() => createBillReader({ ...base, AI_MODE: 'live' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(createBillReader({ ...base, AI_MODE: 'live', ANTHROPIC_API_KEY: KEY })).toBeInstanceOf(AnthropicBillReader);
  });

  it('normalizeOutcome cắt nội dung quá dài', () => {
    const o = normalizeOutcome({ amountVnd: 1000, transferNote: 'x'.repeat(500), billTime: '  ' });
    expect(o).toMatchObject({ kind: 'ok', billTime: null });
    if (o.kind === 'ok') expect(o.transferNote!.length).toBe(200);
  });
});
