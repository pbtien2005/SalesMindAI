# AI trích xuất thông tin bán hàng từ chat Messenger tiếng Việt (as of 2026-11-09)

Provenance note for the report writer: pricing/doc pages were fetched on 2026-11-09 via WebFetch, which summarizes pages with a small model; table figures were read from the Anthropic pricing page text directly (Claude), but OpenAI and Gemini figures are WebFetch summaries and should be spot-checked before being quoted as final. npm version numbers come from registry JSON; npm publish dates were NOT available (only inferred from internal temp timestamps where noted). Anything labelled "Inference" is my reasoning, not a sourced fact.

---

## 1. Which LLMs are best for Vietnamese informal chat (teencode, no diacritics), and price/latency per extraction

### Takeaway
No public benchmark was found that measures LLM *extraction* on unaccented/teencode Vietnamese, so model choice must be made on the team's own labelled eval set. On price/latency grounds, the cheap tier (Claude Haiku 5.5 at $0.10/$0.50 per MTok, GPT-6 Luna at the same price, Gemini 3.1/3.5 Flash-Lite) costs about $0.3-1.2 per 1,000 extractions and Sonnet-class models about $5 per 1,000 (my calculation, assumptions below). Open-weight Vietnamese models are not shown to be competitive on this task by any source I found.

### Cited Findings
**Claude (current lineup, Claude API, USD per MTok)**
- Claude Fable 5.1 `claude-fable-5-1`: $10 in / $50 out; cache write 5m $12.50, 1h $20; cache hit $0.25; "slower" latency tier; designed for demanding reasoning / long-horizon agentic work. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Models overview](https://platform.claude.com/docs/en/models/overview)
- Claude Opus 5.5 `claude-opus-5-5`: $4 in / $20 out; cache write 5m $5, 1h $8; cache hit $0.20; "moderate" latency; default effort `medium`. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Models overview](https://platform.claude.com/docs/en/models/overview)
- Claude Sonnet 5.5 `claude-sonnet-5-5`: $2 in / $10 out; cache write 5m $2.50, 1h $4; cache hit $0.10; "fast"; described as "best combination of speed and intelligence". — same two sources
- Claude Haiku 5.5 `claude-haiku-5-5`: $0.10 in / $0.50 out for prompts up to 100k tokens ($0.50 / $2.50 above 100k); cache write 5m $0.125; cache hit $0.01; "fastest"; described by Anthropic as "for high-volume, latency-sensitive tasks such as classification, extraction, and routing". — same two sources
- Previous gen still available/priced: Opus 5 $5/$25, Sonnet 5 $2/$10, Haiku 4.5 $1/$5, Sonnet 4.6 $3/$15. All current models have 1M context (Haiku 5.5 has the >100k surcharge tier), 128K max output, reliable knowledge cutoff Jun 2026; retirement "not sooner than" Sep 1 2027 (Fable 5.1), Sep 22 2027 (Opus 5.5), Sep 28 2027 (Sonnet 5.5), Oct 7 2027 (Haiku 5.5). — [Models overview](https://platform.claude.com/docs/en/models/overview)
- All current Claude models are described as multilingual, but Anthropic's page gives no Vietnamese-specific scores. — [Models overview](https://platform.claude.com/docs/en/models/overview)
- Thinking: Sonnet 5.5 reports `thinking.types.disabled.supported = false` (adaptive thinking only; can use `between_tools`); Fable 5.1 and Opus 5.5 are "adaptive (always on)". Thinking tokens are output tokens, so they raise cost/latency for extraction; effort param controls it. — [Models overview](https://platform.claude.com/docs/en/models/overview)
- Mythos 5.1 / Mythos 5 are "limited availability" ($10/$50) — not usable for general production. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)

**OpenAI (text models, short context ≤272K, per MTok; WebFetch summary of [OpenAI pricing](https://developers.openai.com/api/docs/pricing))**
- gpt-6-luna $0.10 in / $0.01 cached / $0.50 out (batch $0.05/$0.25); gpt-6.1-terra $1.00 / $0.05 / $5.00; gpt-6.1-sol $2.00 / $0.10 / $10.00; gpt-6-astra $10 / $1.00 / $50; gpt-5.6-luna $0.20/$1.20; gpt-5.4-nano $0.20/$1.25; gpt-5-nano $0.05/$0.40. Batch tier is ~50% below standard. OpenAI's structured-outputs guide recommends `gpt-6-astra` for new projects. — [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

**Google Gemini (paid tier, per MTok; WebFetch summary of [Gemini pricing](https://aistudio.google.com/docs/pricing))**
- `gemini-3.1-flash-lite`: $0.25 in (text) / $1.50 out, cache $0.025; `gemini-3.5-flash-lite`: $0.30 / $2.50, cache $0.03; `gemini-2.5-flash-lite`: $0.10 / $0.40 (to be superseded; 2.5-flash and 2.5-pro route to newer models on 1 Dec 2026); `gemini-3.6-flash` / `gemini-3.8-flash`: $0.75 / $3.75; `gemini-4-argon`: $2.00 / $10.00; `gemini-3.1-pro-preview` ($2/$12 ≤200k) and `gemini-3-flash-preview` are still "preview". Batch is 50% of standard. — [Gemini pricing](https://aistudio.google.com/docs/pricing)
- Price changes flagged on the page: `gemini-4-argon` prices double on 1 Dec 2026 and 3.6/3.8 Flash double on 1 Jan 2027 (31 Dec 2026 for 3.8 Flash standard tier). Budget for the post-increase prices. — [Gemini pricing](https://aistudio.google.com/docs/pricing) (single-source, via summarizer; re-verify)

**Open-weight / Vietnamese-specific**
- A vendor-written (SiliconFlow, sales-oriented) guide names Qwen3-235B-A22B, Llama-3.1-8B-Instruct and Qwen3-8B as top Vietnamese picks for 2026 but gives no benchmark scores. — [SiliconFlow](https://www.siliconflow.com/articles/best-open-source-llm-for-vietnamese)
- A May 2026 overview lists Qwen3, SEA-LION 3, SeaLLM and VinaLLaMA as options for Southeast Asian languages and says SeaLLM is an earlier precursor to SEA-LION. — [Presenc AI](https://presenc.ai/research/open-weight-multilingual-llms-2026)
- Viettel AI reports (July 2026) a 120B "VAI-LLM" built on NVIDIA Nemotron 3 Super architecture with "strong" Vietnamese results, no numbers given; self-reported. — [Viettel AI](https://viettelai.vn/en/tin-tuc/viettel-ai-ghi-nhan-ket-qua-buoc-dau-trong-hop-tac-cung-nvidia)
- A Vietnamese GearVN article mentions Qwen3.5, Qwen3.6 and Gemma 4 as recent open-weight families (no Vietnamese scores). — [GearVN](https://gearvn.com/blogs/cong-nghe/best-local-llm)
- Evidence on informal Vietnamese: ViSoBERT documents that models pre-trained on general corpora struggle with emoji, teencode and missing diacritics (encoder model, 2023, not an LLM study). — [ViSoBERT arXiv](https://arxiv.org/html/2310.11166v1). CSConDa (2025) is a Vietnamese customer-support LLM benchmark noting queries often contain teencode/abbreviations, but evaluates QA not extraction. — [arXiv 2507.22542](https://arxiv.org/html/2507.22542v1)
- VMLU (Zalo AI / JAIST, ACL 2025 toolkit paper) is the main Vietnamese LLM benchmark; its repo warns to treat leaderboard scores with caution; it measures knowledge/reasoning, not chat extraction. — [ACL 2025.acl-long.563](https://aclanthology.org/2025.acl-long.563), [VMLU GitHub](https://github.com/ZaloAI-Jaist/VMLU/)

### Inferences
- Cost per extraction (my arithmetic; assumptions: 1,500-token cached prefix = system prompt + schema + few-shot, 500 fresh input tokens (new message + a few preceding messages), 400 output tokens, no thinking overhead; Vietnamese tokenizes less efficiently than English so real token counts may be 1.3-2x higher; cache write cost on first call ignored):
  - Haiku 5.5 ≈ $0.27 per 1,000 extractions; GPT-6 Luna ≈ $0.27; Gemini 3.1 Flash-Lite ≈ $0.76; Gemini 3.5 Flash-Lite ≈ $1.20; GPT-6.1 Terra ≈ $2.6; Sonnet 5.5 ≈ $5.2; GPT-6.1 Sol ≈ $5.2; Opus 5.5 ≈ $10.3; Fable 5.1 ≈ $25.4.
  - For a 30-person team handling e.g. 3,000 customer messages/day, Haiku-class ≈ $0.8/day, Sonnet-class ≈ $15/day on these assumptions: LLM cost is not the bottleneck; accuracy and privacy are.
- Latency: Anthropic only gives relative tiers (Haiku 5.5 "fastest", Sonnet 5.5 "fast"); no absolute p50/p95 numbers found. Because extraction runs in a pg-boss worker (not in the webhook), latency matters little; measure it in your own eval.
- Practical recommendation: evaluate Haiku 5.5 (primary candidate), Sonnet 5.5 (fallback/escalation), and one non-Anthropic cheap model (Gemini Flash-Lite or GPT-6 Luna) on the same Vietnamese eval set before locking in; keep the provider behind an interface. Open-weight self-hosting is not justified by any evidence found (ops cost, no proven Vietnamese extraction quality).

### Gaps
- No public numbers for Vietnamese extraction accuracy on Claude 5.x / GPT-6 / Gemini 3.x/4 families; no benchmark for unaccented/teencode Vietnamese extraction. Must be measured in-house.
- No official absolute latency figures (tokens/s, TTFT) for the 5.5 family.
- No Hugging Face model cards were fetched for Qwen/Gemma/SeaLLM/Vistral successors; the status of Vistral/PhoGPT successors in 2026 is unverified.
- GPT-6 / Gemini 3.x/4 data come through a summarizer; model naming should be confirmed on the provider pages.

---

## 2. Guaranteeing structured output: provider features and TypeScript libraries

### Takeaway
All three providers now offer schema-constrained decoding; Anthropic's is stable (GA) with `output_config.format` and a Zod helper in the official TS SDK, which is the lowest-dependency fit for Fastify. Critical constraint: Anthropic Citations and structured outputs cannot be combined (400 error), so grounding must be done by schema fields + post-hoc verification (see section 3).

### Cited Findings
**Anthropic**
- Structured outputs are stable on Claude API, Claude Platform on AWS, Google Cloud, Bedrock and Foundry; use `output_config.format` (the `output_format` param is deprecated; no beta header). Supported: Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5 and older 4.x/5 models. Output is constrained by the schema via constrained decoding; no retries needed for schema violations. — [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- Exceptions to the guarantee: `stop_reason: "refusal"` (200, billed, schema not followed), `stop_reason: "max_tokens"` (truncated), and enum casing may vary (compare enums case-insensitively). — same source
- Schema limits: supported types object/array/string/integer/number/boolean/null, `enum`, `const`, `anyOf`, internal `$ref`, `additionalProperties:false` required, string formats (date, date-time, email, etc.), array `minItems` 0 or 1 only. NOT supported: recursive schemas, `minimum/maximum`, `minLength/maxLength`, other array constraints, regex lookaround/backreferences/`\b`; unsupported features return 400. — same source
- Strict tool use (`strict: true`) gives the same grammar-based validation for tool inputs and can be combined with JSON outputs. — same source
- TS SDK: `zodOutputFormat()` from `@anthropic-ai/sdk/helpers/zod` + `client.messages.parse()` returns typed `parsed_output`; unsupported constraints (e.g. `minimum`) are moved into field descriptions and the response is re-validated against the original Zod schema client-side. `jsonSchemaOutputFormat()` is available for plain JSON Schema (no client validation). — same source
- `@anthropic-ai/sdk` npm: latest dist-tag 1.6.0 (alpha 0.34.0-alpha.0) per registry dist-tags endpoint (publish date not retrieved). — [npm dist-tags](https://registry.npmjs.org/-/package/@anthropic-ai/sdk/dist-tags)
- **Citations and structured outputs are incompatible**: enabling citations on any document/search_result block together with `output_config.format` returns 400. — [Citations](https://platform.claude.com/docs/en/build-with-claude/citations)

**OpenAI**
- Structured Outputs: `text.format` with `type:"json_schema"`, `strict:true`, or function calling; refusals appear in a `refusal` field; incomplete responses possible at max tokens; the first request with a new schema has extra latency; Zod helper `zodTextFormat` for JS. Specific schema limits (minLength/pattern) not confirmed from the fetched text. — [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

**Google Gemini**
- Page for structured output moved to https://aistudio.google.com/docs/structured-output; content not retrieved (see Gaps).

**TypeScript libraries (npm registry, 2026-11-09)**
- Vercel AI SDK (`ai`): latest version 7.0.166 (publish date not retrievable). Docs now describe structured output through the `output` property on `generateText`/`streamText` (`Output.object()`, `Output.array()`, `Output.choice()`, `Output.json()`), usable together with tool calling; schemas via Zod, Valibot or JSON Schema; docs example uses model string `anthropic/claude-sonnet-5.5`. The page does not mention `generateObject`. — [npm ai](https://registry.npmjs.org/ai/latest), [AI SDK docs](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- BAML (`@boundaryml/baml`): 0.226.3, registry temp timestamp ≈ 2026-10-28 (inferred, not a documented date) → actively released. — [npm BAML](https://registry.npmjs.org/@boundaryml/baml/latest)
- instructor-js (`@instructor-ai/instructor`): 1.7.0, internal timestamp ≈ 2025-01-27 (inferred) → no release for ~21 months; appears stale relative to others. — [npm instructor](https://registry.npmjs.org/@instructor-ai/instructor/latest)

### Inferences
- For a Fastify/TS backend that is mainly Claude-first: use `@anthropic-ai/sdk` + `zodOutputFormat` directly (fewest layers, first-party support for newest features like `output_config`, caching, batches). Wrap it in a small internal `Extractor` interface; if multi-provider A/B is wanted, Vercel AI SDK 7 is the most maintained provider-agnostic option. instructor-js looks stale; BAML is active but adds a DSL/codegen toolchain that is unnecessary here.
- Because strict decoding does not support `minLength`/`pattern`, phone/date format validation belongs in post-processing (Zod `.refine` / deterministic code), not in the JSON schema.
- Handle the three documented exceptions explicitly (refusal, max_tokens, enum casing) so no message is silently dropped (CLAUDE.md rule: no silent drops; retry then dead-letter).

### Gaps
- Gemini structured output limits/guarantees not retrieved (page redirect not followed).
- OpenAI schema limitation list not retrieved (truncated).
- npm publish dates and GitHub last-commit dates not verified; "maintained" judgments rely on version numbers and inferred timestamps.
- Whether strict tool use + Citations can coexist was not verified.

---

## 3. Grounding / citations: forcing verbatim evidence and rejecting hallucinated quotes

### Takeaway
Anthropic's Citations API returns exact source passages with location indices, but it cannot be combined with structured outputs. The robust design is therefore: schema-constrained output where every field carries `{message_id, quote}`, then deterministic verification that the quote is a substring of the stored message text (after normalization), rejecting or downgrading anything that fails.

### Cited Findings
- Citations: stable, ZDR-eligible (excluding Covered Models), supported by all active models including Haiku 5.5, Sonnet 5.5, Opus 5.5. Citations returned as `char_location` (plain text documents) with `cited_text`; `cited_text` does not count toward output tokens or input tokens on later turns, so it is cheaper than asking the model to emit quotes. — [Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- Citations are produced by interleaving citation blocks with text output, which is why they conflict with strict JSON schema constraints (400 on combination). — [Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- Enabling/disabling citations invalidates the prompt cache at system and messages level. — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

### Inferences
- Recommended pattern (quote-then-extract + verify):
  1. Send the conversation window as numbered messages with stable IDs (e.g. `[m_123] ...` using the DB message id/mid).
  2. Schema per field: `{ value, evidence: [{ message_id, quote }], confidence? }` with `message_id` as an enum (or validated afterwards) and quote ordered BEFORE value in the schema (property order follows schema, required first per docs) so the model copies the quote before deriving the value.
  3. Verify in code: lookup message by `message_id` (must belong to this conversation), Unicode NFC-normalize both, collapse whitespace, compare case-insensitively; accept only if `quote` is a substring; if not, try a bounded fuzzy match (e.g. edit distance ≤ 10% of length) and snap to the real substring, storing char start/end offsets; otherwise drop the field (or mark "unverified/needs review") and log it as a metric. Never store the model's quote text, store the verified substring + offsets.
  4. Reject quotes that are longer than the message, span multiple messages, or are generic (<3 tokens); require that deterministic fields (phone, numbers, dates) also literally appear in the quote.
  5. Unaccented text caveat: models sometimes "restore" diacritics in quotes; normalize by stripping diacritics for matching (but store the original substring).
- Alternative: Citations API with each message as a custom-content/plain-text document and extraction as free text; rejected as primary because it forfeits strict JSON, and whether it can feed a strict tool-use path is unverified.
- Because the product principle is "AI proposes, human decides", verified quotes can be shown next to each field in the Duyệt / Sửa / Bỏ qua UI; a failed verification should simply hide the field from the proposal.

### Gaps
- Did not verify the Citations API's "custom content" document type behaviour in 2026 docs (only `char_location` confirmed in fetched text).
- No published measurement found of hallucinated-quote rates for Claude 5.x in structured-output mode; measure on the eval set.

---

## 4. Deterministic pre/post-processing for Vietnamese (phone, address, dates)

### Takeaway
Use deterministic code for phone numbers (regex + libphonenumber-js, plus a legacy 11-to-10-digit prefix map), for addresses use an up-to-date 34-province/3,321-ward dataset (which is still changing in 2026), and use rule-based detection of time expressions that tags vague ones as "needs clarification" without ever resolving them.

### Cited Findings
**Phone**
- Vietnam converted 11-digit mobile numbers to 10 digits with the change running from 15 Sep 2018 to 30 Jun 2019 (nearly 60 million subscribers). Mappings reported: VinaPhone/MobiFone 012x, Viettel 016x, Vietnamobile 018x, Gmobile 019x. Viettel 0162-0169 became 032-039; Vietnamobile 0186→056, 0188→058. One VietnamNet report gives a different Viettel prefix ("07"), so sources conflict on some details. Callers were auto-redirected until 14 Nov 2018. — [MIC](https://english.mic.gov.vn/11-digit-phone-numbers-to-be-cut-197136277.htm), [QDND/Viettel](https://en.qdnd.vn/economy/military-businesses/viettel-completes-changing-11-digit-mobile-numbers-into-10-digit-ones-497723), [VietnamNet](https://vietnamnet.vn/en/11-digit-phone-numbers-to-be-switched-to-10-digits-E201479.html)
- A lawnet.vn page states current Vietnamese mobile numbers are 10 digits (format effective 2018). — [LawNet](https://lawnet.vn/en/laws/what-is-the-current-list-of-prefixes-of-vietnamese-phone-numbers-of-mobile-network-operators-what-i-134777.html)
- `libphonenumber-js` latest dist-tag: 1.13.15 (registry; publish date not retrieved). — [npm](https://registry.npmjs.org/libphonenumber-js)

**Administrative units**
- Resolution passed 12 Jun 2025: provincial units reduced 63 → 34 (6 centrally-governed cities + 28 provinces; 23 newly formed by merger). Commune-level units reduced from 10,035 to 3,321 (2,621 communes, 687 wards, 13 special zones). District level abolished; two-tier local government in effect from 1 Jul 2025. Legal instruments: Resolution 60-NQ/TW, Decision 759/QĐ-TTg; Decree 321/2025/ND-CP (effective 16 Dec 2025) governs future unit changes. — [VietnamNet](https://vietnamnet.vn/en/vietnam-to-consolidate-into-34-provinces-and-3-321-communes-by-2025-2399871.html), [VnEconomy](https://en.vneconomy.vn/resolutions-and-decisions-on-merger-of-local-administrative-units-nationwide-announced.htm), [Tuoi Tre](https://tuoitre.vn/nld/vietnam-now-has-34-provincial-level-administrative-units-196250612205651997.htm)
- Dataset `thanglequoc/vietnamese-provinces-database` (GitHub) tracks the changes: v3.0.2 (Jul 2025) consolidated to 34 provinces per Decision 19/2025/QĐ-TTg and dropped the districts table; v4.x added GIS GeoJSON (34 provinces + 3,321 wards); v5.0.0 (31 Aug 2026) added postal codes; later 2026 releases show the map is STILL changing: v3.1.0 (23 May 2026) Đồng Nai becomes Đồng Nai City (Resolution 30/2026/QH16) and 10 wards; v5.1.0 (13 Sep 2026) Quảng Ninh province becomes Quảng Ninh City (Res. 36/2026/QH16, effective 1 Sep 2026); v5.2.0 (21 Sep 2026) Bắc Ninh becomes Bắc Ninh City (Res. 39/2026/QH16, effective 20 Sep 2026) and 12 communes become wards. License not stated on the page. Note: the page lists some version numbers out of date order (e.g. v3.1.0 dated May 2026 vs v4.x 2025); treat release dates as approximate. — [GitHub releases](https://github.com/thanglequoc/vietnamese-provinces-database/releases)
- Other datasets found: `dvhcvn/data` (from the General Statistics Office catalogue, includes historical tree; whether it reflects 34-unit structure unconfirmed) and official Cục Thống kê notice Công văn 1027/CTK-CSCL-2025 listing new commune-level codes/names. — [dvhcvn/data](https://github.com/dvhcvn/data), [thuvienphapluat](https://thuvienphapluat.vn/cong-van/Bo-may-hanh-chinh/Cong-van-1027-CTK-CSCL-2025-thong-bao-ma-so-va-ten-don-vi-hanh-chinh-cap-xa-moi-665444.aspx)

### Inferences
- Phone: extract with a tolerant regex (allow spaces, dots, dashes, `+84`/`84`/`0`, and digits written in text like "không chín ba...") then normalize via libphonenumber-js `parsePhoneNumberFromString(x, 'VN')`, store E.164 and require the digit string to appear in the evidence quote. Optionally map legacy 11-digit 01xx numbers via the prefix table above only to FLAG them as legacy (customers may quote old numbers); do not auto-rewrite without human confirmation. Whether libphonenumber-js metadata recognizes every 2018+ prefix was not verified; add a unit-test table.
- Address: customers write addresses in old (ward/district/province) AND new (ward/province) forms, often unaccented ("q7", "tphcm", "thu duc"). Keep the LLM output as raw text plus the verified quote, and run a separate normalizer: strip diacritics, expand abbreviations, match against a versioned administrative dataset that includes old-to-new mapping; store dataset version with each result because units keep changing in 2026 (province→city promotions). Treat district tokens as legacy hints; they no longer exist as an administrative level.
- Dates: implement a deterministic detector for Vietnamese time expressions (absolute: "ngày 15/12", "thứ 6", "sáng mai 9h" vs vague: "tuần sau", "mai tính", "cuối tháng", "đầu năm", "sớm", "tính sau"). Output `{text, span, kind: 'absolute'|'relative'|'vague', needs_clarification: boolean}`; never emit a resolved calendar date for `relative`/`vague` (product principle). Even "mai"/"thứ 6" resolution requires message timestamp and timezone Asia/Ho_Chi_Minh — policy decision for the product owner; safest is to store the phrase + the message's own timestamp and let the human confirm.

### Gaps
- No sources fetched on which VN prefixes libphonenumber-js metadata covers, or on new prefixes added since 2018 (one search result mentions carriers rolling out new prefixes, e.g. 2025, not opened). — [Bao Bac Ninh TV](https://en.baobacninhtv.vn/vietnamese-mobile-carriers-roll-out-new-prefixes.bbg)
- No official government open-data API for the new units was confirmed; dataset license for thanglequoc not checked; completeness of old→new ward mapping not confirmed.
- No Vietnamese date-expression NLP library for TS was researched (e.g. rule-based approach is my suggestion).

---

## 5. Cost optimization: caching, batching, incremental vs whole-conversation, routing

### Takeaway
Prompt caching is cheap and easy (512-token minimum, 90-95% discount on reads); the Batch API gives 50% off but is NOT ZDR-eligible and is asynchronous (use for backfill, not live). Extract incrementally per new message with a short context window, route cheap classification to Haiku 5.5, escalate low-confidence cases.

### Cited Findings
- Prompt caching: minimum cacheable prefix 512 tokens for Haiku 5.5, Sonnet 5.5, Opus 5.5; default TTL 5 minutes (refreshed free on each hit), optional 1-hour TTL at extra write cost; automatic caching via top-level `cache_control`; hierarchy tools → system → messages; changing tool definitions, thinking/effort settings or toggling citations invalidates parts of the cache; match must be exact. — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Cache read prices: Haiku 5.5 $0.01/MTok (10% of input), Sonnet 5.5 $0.10 and Opus 5.5 $0.20 (5% of input), Fable 5.1 $0.25 (2.5%). Cache writes cost 1.25x (5m) or 2x (1h) input. — [Models overview](https://platform.claude.com/docs/en/models/overview), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Batch API: 50% discount on input and output; batch prices e.g. Haiku 5.5 $0.05/$0.25, Sonnet 5.5 $1/$5, Opus 5.5 $2/$10, Fable 5.1 $5/$25; prompt caching and batch discounts can be combined; fast mode not available with Batch. — [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Batch processing is NOT ZDR-eligible (29-day retention, async storage required). — [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- Data residency: `inference_geo: "us"` carries a 1.1x multiplier on all token prices for Claude 4.6+ models; "global" is default; regional/multi-region endpoints on cloud platforms carry a 10% premium. — [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Haiku 5.5 input price rises 5x for prompts over 100k tokens (>100k: $0.50/$2.50) — irrelevant for short chat windows but matters for whole-conversation prompts. — [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- OpenAI cached input is 10% of input for GPT-6 family (e.g. Luna $0.01 vs $0.10); Gemini caching $0.025-0.03 for Flash-Lite plus storage fees (3.6/3.8 Flash storage $0.50/MTok-hour through 31 Dec 2026, then $1.00). — [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Gemini pricing](https://aistudio.google.com/docs/pricing)

### Inferences
- Design: (1) trigger extraction in a pg-boss job per conversation with debounce (e.g. 20-60 s after the last message, so bursts of 5 short messages are one call); (2) input = stable cached prefix (instructions, schema, few-shot Vietnamese examples ≥512 tokens) + last N messages + the current known state (previously accepted fields) so the model only emits deltas; (3) Stage 1 Haiku 5.5 classifies purpose (buying inquiry / existing order / complaint / spam) and filters spam/chit-chat so no extraction call is made for "ok", "dạ", stickers; (4) Stage 2 extraction by Haiku 5.5 or Sonnet 5.5 depending on eval result; (5) escalate to Sonnet/Opus only when verification fails or confidence is low.
- With 5-minute TTL and a busy page, the cached prefix will stay warm; the cache saves ~90% on the large static part but is a small absolute saving at these volumes. Use Batch only for backfill of historical conversations (Module 5 backfill), and only if the customer contract allows non-ZDR retention.
- Idempotency: key jobs by (conversation_id, last_message_id, prompt_version) so retries do not duplicate proposals; store token usage per call (including `cache_read_input_tokens`) for cost observability.

### Gaps
- No measured latency numbers for caching/batching on 5.5 models; Batch SLA (up to 24h) was not re-verified in this session.
- Prompt caching page was truncated (last ~64k characters unread); details beyond those listed are unverified.

---

## 6. Evaluation: eval set, field-level precision/recall, tools, observability

### Takeaway
No Vietnamese sales-chat extraction benchmark exists publicly, so SalesMind must build its own labelled set; score per-field precision/recall/F1 plus evidence-verification rate, and run it in CI with promptfoo (CLI/library, GitHub Action) and trace production with Langfuse (still MIT, now part of ClickHouse).

### Cited Findings
- promptfoo: open-source CLI/library for evaluating and red-teaming LLM apps, supports many providers, caching, concurrency, CI/CD via GitHub Action; site footer "© 2026 Promptfoo, Inc.", page last updated 9 Nov 2026; no ownership change noted on the page. Specific assertion types (is-json, javascript, llm-rubric) were NOT confirmed from the fetched content. — [promptfoo docs](https://www.promptfoo.dev/docs/intro/)
- Langfuse (open-source LLM observability, evals, prompt management) was acquired by ClickHouse, announced 16 Jan 2026 alongside a $400M Series D; ClickHouse states core stays MIT-licensed and self-hostable, Langfuse Cloud continues standalone; company-reported >20,000 GitHub stars and >26M SDK installs/month at end of 2025. — [Langfuse blog](https://langfuse.com/blog/joining-clickhouse), [Orrick](https://www.orrick.com/en/news/2026/01/open-source-llm-observability-langfuse-acquired-by-clickhouse-inc), [Pulse 2.0](https://pulse2.com/clickhouse-400-million-series-d/amp/). (One result, Signalbase, contradicts the others and appears wrong; disregarded.)
- Vietnamese datasets that stress informal text: UIT-VSMEC (Facebook comments with teencode/unaccented text) used in a 2026 practitioner Viblo test of LLM sentiment classification; MultiLexNorm++ (2026) lexical normalization benchmark for Asian languages (Vietnamese inclusion unverified). These are task-adjacent, not extraction benchmarks. — [Viblo](https://viblo.asia/p/ai-tuong-tieng-long-la-chui-nhau-thu-nghiem-phan-loai-cam-xuc-tieng-viet-wd43EljjLX9), [arXiv 2601.16623](https://arxiv.org/html/2601.16623v1)

### Inferences
- Eval set recipe: sample 300-500 real (anonymized, with consent/contractual basis) conversations across ≥5 tenants/industries; stratify by: normal accented, fully unaccented, teencode/abbreviations ("sdt", "ko", "dc", "bn", "k", "5tr", "2 chục"), voice-note/image-only messages, multi-intent, spam, vague vs precise dates. Two annotators per item; label per field `{value, evidence message_id + span}`; include negative examples (field absent) because over-extraction is the main risk.
- Metrics per field: precision (of fields proposed, correct and evidence-supported), recall, F1; exact-match for phone/quantity, normalized match for budget ("5tr", "5 triệu", "tầm 5-7 triệu" as range), address-level match (province/ward), intent confusion matrix; plus (a) evidence-verification pass rate, (b) "vague date wrongly resolved" rate (target 0), (c) human-edit rate in production (Sửa/Bỏ qua ratio) as the live quality signal.
- Tooling split: promptfoo (or plain Vitest, already used by the project) for offline regression across models/prompts in CI; Langfuse (self-hostable) for production traces, prompt versions, token/cost, and annotation queues. Braintrust was not researched; do not cite it.
- Synthetic augmentation: programmatically strip diacritics / apply teencode substitutions to accented gold data to get paired robustness tests (my suggestion; no source).

### Gaps
- Braintrust and other eval vendors not researched; promptfoo assertion list not confirmed; Langfuse eval-dataset feature specifics not verified.
- No benchmark datasets for Vietnamese sales extraction exist in the sources found.

---

## 7. Privacy: retention, ZDR, data residency, Vietnam PDP Law and cross-border transfer

### Takeaway
Vietnam's Law on Personal Data Protection No. 91/2025/QH15 (passed 26 Jun 2025) took effect 1 Jan 2026 with guiding Decree 356/2025/ND-CP, and sending customer chats to a foreign LLM API plausibly counts as a cross-border transfer requiring an impact-assessment dossier filed with the Ministry of Public Security within 60 days. On the Anthropic side, no conversation content is retained by default for non-Covered models, ZDR is available via sales, but Batch API is not ZDR-eligible, Fable 5.1 requires 30-day retention, and first-party data residency offers only `global` or `us` (no Vietnam/APAC option confirmed).

### Cited Findings
**Vietnam law**
- Law on Personal Data Protection No. 91/2025/QH15 was enacted 26 Jun 2025 and took effect 1 Jan 2026; Decree 356/2025/ND-CP (issued 31 Dec 2025, effective 1 Jan 2026) replaced Decree 13/2023/ND-CP. — [Luật Việt Nam English](https://english.luatvietnam.vn/dan-su/law-on-personal-data-protection-law-no-91-2025-qh15-405135-d1.html), [EY Legal Alert Mar 2026](https://www.ey.com/en_vn/technical/tax/tax-and-law-updates/legal-alert-march-2026-decree-no-356-2025-nd-cp-providing-detailed-guidance-for-implementation-of-personal-data-protection-law), [Tilleke & Gibbins](https://tilleke.com/insights/vietnams-new-personal-data-protection-law-a-closer-look)
- Cross-border transfer covers (i) data stored in Vietnam moved to storage abroad, (ii) transfer from Vietnam-based entities to offshore entities, (iii) processing of Vietnam-collected data on platforms located abroad. A Cross-border Transfer Impact Assessment must be prepared and filed with the Ministry of Public Security, reported as within 60 days of the transfer starting. Sources differ on whether this is a notification/filing only or can restrict transfers (one says it is "not an approval procedure" but may restrict if national-security risks are shown). Exemptions include emergencies, cross-border personnel management under labour rules, certain contract/transport/payment cases. — [Clym summary](https://www.clym.io/regulations/personal-data-protection-law-pdpl-vietnam), [Tilleke & Gibbins](https://tilleke.com/insights/vietnams-new-personal-data-protection-law-a-closer-look), [Vietnam Briefing on Decree 356](https://www.vietnam-briefing.com/news/vietnam-personal-data-protection-regulation-decree-356.html)
- Penalties: up to 5% of preceding-year revenue for cross-border transfer violations; general violations capped at VND 3 billion; illegal personal data trading up to 10x illicit revenue — reported in secondary sources; verify against the decree. — [Clym summary](https://www.clym.io/regulations/personal-data-protection-law-pdpl-vietnam)
- Commentary: if a company grants a foreign entity access to files and processing of personal data, a TIA is required (quoted official view, not the decree text). — search summary of [Rajah & Tann](https://www.rajahtannasia.com/viewpoints/new-decree-implementing-the-law-on-personal-data-protection-passed/) / other law-firm alerts
- Additional law-firm sources for follow-up: [PwC Vietnam Jan 2026 PDF](https://www.pwc.com/vn/en/publications/2026/20260128-new-rules-personal-data-protection.pdf), [FPF Issue Brief Jan 2026](https://fpf.org/wp-content/uploads/2026/01/January-2026-FPF-Issue-Brief-Making-Sense-of-Vietnams-Latest-Data-Protection-and-Governance-Regime-1.pdf), [DLA Piper](https://www.dlapiperdataprotection.com/?c=VN&t=law) (listed in search results, not opened).

**Anthropic retention / residency**
- Conversation content (prompts and outputs) is not retained by default except for "Covered Models", which require 30-day retention. Claude Fable 5.1, Mythos 5.1, Fable 5 and Mythos 5 are Covered Models; ZDR is not available for them unless expressly authorized; Opus 5.5, Sonnet 5.5, Haiku 5.5 are not listed as Covered. — [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- ZDR is requested through Anthropic sales. Eligibility per feature: Citations Yes, Data residency Yes, Effort Yes; Batch processing No (29-day retention). The page's related-resources list links structured outputs and prompt caching (their eligibility rows were not individually read). — [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- `inference_geo` supports `"global"` (default) and `"us"` (1.1x price); a search found the English docs say "us" is the only available workspace geo; Anthropic's marketing page claims regional residency for APAC (Japan, Korea, Singapore, India, Australia) — inconsistent with API docs; Bedrock offers in-region inference in Singapore (ap-southeast-1) and Seoul for Sonnet 5 / Opus 5. — [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Anthropic regional compliance](https://claude.com/regional-compliance), [AWS blog](https://aws.amazon.com/blogs/machine-learning/introducing-anthropic-models-on-amazon-bedrock-for-in-region-inference-in-seoul-and-singapore/)
- On Bedrock and Google-managed Claude, the cloud provider (not Anthropic) is the data processor. — [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)

### Inferences
- Even with Singapore in-region inference, data still leaves Vietnam, so the cross-border TIA likely still applies; residency only helps with jurisdiction/latency story. Legal counsel must confirm whether a SaaS vendor (SalesMind) is a "data processor" and whether the tenant (client business) is the controller who files the TIA; the SaaS contract needs a DPA naming the LLM sub-processor.
- Minimize data sent: strip names/phones before the LLM when not needed (e.g. send masked placeholders and re-insert from deterministic regex) — but name/phone are target fields, so alternative is to extract them with regex deterministically and send the LLM only masked text for intent/product/budget. This reduces exposure while keeping evidence verification (verify masked quote against masked stored text, offsets map back).
- Choose Opus 5.5 / Sonnet 5.5 / Haiku 5.5 rather than Fable 5.1 if ZDR is required; avoid Message Batches for live tenant data under ZDR; log only message IDs/token counts, never message content at info level (already a project rule).
- Consent text on the Facebook Page/chat flow and a privacy notice should mention AI processing and overseas transfer — a legal point to confirm with counsel.

### Gaps
- Did not read the primary text of Law 91/2025/QH15 or Decree 356/2025/ND-CP on thuvienphapluat.vn/chinhphu.vn; the details above come from law-firm and news summaries, with some disagreement on the approval question and fines. Whether Vietnam's cybersecurity/data-localization rules (Decree 53/2022) add obligations was not researched.
- Whether Anthropic/OpenAI/Google act as "processors" under the Vietnamese regime and whether a standard DPA satisfies it was not found.
- OpenAI and Google retention/ZDR terms were not researched in this pass; no Vietnamese data-residency option for them was checked.
- Sensitive-data categories under Decree 356 (e.g. whether purchase intent/financial data counts) not retrieved.
