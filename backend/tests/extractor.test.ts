import { describe, expect, it } from 'vitest';
import { AnthropicExtractor, ExtractorProviderError } from '../src/extraction/anthropic-extractor.js';
import { createExtractor } from '../src/extraction/factory.js';
import { OfflineExtractor } from '../src/extraction/offline-extractor.js';
import type { Candidate, ExtractorInput, ExtractorMessage } from '../src/extraction/types.js';
import { loadEnv } from '../src/config/env.js';
import { locateQuote } from '../src/extraction/verify-evidence.js';

const T = new Date('2026-11-12T02:05:00Z');
let n = 0;
const msg = (text: string, direction: 'inbound' | 'outbound' = 'inbound'): ExtractorMessage => ({
  id: `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`,
  direction,
  text,
  sentAt: T,
});

async function run(...messages: ExtractorMessage[]): Promise<Candidate[]> {
  const r = await new OfflineExtractor().extract({ messages });
  if (r.kind !== 'ok') throw new Error('không ok');
  return r.candidates;
}
const get = (c: Candidate[], f: string) => c.find((x) => x.field === f);

describe('OfflineExtractor (các câu của kịch bản demo)', () => {
  it('cảnh 1: sản phẩm kèm màu, ngân sách "tầm"', async () => {
    const m1 = msg('Chào shop, anh đang tìm sofa phòng khách tầm 15 triệu');
    const m2 = msg('Có mẫu nào màu xám không em?');
    const c = await run(m1, m2);

    const product = get(c, 'product_interest')!;
    expect(product.value).toBe('sofa phòng khách, màu xám');
    expect(product.quotes.map((q) => q.quote)).toEqual(['sofa phòng khách', 'màu xám']);
    expect(product.quotes[0]!.messageId).toBe(m1.id);
    expect(product.quotes[1]!.messageId).toBe(m2.id);

    const budget = get(c, 'budget')!;
    expect(budget.value).toContain('15.000.000');
    expect(budget.value).toContain('tầm');
    expect(budget.quotes[0]!.quote).toBe('tầm 15 triệu');
    expect(budget.quotes[0]!.messageId).toBe(m1.id);
  });

  it('cảnh 3: tên, cụm thời gian nguyên văn, mục đích hẹn xem; không có SĐT (SĐT do code trích)', async () => {
    const m = msg('Anh Minh đây, hôm qua bận quá. SĐT anh 0912 345 678. Cuối tuần này anh ghé shop xem được không?');
    const c = await run(m);
    expect(get(c, 'customer_name')!.value).toBe('Minh');
    expect(get(c, 'customer_name')!.quotes[0]!.quote).toBe('Anh Minh đây');
    const tl = get(c, 'timeline')!;
    expect(tl.value).toBe('Cuối tuần này');
    expect(tl.quotes[0]!.quote).toBe('Cuối tuần này');
    expect(get(c, 'message_purpose')!.value).toBe('schedule_visit');
    expect(c.some((x) => (x.field as string) === 'phone')).toBe(false);
  });

  it('không tạo ngày cụ thể: giá trị timeline chỉ là cụm gốc', async () => {
    for (const text of ['mai anh qua', 'thứ 6 anh ghé', 'tuần sau lấy hàng', 'cuối tuần này nhé']) {
      const c = await run(msg(text));
      const v = get(c, 'timeline')?.value ?? '';
      expect(v).not.toMatch(/\d{4}/); // không có năm
      expect(text.toLowerCase()).toContain(v.toLowerCase());
    }
  });

  it('chỉ đọc tin của khách: tin của Page không thành căn cứ', async () => {
    const c = await run(msg('Sofa Milan xám SF-021 giá 12 triệu ạ, cuối tuần anh ghé nhé', 'outbound'), msg('ok em'));
    expect(c).toEqual([]);
  });

  it('mọi câu gốc offline đều là chuỗi con của tin gốc', async () => {
    const m1 = msg('Chào shop, anh đang tìm sofa phòng khách tầm 15 triệu');
    const m2 = msg('Anh Minh đây, tên mình là Minh. Mai anh ghé lấy 1 bộ nhé, chốt luôn');
    const byId = new Map([m1, m2].map((m) => [m.id, m.text]));
    const c = await run(m1, m2);
    expect(c.length).toBeGreaterThan(3);
    for (const cand of c) for (const q of cand.quotes) expect(locateQuote(byId.get(q.messageId)!, q.quote), `${cand.field}: ${q.quote}`).not.toBeNull();
  });

  it('tín hiệu mua và thanh toán', async () => {
    expect(get(await run(msg('Chị muốn hỏi cách thanh toán')), 'message_purpose')!.value).toBe('ask_payment');
    expect(get(await run(msg('Ok lấy luôn, chốt nhé')), 'message_purpose')!.value).toBe('buy_intent');
    expect(get(await run(msg('Cái này giá bao nhiêu em')), 'message_purpose')!.value).toBe('ask_price');
  });

  it('tin vô nghĩa thì không có gì', async () => {
    expect(await run(msg('ok'), msg('😀'))).toEqual([]);
  });
});

/** Phản hồi Messages API giả. */
function apiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text: JSON.stringify({ fields: [] }) }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 700, output_tokens: 90, cache_creation_input_tokens: 0, cache_read_input_tokens: 650 },
  ...over,
});

const KEY = 'sk-ant-test-KEY-123456';
function makeExtractor(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), headers, body: JSON.parse(String(init?.body ?? '{}')) });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return { ex: new AnthropicExtractor({ apiKey: KEY, model: 'claude-haiku-5-5', timeoutMs: 5000, fetch: fakeFetch }), calls };
}
const input: ExtractorInput = { messages: [msg('Chào shop, anh cần sofa tầm 15 triệu')] };

describe('AnthropicExtractor (fetch giả)', () => {
  it('thành công: ánh xạ message_id, dùng usage, request đúng quy tắc của Haiku 5.5', async () => {
    const out = { fields: [{ field: 'budget', value: 'khoảng 15 triệu', quotes: [{ message_id: input.messages[0]!.id, quote: 'tầm 15 triệu' }] }] };
    const { ex, calls } = makeExtractor(() => apiResponse(message({ content: [{ type: 'text', text: JSON.stringify(out) }] })));
    const r = await ex.extract(input);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.candidates).toEqual([{ field: 'budget', value: 'khoảng 15 triệu', quotes: [{ messageId: input.messages[0]!.id, quote: 'tầm 15 triệu' }] }]);
    expect(r.usage).toEqual({ inputTokens: 700, outputTokens: 90, cacheReadTokens: 650 });

    const body = calls[0]!.body;
    expect(calls[0]!.url).toContain('/v1/messages');
    // SDK 1.6.0 gửi khóa qua `authorization: Bearer` (đã nằm trong danh sách che log).
    expect(calls[0]!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(body.model).toBe('claude-haiku-5-5');
    // Quy tắc API cho Haiku 5.5: không gửi thinking, temperature, top_p, top_k, và không prefill.
    for (const k of ['thinking', 'temperature', 'top_p', 'top_k']) expect(body, k).not.toHaveProperty(k);
    expect((body.messages as Array<{ role: string }>).at(-1)!.role).toBe('user');
    const oc = body.output_config as { effort: string; format: { type: string } };
    expect(oc.effort).toBe('low');
    expect(oc.format.type).toBe('json_schema');
    // Tin của Page phải được gắn nhãn khác tin của khách trong prompt.
    expect(JSON.stringify(body.messages)).toContain('KHÁCH');
  });

  it('bỏ trường có giá trị enum ngoài danh sách', async () => {
    const out = {
      fields: [
        { field: 'message_purpose', value: 'xyz', quotes: [{ message_id: 'a', quote: 'b' }] },
        { field: 'message_purpose', value: 'ask_price', quotes: [{ message_id: 'a', quote: 'b' }] },
      ],
    };
    const { ex } = makeExtractor(() => apiResponse(message({ content: [{ type: 'text', text: JSON.stringify(out) }] })));
    const r = await ex.extract(input);
    expect(r.kind === 'ok' && r.candidates.map((c) => c.value)).toEqual(['ask_price']);
  });

  it('refusal: trả refused, không đọc đầu ra', async () => {
    const { ex } = makeExtractor(() => apiResponse(message({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } })));
    expect((await ex.extract(input)).kind).toBe('refused');
  });

  it('max_tokens: trả max_tokens', async () => {
    const { ex } = makeExtractor(() => apiResponse(message({ content: [{ type: 'text', text: '{"fields":[' }], stop_reason: 'max_tokens' })));
    expect((await ex.extract(input)).kind).toBe('max_tokens');
  });

  it('đầu ra sai schema hoặc không phải JSON: trả invalid', async () => {
    for (const text of ['không phải json', JSON.stringify({ fields: [{ field: 'sai', value: 1 }] }), JSON.stringify({ khac: [] })]) {
      const { ex } = makeExtractor(() => apiResponse(message({ content: [{ type: 'text', text }] })));
      expect((await ex.extract(input)).kind, text).toBe('invalid');
    }
  });

  it.each([429, 500, 503, 401, 400])('HTTP %i: ném ExtractorProviderError kèm mã', async (status) => {
    const { ex } = makeExtractor(() => apiResponse({ type: 'error', error: { type: 'api_error', message: 'lỗi thử' } }, status));
    const err = await ex.extract(input).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ExtractorProviderError);
    expect((err as ExtractorProviderError).status).toBe(status);
  });

  it('lỗi mạng: ném ExtractorProviderError không mã', async () => {
    const { ex } = makeExtractor(() => {
      throw new TypeError('fetch failed');
    });
    const err = await ex.extract(input).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ExtractorProviderError);
    expect((err as ExtractorProviderError).status).toBeNull();
  });

  it('khóa API không lọt vào thông điệp lỗi', async () => {
    const { ex } = makeExtractor(() => apiResponse({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }, 401));
    const err = (await ex.extract(input).then(
      () => null,
      (e: unknown) => e,
    )) as ExtractorProviderError;
    expect(err).toBeInstanceOf(ExtractorProviderError);
    expect(err.message).not.toContain(KEY);
    expect(String(err.stack)).not.toContain(KEY);
  });
});

describe('createExtractor và cấu hình', () => {
  const base = { AI_MODEL: 'claude-haiku-5-5', AI_TIMEOUT_MS: 30000 };
  it('offline không cần khóa', () => {
    expect(createExtractor({ ...base, AI_MODE: 'offline', ANTHROPIC_API_KEY: undefined })).toBeInstanceOf(OfflineExtractor);
  });
  it('live thiếu khóa thì ném lỗi, không âm thầm chuyển sang offline', () => {
    expect(() => createExtractor({ ...base, AI_MODE: 'live', ANTHROPIC_API_KEY: undefined })).toThrow(/ANTHROPIC_API_KEY/);
  });
  it('live có khóa', () => {
    expect(createExtractor({ ...base, AI_MODE: 'live', ANTHROPIC_API_KEY: KEY })).toBeInstanceOf(AnthropicExtractor);
  });

  const env = {
    FB_APP_ID: 'x',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    APP_SECRET: 'x',
    VERIFY_TOKEN: 'x',
    TOKEN_ENC_KEY: Buffer.alloc(32, 1).toString('base64'),
    GRAPH_API_VERSION: 'v26.0',
    DATABASE_URL: 'postgres://u:p@localhost:5433/d',
  };
  it('mặc định AI_MODE=offline dù đã có khóa (không tự gửi dữ liệu ra ngoài)', () => {
    const e = loadEnv({ ...env, ANTHROPIC_API_KEY: KEY });
    expect(e.AI_MODE).toBe('offline');
    expect(e.DEMO_MODE).toBe(false);
    expect(e.AI_DEBOUNCE_SECONDS).toBe(30);
  });
  it('AI_MODE=live thiếu khóa thì cấu hình không hợp lệ', () => {
    expect(() => loadEnv({ ...env, AI_MODE: 'live' })).toThrow(/ANTHROPIC_API_KEY/);
  });
  it('DEMO_MODE=true bị từ chối ở production', () => {
    expect(() => loadEnv({ ...env, DEMO_MODE: 'true', NODE_ENV: 'production' })).toThrow(/DEMO_MODE/);
    expect(loadEnv({ ...env, DEMO_MODE: 'true' }).DEMO_MODE).toBe(true);
  });
});

describe('OfflineExtractor: cảnh 4 (chốt đơn)', () => {
  const SCENE4 = 'Anh xem ảnh thấy ổn rồi, lấy 1 bộ Sofa Milan xám mã SF-021, giá 12 triệu như em báo nhé. Chốt luôn.';

  it('số lượng, đơn giá, mục đích chốt; số tiền sau chữ "giá" KHÔNG phải ngân sách', async () => {
    const m = msg(SCENE4);
    const c = await run(m);
    expect(get(c, 'quantity')!.value).toBe('1 bộ');
    const price = get(c, 'unit_price')!;
    expect(price.value).toContain('12.000.000');
    expect(price.quotes[0]!.quote).toBe('giá 12 triệu');
    expect(get(c, 'budget')).toBeUndefined();
    expect(get(c, 'message_purpose')!.value).toBe('buy_intent');
    expect(get(c, 'message_purpose')!.quotes[0]!.quote.toLowerCase()).toContain('chốt');
  });

  it('ngân sách thật vẫn được nhận khi cùng tin có cả ngân sách và giá', async () => {
    const c = await run(msg('Anh có tầm 15 triệu, mẫu giá 12 triệu em báo ok'));
    expect(get(c, 'budget')!.value).toContain('15.000.000');
    expect(get(c, 'unit_price')!.value).toContain('12.000.000');
  });
});
