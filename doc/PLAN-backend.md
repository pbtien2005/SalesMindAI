# Kế hoạch backend SalesMind AI (phần phục vụ demo MVP)

Ngày 2026-11-10. Chỉ gồm backend (server, DB, hàng đợi, AI, HTTP API). Giao diện `web/` nằm ngoài tài liệu này. Cùng nguồn với [PLAN-demo-mvp.md](PLAN-demo-mvp.md) (kế hoạch tổng) và [PLAN-module2.md](PLAN-module2.md) (thiết kế AI). Trạng thái từng mốc ghi ở [PROGRESS.md](../PROGRESS.md).

## 1. Mục tiêu và ranh giới

Backend phải làm được, với tin nhắn đi vào qua `/webhook` thật:

1. Nhận tin khách và tin do nhân viên gõ ở Page Inbox (có sẵn, Module 1).
2. AI đọc hội thoại, tạo **đề xuất** kèm câu gốc đã kiểm chứng; mốc thời gian mơ hồ thì gắn cờ hỏi lại, không bao giờ ra ngày.
3. Sale duyệt, sửa hoặc bỏ qua qua API; chỉ dữ liệu đã duyệt mới vào `profile_fields`.
4. Tính khi đọc: số lần bám, đề xuất ngừng bám, việc quá hạn, lịch nhắc, khách ưu tiên P1, số liệu AI cho quản lý.
5. Đồng hồ demo tua được, dữ liệu nền và công cụ giả lập tin nhắn để một người diễn được cả kịch bản.

**Ngoài phạm vi:** đăng nhập thật và phân quyền, đơn hàng, cọc, đọc ảnh bill, gửi tin cho khách (CLAUDE.md: module này chỉ đọc), Zalo, gộp khách giữa nhiều Page, chuẩn hóa địa chỉ.

**Quy tắc không đổi (CLAUDE.md):** AI chỉ tạo `proposals`; câu gốc là chuỗi con đã kiểm chứng của tin khách đã lưu; không giải ngày mơ hồ; AI bật theo tenant, mặc định tắt; không log nội dung tin, câu gốc, giá trị AI trích hay `ANTHROPIC_API_KEY`; webhook trả 200 nhanh, xử lý nặng ở worker.

## 2. Hiện trạng

| Phần | Trạng thái |
|---|---|
| Module 1: webhook, chữ ký, khử trùng, echo, standby, backfill, OAuth Page, hàng đợi, dead-letter, quan sát, CLI vận hành | Xong, 374 test. Mốc 4–5 chưa thử với Meta thật (không chặn demo) |
| M2: schema `proposals`, `profile_fields`, `extraction_runs`, `tasks`, `followup_state`, `demo_clock`, `conversations.display_name`, `tenants.ai_extraction_enabled` | Xong, commit, 27 test DB đạt |
| M3 công cụ tất định, M4 extractor, M5 pipeline, M6 service duyệt | Chưa làm |
| Lõi demo (đồng hồ, bám, việc, P1, seed, giả lập) và HTTP API | Chưa làm |

## 3. Quyết định thiết kế

1. **Tính khi đọc, không lưu:** số lần bám, đề xuất ngừng bám, quá hạn, P1 đều là hàm thuần của (dữ liệu DB, `now`). Tua đồng hồ chỉ đổi `now`. Chỉ lưu quyết định của người (`followup_state`, `proposals`, `tasks`).
2. **Một nguồn thời gian:** mọi hàm nghiệp vụ nhận `now: Date` làm tham số. Lớp API lấy `now` từ `getNow(db)`: khi `DEMO_MODE=true` là giờ thật cộng `demo_clock.offset_ms`, ngược lại là giờ thật. Không gọi `new Date()` trong logic nghiệp vụ.
3. **SĐT trích bằng code.** Mô hình không trả SĐT; regex số di động Việt Nam (`0`, `84`, `+84` rồi 3, 5, 7, 8 hoặc 9 và 8 chữ số, cho phép dấu cách, chấm, gạch) chạy trên tin khách, câu gốc là đoạn khớp nguyên văn. Có thể dùng `libphonenumber-js` sau nếu cần.
4. **Hai chế độ AI sau một interface `Extractor`:** `AI_MODE=offline` (luật tất định, chạy không cần khóa, đủ cho các câu của kịch bản) và `AI_MODE=live` (Claude qua `@anthropic-ai/sdk`, mặc định `claude-haiku-5-5`). Mặc định `offline` khi thiếu `ANTHROPIC_API_KEY`. Hai chế độ đi cùng một đường kiểm chứng, nên câu gốc luôn bị kiểm bằng code dù nguồn là gì.
5. **Phân tầng trường** (suy ra từ tên trường, không thêm cột):
   - *Nhẹ* (giao diện tự điền, nhãn "chưa duyệt"): `customer_name`, `product_interest`, `budget`, `quantity`.
   - *Phải duyệt* (Hộp đề xuất): `phone`, `timeline`, `address`.
   - *Tín hiệu* (không hiện cho Sale, dùng tính P1): `intent`, `message_purpose`.
6. **API chỉ tồn tại ở `DEMO_MODE=true`**, không đăng nhập; server từ chối khởi động nếu `DEMO_MODE=true` cùng `NODE_ENV=production`, và ở chế độ này chỉ lắng nghe `127.0.0.1`. Vai trò (`lan`, `ha`) chỉ qua header `x-demo-role` để ghi "ai duyệt", không phải bảo mật.
7. **Giả lập đi qua cửa thật:** công cụ dựng payload Meta, ký bằng `APP_SECRET`, gọi `app.inject` vào đúng `POST /webhook`. Tin của Lan là echo mang `app_id` đầu tiên của `PAGE_INBOX_APP_IDS` nên được phân loại `page_inbox`.
8. **Định nghĩa dùng cho demo:** P1 = tin cuối là của khách, chưa được Page trả lời quá 15 phút, và có đề xuất `message_purpose` hoặc `intent` thuộc nhóm mua hoặc thanh toán (`ask_payment`, `buy_intent`). Quá hạn = việc có `due_at < now` và chưa xong. Bám = số mốc 24 giờ (tối đa 5) kể từ tin Page cuối mà khách chưa phản hồi; 0 nếu khách có hành động sau tin Page cuối hoặc nếu `followup_state` đã ngừng.

## 4. Các mốc backend

Mỗi mốc: test → `PROGRESS.md` → một commit. Đang chạy liên tục theo yêu cầu, không dừng chờ "tiếp".

### B1 (= M3). Công cụ tất định, ~1 ngày
`src/extraction/`
- `verify-evidence.ts`: `locateQuote(text, quote) → {start, end, text} | null`. Chuẩn hóa NFC, bỏ dấu (gồm `đ`→`d`), hạ chữ thường, gộp khoảng trắng; tìm trong chuỗi đã chuẩn hóa rồi ánh xạ ngược về offset gốc (đơn vị UTF-16 như `String.slice`). `text` trả về luôn là `original.slice(start, end)`, không phải chuỗi do mô hình viết. Không khớp mờ.
- `phone.ts`: `findPhones(text) → [{value, start, end, text}]`, chuẩn hóa về dạng `0912345678`; bỏ số 11 chữ số cũ và chuỗi số dài hơn (không cắt trong chuỗi số dài).
- `time-expr.ts`: `classifyTime(phrase) → 'absolute' | 'relative' | 'vague' | 'none'`. **Không có hàm nào trả ra ngày.** `relative` gồm "mai", "hôm nay", "thứ 6", "tuần sau", "cuối tuần"; `vague` gồm "khi nào rảnh", "sớm", "sắp tới".
- Test bảng ca: có dấu, không dấu, teencode, viết hoa lẫn lộn, quote bịa (không có trong tin), quote nằm trong tin của Page (phải bị loại), `+84`, `0912 345 678`, "cuối tuần này", "tầm 15 triệu". Mutation: bỏ bước loại quote bịa thì test đỏ.

### B2 (= M4). Extractor, ~1,5 ngày
- `schema.ts` (zod): đầu ra mô hình = danh sách `{field, value, quotes:[{messageId, quote}]}` trên các trường không phải SĐT.
- `extractor.ts`: interface `Extractor.extract({messages, approved}) → {kind:'ok', fields, usage} | {kind:'refused'|'max_tokens'|'invalid'}`; lỗi mạng, 429, 5xx, timeout thì **ném lỗi** để hàng đợi retry.
- `offline-extractor.ts`: luật cho tên ("Anh Minh đây", "mình tên là..."), sản phẩm (từ khóa sofa, bàn, giường... kèm màu), ngân sách (số kèm triệu/tr/k, từ "tầm", "khoảng"), cụm thời gian (danh sách cụm cố định), mục đích tin (hỏi giá, thanh toán, hẹn xem).
- `anthropic-extractor.ts`: `client.messages.parse` với `output_config.format` (structured outputs), không gửi `thinking`, `output_config.effort: "low"`, `max_tokens` dư; kiểm `stop_reason` (`refusal`, `max_tokens`) trước khi đọc đầu ra; đọc `usage` gồm cache. Chưa thử với khóa thật cho tới khi bạn thêm khóa.
- `prompt.ts`: nhãn phiên bản `PROMPT_VERSION`; tin của Page chỉ là ngữ cảnh, câu gốc chỉ từ tin khách; nhắc "không suy ra ngày".
- Env mới: `AI_MODE`, `ANTHROPIC_API_KEY` (tùy chọn), `AI_MODEL`, `AI_DEBOUNCE_SECONDS` (mặc định 30, demo 3), `AI_TIMEOUT_MS`, `AI_CONTEXT_MESSAGES` (30). Thêm `apiKey`, `x-api-key` vào `LOG_REDACT_PATHS`.
- Test bằng `fetch` giả (mẫu `tests/helpers/fake-meta.ts`): thành công, refusal, `max_tokens`, schema sai, 429, 5xx, timeout, khóa không lọt vào lỗi hay log.
- `scripts/eval-extraction.ts`: viết sẵn cho 10–15 hội thoại tự viết, chạy tay sau khi có khóa; chỉ tiêu "số ngày mơ hồ bị giải = 0".

### B3 (= M5). Pipeline, ~1 ngày
- `StoreResult` thêm danh sách hội thoại có **tin khách mới có text** (lấy từ `RETURNING` của câu INSERT tin). `processWebhookPayload` nhận tùy chọn `afterStore(conversationIds)`, gọi **sau** khi transaction thành công; lỗi trong đó chỉ ghi log (webhook vẫn thành công), lưới an toàn là sweeper.
- Queue `extract-conversation` (+ dead-letter `extract-conversation-dead`), `policy: 'short'` và `singletonKey = conversationId`, `startAfter = AI_DEBOUNCE_SECONDS`. Thêm vào `ALL_QUEUES` và `DEAD_LETTER_QUEUES`, mở rộng `redriveDeadLetter` cho đích `extraction`.
- `run.ts` `runExtraction(deps, conversationId, now)`: tenant tắt AI hoặc tin cuối trước `ai_enabled_at` thì bỏ qua → nạp ≤ 30 tin gần nhất cả hai chiều → tìm SĐT bằng code → gọi `Extractor` → kiểm chứng từng câu gốc (message phải thuộc hội thoại và là tin khách; không đạt thì bỏ trường, tăng `fields_rejected`) → phân loại thời gian (`relative`/`vague` thì cờ `needs_clarification`, lưu cụm gốc và `sent_at` của tin, **không có ngày**) → so với `profile_fields` (đã duyệt cùng giá trị thì bỏ) và đề xuất đang chờ (cùng giá trị thì giữ, khác thì đánh `superseded`) → ghi run và đề xuất trong **một transaction**. Idempotent nhờ `UNIQUE (hội thoại, tin cuối, prompt_version)`.
- Refusal, `max_tokens`, đầu ra sai schema, hoặc hơn nửa số trường bị loại: ghi run `failed` kèm lý do rồi dừng (không leo thang model).
- `sweeper.ts`: mỗi 5 phút (và khi khởi động) tìm hội thoại của tenant bật AI có tin khách mới hơn run gần nhất, xếp job.
- Worker khởi động trong `server.ts` khi `AI_MODE` có hiệu lực.
- Test với Postgres và pg-boss thật, `Extractor` giả: nhiều tin liên tiếp chỉ ra một run; tenant tắt thì không job; enqueue lỗi thì sweeper bù; lỗi tạm thời retry rồi vào dead-letter; refusal ghi `failed`; quote bịa không tạo đề xuất; đề xuất mới thay cũ; chạy lại không trùng.

### B4 (= M6). Service duyệt đề xuất, ~0,5 ngày
`src/extraction/proposals.ts`
- `listPending(conversationId)`, `decide({proposalId, action: 'accept'|'edit'|'dismiss', by, editedText?, chosenAt?}, now)`.
- Trong một transaction, khóa dòng đề xuất; không còn `pending` thì lỗi `ProposalNotPending` (hai quyết định đồng thời chỉ một cái thắng).
- `accept` và `edit` ghi `profile_fields` (`version` tăng, `proposal_id`), đặt `status = accepted | edited`, `decided_value`, `decided_by`, `decided_at`.
- **`timeline` có cờ `needs_clarification` không duyệt được nếu thiếu `chosenAt`** (ISO có múi giờ). Duyệt xong tạo việc `source = 'appointment'`, tiêu đề "Khách hẹn ghé xem", `due_at = chosenAt`. Hệ thống không bao giờ tự điền ngày.
- `dismiss` chỉ đổi trạng thái, không ghi hồ sơ.
- CLI tối thiểu: `proposals:list`, `ai:enable|ai:disable <tenantId>`.
- Test: accept, edit, dismiss, quyết định đồng thời, đề xuất đã `superseded` bị từ chối, `timeline` thiếu ngày bị từ chối, dữ liệu chưa duyệt không bao giờ vào `profile_fields`.

### B5 (= D1). Lõi demo, ~1,5 ngày
`src/demo/` và `src/followup/`
- `clock.ts`: `getNow`, `advanceClock(db, {to | minutes})`, `resetClock`.
- `followup.ts`: `followupCount(conv, now)`, `suggestStop(conv, now)`, `stopFollowup(db, {conversationId, by}, now)` (không ngừng hai lần).
- `reminders.ts`: lịch nhắc cho Lan = việc quá hạn (đỏ), nhắc bám từ lần 1 trở lên của khách chưa ngừng (cam), việc sắp tới (xám). Mỗi mục có `kind`, `conversationId`, `title`, `dueAt`.
- `metrics.ts`: P1, quá hạn, số liệu AI (**tự điền** = số đề xuất nhẹ chưa bị bỏ; **Sale sửa vì sai** = `edited`; **hỏi lại ngày** = `timeline` có cờ; **đề xuất đã duyệt** = `accepted`/`edited` ở tầng phải duyệt + số lần ngừng bám).
- `seed.ts` / `demo:reset` (từ chối nếu không phải `DEMO_MODE`): tạo tenant "Nội thất Minh Phát (demo)" với Page giả, bật AI, đặt đồng hồ về Thứ Năm 12/11/2026 09:00 (+07:00), và 4 khách nền đúng bảng mục 4 của kịch bản: chị Thu (nhắn 08:40 hỏi thanh toán, có đề xuất `message_purpose = ask_payment`), anh Đức (việc quá hạn 08:00), chị Ngọc (việc quá hạn 08:30), cô Mai (bám 4/5). Chạy lại được nhiều lần.
- `simulator.ts`: `sendCustomerMessage({persona|conversationId, text}, now)` và `sendPageMessage({conversationId, text}, now)`: dựng payload, ký, `app.inject` vào `/webhook`, `timestamp = now`. `mid` dạng `demo.<uuid>`. Tạo hội thoại mới với `display_name` khi persona chưa có.
- CLI: `demo:reset`, `demo:send`, `demo:clock`.
- Test: bám ở các mốc 0, 23, 24, 48 giờ và tối đa 5; khách phản hồi thì về 0; ngừng bám; quá hạn khi tua giờ; P1 vào và ra theo 15 phút và theo tín hiệu; số liệu AI khớp với dữ liệu; `demo:reset` lặp lại cho kết quả giống nhau; giả lập đi qua chữ ký thật (sai khóa thì 403).

### B6 (= D2). HTTP API demo, ~1 ngày
`src/api/` đăng ký khi `DEMO_MODE=true`. Mọi route kiểm đầu vào bằng zod; lỗi trả `{error: {code, message}}`; không có route nào trả token, PSID thô hay `mid` của Meta ra ngoài trừ khi cần.

| Route | Việc |
|---|---|
| `GET /api/now` | `{now, role}` |
| `POST /api/clock/advance` | `{to}` hoặc `{minutes}` |
| `GET /api/inbox` | danh sách hội thoại sắp theo tin mới nhất: `id`, `displayName`, `lastMessage` (cắt ngắn), `awaitingMinutes`, `followup {count, max: 5, stopped, suggestStop}`, `isP1`, `isNew` |
| `GET /api/conversations/:id` | tin (`id`, `direction`, `senderKind`, `text`, `sentAt`), thẻ khách (hồ sơ đã duyệt + đề xuất nhẹ đang chờ, mỗi mục có `evidence`), Hộp đề xuất (đề xuất `phone`/`timeline`/`address` đang chờ, kèm `flags`), `followup`, việc của hội thoại |
| `POST /api/proposals/:id/decide` | `{action, editedText?, chosenAt?}`; `by` lấy từ vai trò |
| `POST /api/conversations/:id/stop-followup` | ngừng bám |
| `GET /api/home` | thẻ P1, quá hạn, lịch nhắc, số liệu AI |
| `GET /api/overdue` | danh sách việc quá hạn |
| `GET /api/conversations/:id/history` | lịch sử "AI đề xuất, ai duyệt, lúc nào" |
| `POST /api/demo/customer-message` | `{persona|conversationId, text}` |
| `POST /api/demo/page-message` | `{conversationId, text}` |
| `POST /api/demo/reset` | dựng lại dữ liệu nền |

Câu gốc trong `evidence` là `{messageId (UUID của messages.id), start, end, text}` để giao diện tô đoạn khớp theo offset. Test bằng `app.inject`: hình dạng phản hồi, tin của Page không bao giờ làm câu gốc, đề xuất `timeline` không có trường ngày, API không đăng ký khi `DEMO_MODE` tắt, server từ chối `DEMO_MODE=true` cùng `NODE_ENV=production`.

### B7. Vận hành và chất lượng, ~0,5 ngày
- `.env.example` và `README.md`: biến AI và demo, cách chạy `demo:reset` rồi `npm run dev`, ghi rõ chế độ `offline` và điều chưa thử với khóa thật.
- Cập nhật CLAUDE.md (có HTTP API chỉ ở DEMO_MODE; Module 2 có service, CLI và API demo).
- Monitor cảnh báo `extract-conversation-dead` và số run `failed`.
- `code-review` toàn phần mới; `npm run typecheck`; `npm test` 2–3 lần liên tiếp.

Tổng khoảng 6–7 ngày làm việc, chưa tính giao diện.

## 5. Mô hình dữ liệu còn thiếu so với schema hiện có

Không cần migration mới cho B1–B6 nếu giữ các quyết định trên. Hai điều cần để mắt: (a) `proposals.value` luôn là object `{text, kind?, sentAt?}`, được kiểm bằng zod ở tầng service chứ không bằng DB; (b) lịch sử hiển thị suy từ `proposals` (`created_at`, `decided_by`, `decided_at`) cộng `followup_state`, nên không có bảng lịch sử riêng.

## 6. Rủi ro và điều chưa xác minh

- **Chất lượng Claude trên tiếng Việt** (không dấu, teencode) và giới hạn schema của structured outputs chưa kiểm, vì chưa có khóa API. Chế độ `offline` giữ cho demo chạy được; kết quả `live` chỉ biết khi bạn thêm khóa và chạy `scripts/eval-extraction.ts`.
- **Luật trích xuất offline chỉ phủ các câu của kịch bản và vài biến thể.** Câu lạ có thể không ra đề xuất. Đó là giới hạn có chủ ý của chế độ dự phòng, không phải chất lượng AI thật.
- **Pháp lý (Luật 91/2025/QH15):** `live` gửi nội dung chat sang API nước ngoài. Chỉ dùng câu tự viết trong demo; `ai_extraction_enabled` chỉ bật cho tenant demo.
- **API không có xác thực:** an toàn dựa vào `DEMO_MODE`, chỉ nghe localhost và chặn ở production. Không dùng cho dữ liệu khách thật.
- **`timestamp` của Meta và payload thật** vẫn chưa được xác minh với Page thật; demo không bị ảnh hưởng vì dùng payload giả.

## 7. Kiểm tra cuối phần backend

1. `npm run typecheck` sạch; `npm test` đạt 2–3 lần liên tiếp (gồm test pipeline với Postgres và pg-boss thật).
2. `npm run db:migrate`, `npm run cli -- demo:reset`, `npm run dev` với `DEMO_MODE=true AI_MODE=offline AI_DEBOUNCE_SECONDS=3`.
3. Chạy kịch bản bằng `curl` hoặc CLI, không cần giao diện: gửi hai tin cảnh 1 → sau khoảng 3 giây `GET /api/conversations/:id` có "Mẫu đã hỏi" và "Ngân sách" kèm câu gốc đúng offset → tua tới Thứ Sáu 09:30 thì `GET /api/inbox` báo bám 1/5 cho anh Minh và `suggestStop` cho cô Mai → gửi tin cảnh 3 → có đề xuất `phone` hợp lệ và `timeline` cờ `needs_clarification` không kèm ngày → `decide` `timeline` thiếu `chosenAt` bị từ chối, có `chosenAt` thì thành việc "Thứ Bảy 14/11 10:00" → `GET /api/home` khớp số liệu mục 6 của kịch bản (sau khi điều chỉnh vì bỏ cảnh 4–5).
4. Log không chứa nội dung tin, câu gốc, giá trị trích hay khóa API.
5. `demo:reset` rồi lặp lại bước 3 ba lần liên tiếp cho cùng kết quả.
