# Kế hoạch Module 2: AI trích xuất thông tin từ tin nhắn

Ngày 2026-11-09. Trạng thái từng mốc nằm ở [PROGRESS.md](../PROGRESS.md). Căn cứ công nghệ: [reports/Công nghệ luồng nghiệp vụ SalesMind.md](../reports/Công%20nghệ%20luồng%20nghiệp%20vụ%20SalesMind.md) (mảng 1).

## Mục tiêu

AI đọc hội thoại đã lưu ở Module 1, trích thông tin bán hàng (tên, SĐT, địa chỉ, sản phẩm quan tâm, số lượng, ngân sách, mốc thời gian, ý định, mục đích tin) và tạo **đề xuất** để Sale Duyệt / Sửa / Bỏ qua. Ba nguyên tắc áp dụng thẳng:
- AI chỉ đề xuất; Sale quyết định.
- Mọi thông tin kèm câu gốc đã được kiểm chứng bằng code.
- Mốc thời gian mơ hồ thì hỏi lại, không tự suy ra ngày.

**Ngoài phạm vi:** bám và chăm sóc lại, đơn hàng, cọc, giao diện React, HTTP API và đăng nhập, gộp khách giữa nhiều Page theo SĐT, trích mức ưu tiên (SLA chưa được định nghĩa).

**Quyết định đã chốt:**
- Duyệt đề xuất qua service nội bộ và CLI. HTTP API làm cùng module giao diện sau, khi có đăng nhập.
- AI bật theo từng tenant, **mặc định tắt**. Kiểm tra pháp lý (Luật 91/2025/QH15, chuyển dữ liệu ra nước ngoài) là điều kiện trước khi bật cho khách thật.
- Việc lưu tin Page gửi (`message_echoes`) do việc sửa Module 1 ở phiên khác phụ trách.

**Quyết định của người lập kế hoạch (có thể sửa):**
- Dùng Claude qua `@anthropic-ai/sdk`, đặt sau interface `Extractor`. Haiku 5.5 chính, Sonnet 5.5 khi cần leo thang.
- Chưa dùng Batch API cho dữ liệu khách (không đủ điều kiện ZDR theo ghi chú nghiên cứu).

## Tiền đề

Module 2 dựa vào `messages.direction` và `sender_kind` của thay đổi echo ở Module 1 (đang nằm trong working tree, chưa commit lúc viết kế hoạch). Bằng chứng (câu gốc) chỉ lấy từ tin khách (`direction = 'inbound'`); tin Page chỉ làm ngữ cảnh. Mốc 2 không bắt đầu được cho tới khi phần này đã commit.

## Điểm API Anthropic đã xác minh (2026-11-09)

Nguồn: tài liệu của skill `claude-api` (bản 2.1.319) và gói `@anthropic-ai/sdk@1.6.0` tải từ npm, đọc trực tiếp file `.d.ts`/`.js`.

| Điểm | Kết luận |
|---|---|
| Model ID | `claude-haiku-5-5`, `claude-sonnet-5-5` (không hậu tố ngày) |
| Structured outputs | `client.messages.parse({ ..., output_config: { format: zodOutputFormat(Schema) } })`; `zodOutputFormat` import từ `@anthropic-ai/sdk/helpers/zod`, dùng `zod/v4` bên trong. Peer `zod ^3.25 \|\| ^4`, tùy chọn. Dự án đang dùng zod 4.6.7 |
| Kết quả parse | `response.parsed_output` là `T \| null`. Output không parse được thì SDK ném `AnthropicError("Failed to parse structured output...")` |
| Dừng bất thường | `stop_reason` có `refusal` và `max_tokens`; `refusal` kèm `stop_details`. Phải kiểm tra trước khi đọc `parsed_output` |
| Citations | Không dùng chung được với `output_config.format` (400) → dùng mẫu quote + kiểm chứng bằng code |
| Prompt caching | Ngưỡng 512 token cho Haiku 5.5 và Sonnet 5.5 (skill ghi "kiểm tra lại tài liệu trước khi dựa vào"); đọc `usage.cache_read_input_tokens` và `cache_creation_input_tokens` |
| Tiêm `fetch`, timeout, retry | `ClientOptions` có `fetch`, `timeout` (mili giây trong TS), `maxRetries` (mặc định 2), `fetchOptions`. Test dùng fetch giả như `tests/helpers/fake-meta.ts` |
| Lớp lỗi | `Anthropic.APIError` (cơ sở, có `status`), `APIConnectionError` và con `APIConnectionTimeoutError`, `RateLimitError` (429), `InternalServerError` (>=500), `BadRequestError` (400), `AuthenticationError` (401). Kiểm `APIConnectionError` trước `APIError` vì nó là lớp con |
| Thinking, effort | Haiku 5.5: adaptive mặc định bật, `budget_tokens` và `temperature`/`top_p`/`top_k` khác mặc định bị 400, effort mặc định `medium`. Sonnet 5.5: không gửi `thinking: {type: "disabled"}` (400); tool_choice ép `any`/`tool` cũng 400. Trích xuất: không gửi `thinking`, đặt `output_config.effort: "low"`, và để `max_tokens` đủ lớn vì thinking tính vào `max_tokens` |
| Prefill | Đã bỏ trên model 5.x: không dùng assistant prefill |
| Refusal fallback | Haiku 5.5 không có fallback phía server; Sonnet 5.5 chỉ dạng `"default"`. Module tự xử lý: refusal thì thử lại một lần bằng model leo thang rồi ghi run `failed` |

**Chưa xác minh (ghi vào cuối PROGRESS.md):** giới hạn schema của strict decoding (`minLength`, `pattern` bị cấm theo ghi chú nghiên cứu, chưa thấy trong tài liệu skill); giá trị chính xác của ngưỡng cache khi dùng cho Haiku 5.5; chất lượng trên tiếng Việt không dấu và teencode (chưa có benchmark); chi phí thực tế của một lần trích.

## Mô hình dữ liệu (mốc 2)

Migration `drizzle/0003_*`, sửa `src/db/schema.ts`. Theo mẫu hiện có: `id()` dùng `uuidv7`, thời gian `timestamptz`, FK ghép với `tenant_id`.

- **`tenants`:** thêm `ai_extraction_enabled boolean NOT NULL DEFAULT false`, `ai_enabled_at timestamptz NULL`.
- **`extraction_runs`:** `id`, `tenant_id`, `conversation_id`, `up_to_message_id`, `prompt_version`, `model`, `status` (`succeeded|failed|skipped`), `failure_reason` (`refusal|max_tokens|invalid_output|provider_error`), `input_tokens`, `output_tokens`, `cache_read_tokens`, `fields_proposed`, `fields_rejected`, `created_at`. `UNIQUE (conversation_id, up_to_message_id, prompt_version)` làm khóa idempotency.
- **`proposals`:** `id`, `tenant_id`, `conversation_id`, `run_id`, `field` (`customer_name|phone|address|product_interest|quantity|budget|timeline|intent|message_purpose`), `value jsonb`, `evidence jsonb` (`[{message_id, start, end, text}]`, là chuỗi con **đã kiểm chứng**, không phải chuỗi mô hình viết ra), `flags text[]`, `status` (`pending|accepted|edited|dismissed|superseded`), `decided_value jsonb`, `decided_by text`, `decided_at`, `created_at`. Partial unique `(conversation_id, field) WHERE status = 'pending'`.
- **`profile_fields`** (dữ liệu đã duyệt): khóa chính `(conversation_id, field)`, `tenant_id`, `value jsonb`, `proposal_id`, `updated_at`, `version int`.

## Pipeline

1. **Kích hoạt:** `process-webhook.ts` sau khi lưu tin, với hội thoại có tin khách mới có text của tenant đã bật AI, gửi job `extract-conversation` với `singletonKey = conversationId`, `startAfter = AI_DEBOUNCE_SECONDS` (mặc định 30). Lỗi enqueue không làm hỏng job webhook; lưới an toàn là cron sweeper mỗi 5 phút. Tin backfill và tin trước `ai_enabled_at` không tự trích; chạy tay bằng CLI.
2. **Worker:** nạp tối đa 30 tin gần nhất cả hai chiều và `profile_fields` đã duyệt → bỏ qua nếu không có tin khách mới → tiền xử lý tất định (SĐT, tin vô nghĩa) → gọi `Extractor` → kiểm chứng căn cứ → phân loại biểu thức thời gian (không giải ngày) → so với dữ liệu đã duyệt và đề xuất đang chờ → ghi run và proposals trong một transaction.
3. **Kiểm chứng căn cứ:** `message_id` phải thuộc đúng hội thoại và là tin khách. Quote phải là chuỗi con sau chuẩn hóa (NFC, gộp khoảng trắng, không phân biệt hoa thường và dấu); lưu bản gốc kèm offset. Cho phép khớp mờ có giới hạn rồi "snap" về chuỗi con thật, gắn cờ `fuzzy_match`. SĐT và số tiền phải xuất hiện nguyên văn trong quote. Không đạt thì bỏ trường và tăng `fields_rejected`.
4. **Ngày:** bộ phân loại tất định gắn `absolute|relative|vague`. Không bao giờ ra ngày đã giải. `relative` và `vague` mang cờ `needs_clarification` kèm cụm từ gốc và `sent_at` của tin.
5. **Lỗi:** lỗi mạng, 429, 5xx, timeout thì ném lỗi để pg-boss retry rồi vào dead-letter `extract-conversation-dead` (thêm vào `ALL_QUEUES`/`DEAD_LETTER_QUEUES` để `queue:status` và `queue:redrive` dùng được). Refusal, `max_tokens`, output sai schema, hoặc hơn nửa số trường bị loại: thử lại một lần bằng model leo thang; vẫn lỗi thì ghi run `failed` và tiến mốc để sweeper không lặp vô hạn.

## Cấu trúc thư mục mới

```
src/extraction/  schema.ts · prompt.ts · extractor.ts · verify-evidence.ts · phone.ts
                 time-expr.ts · run.ts · worker.ts · proposals.ts
scripts/eval-extraction.ts        # đánh giá với model thật, không thuộc npm test
tests/fixtures/extraction/        # hội thoại TỰ VIẾT, không dùng dữ liệu thật
```

Tái sử dụng: `createBoss`/`ensureQueue`/`*_QUEUE_DEFAULTS` (`src/queue/boss.ts`), `ALL_QUEUES`/`redriveDeadLetter` (`src/queue/admin.ts`), `startQueueMonitor`, mẫu client ngoài của `GraphClient` (timeout, xóa bí mật khỏi lỗi, lớp lỗi có getter, `fetch` tiêm được), mẫu test `fake-meta.ts` và `webhook-pipeline.test.ts`, `loadEnv` (zod), khung CLI `src/cli/`.

**Env mới:** `ANTHROPIC_API_KEY` (tùy chọn, thiếu thì worker không khởi động và có cảnh báo), `AI_MODEL` (`claude-haiku-5-5`), `AI_ESCALATION_MODEL` (`claude-sonnet-5-5`), `AI_DEBOUNCE_SECONDS=30`, `AI_TIMEOUT_MS`, `AI_CONTEXT_MESSAGES=30`. Thêm `apiKey` và `x-api-key` vào `LOG_REDACT_PATHS`. Log chỉ ghi số đếm, id, token usage; không bao giờ ghi nội dung tin, quote hay giá trị trích.

**CLI mới:** `ai:enable|ai:disable <tenantId>`, `extract:run`, `extract:status`, `proposals:list`, `proposals:decide <id> accept|dismiss|edit --by <tên>`.

## Các mốc

Mỗi mốc theo quy trình trong CLAUDE.md: test (và `code-review` với mốc lớn), cập nhật PROGRESS.md, một commit, dừng chờ "tiếp".

- **Mốc 0: Tiền đề.** Thay đổi echo của Module 1 đã commit và `npm test` đạt. *(Người dùng chọn bỏ qua; xem PROGRESS.md.)*
- **Mốc 1: Kế hoạch.** Tài liệu này; cập nhật PROGRESS.md và CLAUDE.md; xác minh điểm API Anthropic ở trên.
- **Mốc 2: DB.** Schema, migration, test ràng buộc (FK ghép tenant, partial unique đề xuất chờ, khóa idempotency).
- **Mốc 3: Công cụ tất định.** `verify-evidence`, `phone`, `time-expr`; test bảng ca (có dấu, không dấu, teencode, quote bị "thêm dấu", quote bịa, số 11 chữ số cũ, `+84`, "mai/thứ 6/tuần sau" không ra ngày); mutation test cho bước loại quote bịa.
- **Mốc 4: Extractor và đánh giá.** Thêm `@anthropic-ai/sdk`, `libphonenumber-js`. Test bằng fetch giả: đúng; refusal; max_tokens; schema sai; 429/5xx; timeout; API key không lọt vào lỗi hay log. `scripts/eval-extraction.ts` với 20–30 hội thoại tự viết, chạy tay bằng key thật, ghi precision/recall theo trường, tỷ lệ quote kiểm chứng được, số ngày mơ hồ bị giải (phải bằng 0).
- **Mốc 5: Pipeline.** Queue, dead-letter, debounce, sweeper, `run.ts`, khởi động worker trong `server.ts`. Test với Postgres và pg-boss thật, `Extractor` giả: debounce chỉ cho 1 run, tenant tắt thì không job, enqueue lỗi thì sweeper bù, lỗi tạm thời đi retry rồi dead-letter, refusal leo thang rồi `failed`, quote bịa không tạo đề xuất, đề xuất mới thay cũ, chạy lại không trùng.
- **Mốc 6: Service duyệt và CLI.** `proposals.ts` và các lệnh CLI. Test accept/edit/dismiss, đề xuất đã `superseded` bị từ chối, hai quyết định đồng thời chỉ một cái thắng, `version` tăng.
- **Mốc 7: Quan sát, README, review.** Monitor cảnh báo dead-letter trích xuất và run `failed`; README; `code-review`; kiểm tra cuối module.

## Rủi ro và lưu ý

- Chất lượng Haiku 5.5 trên tiếng Việt không dấu và teencode chưa có benchmark; kết quả eval ở mốc 4 có thể buộc đổi model mặc định. Interface `Extractor` giữ cho việc đổi rẻ.
- Kiểm tra pháp lý là điều kiện để bật `ai:enable` cho tenant thật. Ghi như việc chặn trong PROGRESS.md.
- Không commit dữ liệu chat thật vào fixtures hay `eval-data/` (thư mục này nằm trong `.gitignore`).

## Kiểm tra cuối module

`npm run typecheck` sạch; `npm test` đạt 2–3 lần liên tiếp (gồm test pipeline với Postgres và pg-boss thật). Kịch bản trên DB dev với `Extractor` giả: `ai:enable` → POST `/webhook` ba tin khách có SĐT và "tuần sau lấy" → sau debounce `proposals:list` có đề xuất `phone` (quote đúng offset) và `timeline` có cờ `needs_clarification` không kèm ngày → `proposals:decide ... accept` cập nhật `profile_fields` → log không chứa nội dung tin hay quote. Chạy `eval-extraction` một lần với key thật và ghi số liệu vào PROGRESS.md.
