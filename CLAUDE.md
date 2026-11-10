# CLAUDE.md — SalesMind AI

## Tổng quan
Nền tảng AI hỗ trợ đội Sale (doanh nghiệp VN, đội 5–30 người). Luồng: tin nhắn khách vào Facebook Page → AI trích nhu cầu/ngân sách/mốc thời gian → đề xuất công việc → nhân viên xác nhận → hệ thống nhắc hạn, báo cáo cho quản lý.

Nguyên tắc sản phẩm:
- AI đề xuất, con người quyết định.
- Mọi thông tin AI trích phải kèm câu gốc làm căn cứ.
- Mốc thời gian mơ hồ thì hỏi lại, không tự suy ra ngày.

**Giai đoạn hiện tại: Module 2 "AI trích xuất thông tin từ tin nhắn"** (kế hoạch: `doc/PLAN-module2.md`). Module 1 "Tiếp nhận tin nhắn từ Facebook Page" đã có code cho mốc 0–6 (mốc 4 và 5 còn chờ thử với Page thật). Module 2 có service nội bộ, CLI và (chỉ để demo) một API `/api/*`; giao diện demo `web/` (Vite, React 19, Tailwind v4, TanStack Query; kế hoạch `doc/PLAN-frontend.md`) đã có mốc F0–F5: Trang chủ, Hội thoại, Hộp đề xuất, Bảng Giả lập; xem mục "Demo MVP" dưới đây; **có tài khoản đăng nhập thật** (email và mật khẩu, nhiều doanh nghiệp, vai trò owner/manager/sale; kế hoạch `doc/PLAN-san-pham.md`, mốc P1–P3 xong). Đề án gốc: `doc/` (không chép lại ở đây).

**Demo MVP** (kế hoạch: `doc/PLAN-demo-mvp.md`, `doc/PLAN-backend.md`; kịch bản: `doc/KICH-BAN-DEMO-MVP.md`; chạy: `doc/CHAY-DEMO.md`). Phạm vi cảnh 0–3 và 6. Mọi `/api/*` cần phiên đăng nhập (cookie HttpOnly, chống CSRF bằng header `x-requested-with`); tenant lấy từ phiên, không bao giờ từ client; tài nguyên tenant khác trả 404 (test cách ly tự liệt kê route). Route demo (đồng hồ tua, giả lập, đặt lại, `/api/auth/demo-login`) chỉ tồn tại khi `DEMO_MODE=true`, chỉ với tenant demo (hai tài khoản `lan@demo.local` sale và `ha@demo.local` manager), chỉ nghe `127.0.0.1` (đổi bằng `HOST`), bị từ chối ở `NODE_ENV=production`. Backend phục vụ luôn `web/dist` (`WEB_DIST_DIR`). Số lần bám, P1, quá hạn, lịch nhắc **tính khi đọc** từ dữ liệu và `now`, không lưu số đếm; mọi hàm nghiệp vụ nhận `now` làm tham số.

## Stack
- Node.js 26 LTS, TypeScript, Fastify 5 (pino), Vitest
- PostgreSQL 18 (docker-compose cho dev), Drizzle ORM, hàng đợi pg-boss (trên Postgres)
- Giao diện demo `web/`: React 19 + Vite, TanStack Query, Tailwind v4 (không Router, không shadcn: chuyển màn bằng state; xem `doc/PLAN-demo-mvp.md`)

## Quy tắc kỹ thuật bắt buộc
- `POST /webhook` phải trả 200 trong 5 giây: chỉ lưu và đưa vào hàng đợi, xử lý nặng làm ở worker.
- Giữ raw body để kiểm tra `X-Hub-Signature-256` (HMAC-SHA256 với `APP_SECRET`, so sánh timing-safe). Sai chữ ký trả 403.
- Khử trùng theo `message.mid` (idempotent); sắp xếp theo `timestamp`.
- **Lưu cả tin do Page gửi (echo), không bỏ qua `is_echo`** (đổi theo báo cáo nghiên cứu, xem `doc/PLAN-sua-module1-theo-bao-cao.md`): Messenger gửi echo qua field riêng `message_echoes`, nên tin nhân viên gõ ở Page Inbox sẽ vô hình nếu bỏ qua, làm hỏng logic "bao lâu khách chưa được trả lời". Tin lưu kèm `direction` (inbound/outbound), `sender_kind` (customer, page_app, page_inbox, page_other, page_unknown) và `app_id`. Khách của một echo là người NHẬN.
- `conversations.last_user_interaction_at` chỉ tính hành động của KHÁCH (tin, postback, reaction, referral); tin của Page không làm mới nó. Không hard-code cửa sổ nhắn tin 24 giờ ở Module 1: quy tắc cửa sổ do module gửi tin quyết định.
- Khóa ổn định để tham chiếu một tin (ví dụ `message_id` trong prompt AI) là `messages.id` (UUID), không phải `mid`.
- Không bỏ tin im lặng: Meta đã nhận 200 thì không gửi lại. Tin chưa lưu được phải retry rồi vào dead-letter, không được `return` lặng lẽ.
- Không ghi query string của request vào log (chứa `hub.verify_token`, `code`/`state` OAuth); `buildApp` đã bỏ query khỏi log.
- Không gửi tin nhắn cho khách (module này chỉ đọc).
- Page token mã hóa khi lưu (AES-256-GCM); không log token; không log nội dung tin nhắn ở mức info.
- Không hard-code secret; mọi cấu hình qua `.env` (mẫu: `.env.example`).
- AI (Module 2): chỉ tạo **đề xuất** (`proposals`); dữ liệu đã duyệt mới vào `profile_fields`. Mỗi trường kèm `evidence` là chuỗi con đã kiểm chứng trong tin khách đã lưu, không lưu chuỗi do mô hình viết. Không bao giờ giải biểu thức thời gian mơ hồ thành ngày.
- `AI_MODE=offline` (mặc định, luật tất định, không gọi mạng) hoặc `live` (Claude). `live` phải đặt tường minh, không tự bật khi có `ANTHROPIC_API_KEY`. SĐT trích bằng code, không qua mô hình. Duyệt mốc thời gian có cờ `needs_clarification` bắt buộc Sale chọn `chosenAt`; không có đường nào tự điền ngày.
- AI bật theo từng tenant (`tenants.ai_extraction_enabled`, mặc định tắt); chỉ bật cho khách thật sau khi kiểm tra pháp lý về chuyển dữ liệu ra nước ngoài (Luật 91/2025/QH15, chưa được luật sư xác nhận).
- Không log nội dung tin, câu gốc hay giá trị AI trích (kể cả mức debug), cũng không log `ANTHROPIC_API_KEY`. Chỉ log số đếm, id và token usage.
- Chi tiết Meta API nào chưa chắc thì đối chiếu tài liệu chính thức, không đoán. Ghi điểm chưa xác minh vào mục cuối `PROGRESS.md`.

## Skill (chỉ dùng những skill đã cài, nằm ở `.claude/skills/`)
- `nodejs-backend-patterns`: chỉ phần Fastify, bỏ Express.
- `vercel-react-best-practices`: chỉ khi làm UI; bỏ nhóm Server Components (dự án là SPA Vite, không phải Next.js).
- `code-review`: chạy sau mỗi mốc lớn, trước khi commit.

## Lệnh chạy
**Cấu trúc thư mục:** `backend/` (Fastify: `src/`, `tests/`, `drizzle/`, `scripts/`, `.env`) và `web/` (Vite, giao diện demo) là hai package độc lập; `doc/`, `docker/`, `docker-compose.yml`, `.claude/` và các file `.md` điều hành ở gốc. Các lệnh `npm` dưới đây (trừ khi ghi khác) chạy trong `backend/`; từ gốc có sẵn `npm run dev:api | dev:web | test:api | test:web | typecheck`. Đường dẫn `src/...` trong tài liệu cũ hiểu là `backend/src/...`.

- `docker compose up -d` (chạy ở gốc): bật Postgres 18 dev (DB `salesmind` và `salesmind_test`), cổng **5433** (tránh đụng PostgreSQL cài sẵn trên máy, thường chiếm 5432)
- `npm run dev`: chạy server, đọc `backend/.env` (sao chép từ `backend/.env.example`)
- `npm test`: chạy Vitest
- `npm run typecheck`: kiểm tra kiểu TypeScript
- `npm run build` / `npm start`: build và chạy bản production; `npm run db:migrate:prod`: migrate bằng bản build
- `npm run db:generate`: sinh migration từ `src/db/schema.ts` (không cần kết nối DB)
- `npm run db:migrate`: áp migration lên `DATABASE_URL` (đọc `.env`)
- Giao diện (chạy trong `web/`): `npm run dev` (cổng 5173, proxy `/api` → 127.0.0.1:3000), `npm test`, `npm run typecheck`, `npm run build`. Cần backend chạy với `DEMO_MODE=true`.
- `npm run cli -- tenant:create "<tên>"`: tạo tenant và in liên kết kết nối Page (một lần, 10 phút); xem `tenant:connect-url`, `tenant:list`
- `npm run cli -- backfill [<fbPageId>]` xếp việc lấy lại tin cũ (server xử lý); `backfill:status` xem tiến độ
- `npm run cli -- queue:status` xem hàng đợi; `queue:redrive <webhook|backfill> [--dry-run]` chạy lại job trong dead-letter
- `README.md`: cài đặt, cấu hình, vận hành
- Kiểm tra với Page thật: `doc/KET-NOI-PAGE.md`

Test DB chạy trên `salesmind_test` (tên phải kết thúc bằng `_test`, test xóa sạch schema đó mỗi lần chạy) nên cần Postgres đang chạy.

Khi một lệnh được tạo thật, bỏ chữ "dự kiến" ở đây. Cần Node 26 (`.nvmrc`).

## Quy trình làm việc theo mốc
Module 1 chia thành các mốc 0–6:
0. Môi trường · 1. Kế hoạch · 2. DB và mã hóa token · 3. Webhook, chữ ký, khử trùng · 4. Kết nối Page thật · 5. Backfill tin cũ · 6. Quan sát, README, review

Module 2 chia thành các mốc 0–7 (chi tiết: `doc/PLAN-module2.md`):
0. Tiền đề (thay đổi echo của Module 1 đã commit) · 1. Kế hoạch · 2. DB · 3. Công cụ tất định (kiểm chứng câu gốc, SĐT, biểu thức thời gian) · 4. Extractor và đánh giá · 5. Pipeline · 6. Service duyệt và CLI · 7. Quan sát, README, review

Sau **mỗi** mốc, theo đúng thứ tự:
1. Chạy test (và `code-review` với mốc lớn).
2. Cập nhật `PROGRESS.md`: trạng thái, ngày, bằng chứng.
3. Tạo **một** commit cho mốc đó.
4. **DỪNG** và báo cáo ngắn: đã làm gì, test đạt, điều chưa chắc chắn.
5. Chờ người dùng nói "tiếp". **Không tự chuyển mốc.**

Chưa có bằng chứng (test, kết quả chạy) thì không ghi "xong".

## Git
- Repo của dự án nằm ở thư mục này (`git init` riêng). Gốc `D:/it/Project` là repo khác chứa nhiều dự án, không commit vào đó.
- Chỉ commit khi hết một mốc. Không commit `.env`, token, hay dữ liệu thật của khách.

## Theo dõi tiến độ
`PROGRESS.md` là nguồn sự thật về trạng thái mốc. Đọc nó đầu mỗi phiên để biết đang ở mốc nào.
