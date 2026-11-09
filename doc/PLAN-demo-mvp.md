# Kế hoạch hoàn thiện MVP để demo (cảnh 0–3 và 6)

Ngày 2026-11-10. Trạng thái từng mốc nằm ở [PROGRESS.md](../PROGRESS.md). Kịch bản: [KICH-BAN-DEMO-MVP.md](KICH-BAN-DEMO-MVP.md). Kế hoạch Module 2 gốc: [PLAN-module2.md](PLAN-module2.md) (các mốc M2–M6 dưới đây là mốc 2–6 của nó).

## Điều chỉnh khi thực hiện (so với bản được duyệt)

Người dùng chọn chạy liên tục các mốc, không dừng chờ "tiếp", và chưa có `ANTHROPIC_API_KEY`. Vì vậy:

- **Không có chế độ `replay`.** Thay bằng `AI_MODE=offline`: một `Extractor` dựa trên luật, tất định, chạy được khi không có khóa, đủ cho các câu trong kịch bản. `AI_MODE=live` gọi Claude thật (Haiku 5.5) và chưa được thử cho tới khi có khóa. Spike AI ở bước 0 và `scripts/eval-extraction.ts` chỉ viết sẵn, chưa chạy.
- **SĐT trích bằng code (regex số di động Việt Nam), không qua mô hình và không dùng `libphonenumber-js`.** Mô hình chỉ trích các trường còn lại.
- **Không leo thang sang model mạnh hơn khi bị từ chối**: ghi run `failed` rồi dừng.
- **Không dùng shadcn**: chỉ Tailwind.

## Context

Kịch bản demo `doc/KICH-BAN-DEMO-MVP.md` (8 phút 30 giây, 7 cảnh) cần một sản phẩm chạy được từ tin nhắn tới màn hình quản lý. Hiện chỉ có phần nhận tin. Đã chốt với bạn: **làm cảnh 0–3 và 6** (bỏ cảnh 4–5: đơn nháp, bill, đơn hàng), **phát lại tin giả ký đúng chữ ký** thay vì Page thật, **1–2 tuần, làm một mình**.

Ba điều khán giả phải nhớ (mục 1 của kịch bản) vẫn chứng minh được trọn vẹn: câu gốc truy được, ngày mơ hồ thì hỏi lại, quyết định có hậu quả (ngừng bám, duyệt SĐT/ngày hẹn) do Sale xác nhận.

## Hiện trạng (đã kiểm tra)

| Phần | Trạng thái | Ghi chú |
|---|---|---|
| Module 1: webhook, chữ ký, khử trùng, echo, backfill, OAuth, hàng đợi | Code xong, 374 test (theo PROGRESS.md) | Mốc 4–5 chưa thử với Meta thật. Không cản demo vì dùng tin giả |
| Echo (tin Page gửi) | Đã commit `25e21bb` | Cảnh 1–3 cần: nhãn "Page Inbox", đồng hồ chờ trả lời |
| Module 2 mốc 0 | Ghi "bỏ qua" nhưng commit `25e21bb` đã có | Đóng bằng cách chạy `npm test` và ghi bằng chứng |
| Module 2 mốc 1 | Xong (chỉ có kế hoạch) | `doc/PLAN-module2.md`. Chưa có SDK Anthropic trong `package.json` |
| Module 2 mốc 2–7 | Chưa có code | `proposals`, `profile_fields`, extractor, pipeline chưa tồn tại |
| HTTP API, giao diện, đăng nhập | Không có | `src/` chỉ có webhook, OAuth, health |
| Bộ đếm bám, việc/lịch nhắc, P1, đồng hồ demo, dữ liệu nền | Không có | Kịch bản mục 8 tự ghi "chưa có" |
| Chưa commit | `doc/KICH-BAN-DEMO-MVP.md`, drawio, PDF, `reports/`, `research_notes/`, `.claude/skills/pdf/` | Quyết định commit hay `.gitignore` ở bước 0 |

**Xung đột cần xử lý:** CLAUDE.md và PLAN-module2 ghi "Module 2 chỉ có service nội bộ và CLI, chưa có HTTP API, đăng nhập, giao diện". Demo cần giao diện nên phải thêm HTTP API. Giải pháp: API chỉ bật khi `DEMO_MODE=true` (mặc định tắt, nghe localhost), không đăng nhập thật; cập nhật CLAUDE.md để phản ánh.

## Quyết định thiết kế (của tôi, bạn có thể sửa)

1. **Cắt phạm vi thành "đường đi mỏng":** mỗi cảnh chỉ làm đúng thứ kịch bản hiện ra, không làm tổng quát.
2. **Tầng AI:** trường nhẹ (tên, sản phẩm, ngân sách) = `proposals` trạng thái `pending` nhưng giao diện hiện thẳng trên thẻ khách với nhãn "AI điền, chưa duyệt". Trường phải duyệt (SĐT, mốc hẹn) hiện trong Hộp đề xuất. Phân tầng suy ra từ tên trường, không thêm cột. Vẫn giữ quy tắc CLAUDE.md: chỉ `profile_fields` mới là dữ liệu đã duyệt.
3. **Bộ đếm bám tính khi đọc, không lưu:** `bám = số mốc 24 giờ (tối đa 5) kể từ tin Page cuối mà khách chưa phản hồi`, dựa trên `last_page_message_at` và `last_user_interaction_at` có sẵn. Tua đồng hồ chỉ cần đổi `now`. Chỉ lưu quyết định "ngừng bám" (bảng `followup_state`). "Đề xuất ngừng bám" là kết quả suy ra (bám ≥ 5 và chưa ngừng), Sale xác nhận mới ghi.
4. **Đồng hồ demo:** một nguồn `now()` duy nhất, độ lệch lưu trong DB (bảng một dòng `demo_clock`) để server, CLI và test thấy cùng giá trị. Mọi logic bám, quá hạn, P1, lịch nhắc dùng `now()` này. Chỉ có hiệu lực khi `DEMO_MODE=true`.
5. **Tin của khách và của Lan đều đi qua `/webhook` thật:** công cụ mô phỏng dựng payload Meta, ký bằng `APP_SECRET`, gửi vào đúng route. Nhờ vậy demo kiểm cả chữ ký, hàng đợi, khử trùng. Tin của Lan là echo với `app_id` của Page Inbox (`263902037430900`) nên hiện nhãn "Page Inbox". `sent_at` do ta đặt theo đồng hồ demo.
6. **Một mình làm cả hai vai:** giao diện có bảng "Giả lập" (chỉ ở DEMO_MODE): gửi tin của khách, gõ tin của Lan ở Page Inbox, tua đồng hồ, đổi vai Lan / chị Hà. Bạn A dùng Messenger chỉ là phần thêm nếu mốc 4 xong.
7. **Cập nhật thời gian thực bằng polling 2 giây** (TanStack Query `refetchInterval`), không SSE/WebSocket: đơn giản, ít lỗi, đủ cho demo.
8. **Giao diện:** `web/` riêng, Vite + React 19 + Tailwind v4 + TanStack Query. Bỏ TanStack Router (3 màn: Chat, Trang chủ, và vùng Giả lập dùng state) và chỉ lấy vài thành phần shadcn cần thiết.
9. **Rủi ro AI khi diễn:** `Extractor` có chế độ `AI_MODE=live|replay`. Chạy live nhiều lần với đúng các câu trong kịch bản, lưu kết quả (không chứa dữ liệu thật vì toàn câu tự viết); khi mạng hoặc API lỗi thì `replay` phát lại. Debounce chỉnh `AI_DEBOUNCE_SECONDS=3`.
10. **Định nghĩa dùng cho demo (kịch bản mục 4):** P1 = khách chưa được trả lời quá 15 phút và tin cuối có ý hỏi thanh toán/mua (lấy từ trường `message_purpose`/`intent` của AI); quá hạn = việc có `due_at` đã qua chưa hoàn thành.

## Các mốc (mỗi mốc: test → PROGRESS.md → một commit → dừng chờ "tiếp", đúng CLAUDE.md)

Ước tính: 10–11 ngày làm việc, sát giới hạn 2 tuần. Mốc có đánh dấu ★ là lưới an toàn khi chậm, xem mục "Nếu trễ".

**Bước 0 (0,5 ngày): dọn nền**
- Chạy `npm test` và `npm run typecheck` trên `main`, ghi bằng chứng vào PROGRESS.md để đóng Module 2 mốc 0.
- Quyết định các file chưa commit (kịch bản, drawio, PDF, `reports/`, `research_notes/`): commit tài liệu, bỏ `.claude/skills/pdf/` nếu không cần.
- **Spike AI (vứt đi, 0,5 ngày):** gọi Haiku 5.5 thật với ba tin của cảnh 1 và 3 để biết sớm chất lượng, độ trễ, chi phí và giới hạn schema. Đây là rủi ro lớn nhất của cả demo. Cần `ANTHROPIC_API_KEY` của bạn.

**M2: DB (1 ngày)** — Module 2 mốc 2 theo `PLAN-module2.md`, thêm:
- `tenants.ai_extraction_enabled`, `extraction_runs`, `proposals`, `profile_fields` (như kế hoạch).
- Mới cho demo: `tasks` (việc: `conversation_id`, `title`, `due_at`, `done_at`, `source`), `followup_state` (`conversation_id`, `stopped_at`, `stopped_by`), `demo_clock` (một dòng).
- Test ràng buộc: FK ghép tenant, partial unique đề xuất chờ, khóa idempotency.

**M3: Công cụ tất định (1 ngày)** — `verify-evidence.ts`, `phone.ts` (`libphonenumber-js`), `time-expr.ts` (chỉ phân loại, **không bao giờ giải ngày**). Test bảng ca theo kế hoạch; ưu tiên ca "0912 345 678", "cuối tuần này", "tầm 15 triệu".

**M4: Extractor và đánh giá (1,5 ngày)** — `@anthropic-ai/sdk`, interface `Extractor`, chế độ `live|replay`, fetch giả cho test (lỗi 429/5xx/refusal/max_tokens/API key không lọt log). `scripts/eval-extraction.ts` thu gọn: 10–15 hội thoại tự viết quanh kịch bản và biến thể (không dấu, teencode, "tầm", "cuối tuần"). Chỉ tiêu: số ngày mơ hồ bị giải = 0.

**M5: Pipeline (1 ngày)** — queue `extract-conversation` + dead-letter, debounce, sweeper, hook trong `process-webhook.ts`, worker trong `server.ts`. Test với Postgres và pg-boss thật, Extractor giả.

**M6: Service duyệt đề xuất (0,5 ngày)** — `src/extraction/proposals.ts`: accept / edit / dismiss, `superseded`, tăng `version`, ghi `profile_fields`. Chỉ thêm CLI tối thiểu (`proposals:list`); giao diện thay CLI duyệt.

**D1: Lõi demo (1,5 ngày)** — `src/demo/`
- `clock.ts` (nguồn `now()`), bộ đếm bám, đề xuất ngừng bám, `tasks` + lịch nhắc (gồm việc sinh từ mốc hẹn đã xác nhận: "Thứ Bảy 14/11 10:00"), P1, quá hạn, số liệu AI (tự điền / Sale sửa / hỏi lại ngày / đã duyệt).
- Khi duyệt `timeline`: Sale **bắt buộc chọn ngày giờ**, giá trị lưu ở `decided_value`; hệ thống không tự điền.
- Reset bộ đếm bám khi khách phản hồi (kịch bản mục 10 ghi chú giả định này).
- Seed 4 khách nền (Chị Thu, Anh Đức, Chị Ngọc, Cô Mai) đúng bảng mục 4, và `demo:reset` đưa DB về 09:00 Thứ Năm 12/11 để chạy lại nhiều lần.
- Công cụ giả lập: dựng payload + ký + POST `/webhook` (CLI `demo:send` và endpoint dùng cho bảng Giả lập).

**D2: HTTP API demo (1 ngày)** — Fastify `/api/*`, chỉ đăng ký khi `DEMO_MODE=true`:
inbox, chi tiết hội thoại (tin + thẻ khách + đề xuất + câu gốc kèm offset), quyết định đề xuất, ngừng bám, trang chủ (4 thẻ + dòng AI), danh sách quá hạn, đồng hồ, giả lập. Vai trò Lan / chị Hà qua header `x-demo-role` (không phải bảo mật, chỉ đổi màn hình).

**D3: Giao diện Chat (2 ngày)** — `web/`: Inbox list (chấm "Mới", chờ khách bao lâu, bộ đếm bám, cờ P1), khung chat với nhãn nguồn tin (Page Inbox), thẻ khách ghim với nhãn "AI điền, chưa duyệt / Đã duyệt bởi … / Cần xác nhận / Thiếu", popup câu gốc tô vàng theo offset, Hộp đề xuất với Duyệt / Sửa / Bỏ qua, chọn ngày giờ cho mốc hẹn mơ hồ.

**D4: Trang chủ và điều khiển demo (1 ngày)** — thẻ P1, việc quá hạn, lịch nhắc (có màu), dòng số liệu AI; đổi vai; đồng hồ + nút "Tua đồng hồ"; bảng Giả lập; màn danh sách quá hạn và lịch sử "AI đề xuất, ai duyệt, lúc nào".

**D5: Tổng duyệt (1 ngày)** — chạy trọn cảnh 0–3 và 6 ba lần liên tiếp trên DB sạch (`demo:reset`), chỉnh lỗi; lưu kết quả AI để chạy `replay`; quay video dự phòng; cập nhật kịch bản (xem dưới); README mục demo; `code-review` trước commit cuối.

## Sửa kịch bản vì cắt cảnh 4–5

- Cảnh 6: bỏ thẻ "Tiền cọc hôm nay" (hoặc ghi cố định "Sắp có") và giảm số "đề xuất Sale đã duyệt" từ 6 xuống còn số thật (SĐT, mốc hẹn, ngừng bám Cô Mai ≈ 3). Chỉnh lời dẫn cảnh 0 ("từ tin nhắn đầu tiên tới tiền cọc") thành "tới lịch hẹn".
- Cảnh 3 kết thúc ở "Lịch chăm sóc lại Thứ Bảy 14/11 10:00"; bỏ dòng "Theo dõi và chốt đơn" nếu không làm trạng thái khách.
- Mục 8 của kịch bản: đánh dấu 4–5 là "ngoài MVP demo". Thời lượng còn khoảng 5 phút.

## Nếu trễ (cắt theo thứ tự)

1. Bỏ dòng "đề xuất ngừng bám Cô Mai" (cảnh 2 chỉ còn nhắc bám 1/5 của anh Minh).
2. Bỏ màn "lịch sử đề xuất" và danh sách quá hạn chi tiết (cảnh 6 chỉ còn Trang chủ).
3. Bỏ chế độ `replay` nếu live đủ ổn định.
4. Dùng Zalo/Page thật: **không làm**, ngoài phạm vi.

## Rủi ro và điều chưa chắc

- **Chất lượng Haiku 5.5 trên câu tiếng Việt** (chưa có benchmark): spike ở bước 0 trả lời sớm; nếu kém thì đổi model qua `AI_MODEL`.
- **Giới hạn schema strict decoding** (`minLength`, `pattern`): kiểm bằng spike, kiểm tra SĐT/ngày làm bằng code dù sao.
- **Pháp lý (Luật 91/2025/QH15):** chỉ dùng câu tự viết trong demo, không đưa chat thật. `ai_extraction_enabled` chỉ bật cho tenant demo.
- **Mỗi mốc phải chờ bạn nói "tiếp"** (CLAUDE.md), nên thời gian thật phụ thuộc nhịp phản hồi của bạn. Nếu muốn chạy liền D1–D4, cần bạn cho phép gộp mốc.
- **Chưa xác minh Meta thật** (mốc 4–5 Module 1): demo dùng tin giả nên không chặn; vẫn nên thử Page thật riêng nếu còn thời gian.
- Giao diện là phần lớn nhất và chưa có sẵn; nếu D3 vượt 2 ngày thì cắt theo danh sách trên.

## File chính sẽ thêm/sửa

- Sửa: `src/db/schema.ts`, `src/workers/process-webhook.ts`, `src/server.ts`, `src/app.ts`, `src/config/env.ts`, `src/queue/boss.ts`, `src/queue/admin.ts`, `src/cli/index.ts`, `package.json`, `CLAUDE.md`, `PROGRESS.md`, `doc/PLAN-module2.md`, `doc/KICH-BAN-DEMO-MVP.md`, `.env.example`, `README.md`.
- Thêm: `src/extraction/*` (theo PLAN-module2), `src/demo/*` (clock, followup, tasks, seed, simulator), `src/api/*`, `drizzle/0003_*`, `scripts/eval-extraction.ts`, `web/`, `tests/fixtures/extraction/`.
- Tái sử dụng: `createBoss`/`ensureQueue` (`src/queue/boss.ts`), `ALL_QUEUES`/`redriveDeadLetter` (`src/queue/admin.ts`), mẫu client ngoài của `GraphClient` (`src/meta/graph-client.ts`), `signature.ts` để ký payload giả, `sender-kind.ts` (nhãn Page Inbox theo `app_id`), mẫu test `tests/helpers/fake-meta.ts` và `tests/webhook-pipeline.test.ts`, `loadEnv` (`src/config/env.ts`), khung CLI `src/cli/`.

## Kiểm tra từ đầu đến cuối

1. `npm run typecheck` sạch; `npm test` đạt 2–3 lần liên tiếp (gồm test pipeline với Postgres và pg-boss thật).
2. `docker compose up -d`, `npm run db:migrate`, `npm run cli -- demo:reset`, rồi `npm run dev` với `DEMO_MODE=true`, `AI_DEBOUNCE_SECONDS=3`, và `cd web && npm run dev`.
3. Chạy tay đúng kịch bản: Trang chủ (P1 = 1, quá hạn = 2) → khách gửi hai tin cảnh 1 → sau khoảng 3 giây thẻ khách có "Mẫu đã hỏi", "Ngân sách" nhãn chưa duyệt, rê chuột ra "tầm 15 triệu" tô vàng → tua tới Thứ Sáu 09:30 thấy "Bám 1/5" và đề xuất ngừng bám Cô Mai → cảnh 3: Hộp đề xuất có SĐT (✓) và "cuối tuần này" với ô ngày **trống** → chọn Thứ Bảy 10:00, Duyệt → lịch nhắc có "Thứ Bảy 14/11 10:00" → đổi vai chị Hà, kiểm số liệu Trang chủ.
4. Kiểm chứng ba điều cốt lõi bằng test: câu gốc luôn là chuỗi con của tin khách; không có đường nào ghi ngày vào `proposals` khi cụm thời gian mơ hồ (số ngày bị giải = 0); không dữ liệu chưa duyệt nào vào `profile_fields`.
5. Log: không chứa nội dung tin, câu gốc, giá trị AI trích hay `ANTHROPIC_API_KEY`.
6. Chạy `demo:reset` rồi lặp lại bước 3 ba lần liên tiếp, và thử một lần với `AI_MODE=replay` ngắt mạng.
