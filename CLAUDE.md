# CLAUDE.md — SalesMind AI

## Tổng quan
Nền tảng AI hỗ trợ đội Sale (doanh nghiệp VN, đội 5–30 người). Luồng: tin nhắn khách vào Facebook Page → AI trích nhu cầu/ngân sách/mốc thời gian → đề xuất công việc → nhân viên xác nhận → hệ thống nhắc hạn, báo cáo cho quản lý.

Nguyên tắc sản phẩm:
- AI đề xuất, con người quyết định.
- Mọi thông tin AI trích phải kèm câu gốc làm căn cứ.
- Mốc thời gian mơ hồ thì hỏi lại, không tự suy ra ngày.

**Giai đoạn hiện tại: Module 1 "Tiếp nhận tin nhắn từ Facebook Page"**: chỉ đọc và lưu tin. Chưa có AI, chưa có giao diện. Đề án gốc: `doc/` (không chép lại ở đây).

## Stack
- Node.js 26 LTS, TypeScript, Fastify 5 (pino), Vitest
- PostgreSQL 18 (docker-compose cho dev), Drizzle ORM, hàng đợi pg-boss (trên Postgres)
- Giao diện (giai đoạn sau): React 19 + Vite, TanStack Router/Query, shadcn/ui + Tailwind v4

## Quy tắc kỹ thuật bắt buộc
- `POST /webhook` phải trả 200 trong 5 giây: chỉ lưu và đưa vào hàng đợi, xử lý nặng làm ở worker.
- Giữ raw body để kiểm tra `X-Hub-Signature-256` (HMAC-SHA256 với `APP_SECRET`, so sánh timing-safe). Sai chữ ký trả 403.
- Khử trùng theo `message.mid` (idempotent); sắp xếp theo `timestamp`; bỏ qua `is_echo`.
- Không gửi tin nhắn cho khách (module này chỉ đọc).
- Page token mã hóa khi lưu (AES-256-GCM); không log token; không log nội dung tin nhắn ở mức info.
- Không hard-code secret; mọi cấu hình qua `.env` (mẫu: `.env.example`).
- Chi tiết Meta API nào chưa chắc thì đối chiếu tài liệu chính thức, không đoán. Ghi điểm chưa xác minh vào mục cuối `PROGRESS.md`.

## Skill (chỉ dùng những skill đã cài, nằm ở `.claude/skills/`)
- `nodejs-backend-patterns`: chỉ phần Fastify, bỏ Express.
- `vercel-react-best-practices`: chỉ khi làm UI; bỏ nhóm Server Components (dự án là SPA Vite, không phải Next.js).
- `code-review`: chạy sau mỗi mốc lớn, trước khi commit.

## Lệnh chạy
- `docker compose up -d`: bật Postgres 18 dev (DB `salesmind` và `salesmind_test`), cổng **5433** (tránh đụng PostgreSQL cài sẵn trên máy, thường chiếm 5432)
- `npm run dev`: chạy server, đọc `.env` (sao chép từ `.env.example`)
- `npm test`: chạy Vitest
- `npm run typecheck`: kiểm tra kiểu TypeScript
- `npm run build` / `npm start`: build và chạy bản production
- `npm run db:generate`: sinh migration từ `src/db/schema.ts` (không cần kết nối DB)
- `npm run db:migrate`: áp migration lên `DATABASE_URL` (đọc `.env`)

Test DB chạy trên `salesmind_test` (tên phải kết thúc bằng `_test`, test xóa sạch schema đó mỗi lần chạy) nên cần Postgres đang chạy.

Khi một lệnh được tạo thật, bỏ chữ "dự kiến" ở đây. Cần Node 26 (`.nvmrc`).

## Quy trình làm việc theo mốc
Module 1 chia thành các mốc 0–6:
0. Môi trường · 1. Kế hoạch · 2. DB và mã hóa token · 3. Webhook, chữ ký, khử trùng · 4. Kết nối Page thật · 5. Backfill tin cũ · 6. Quan sát, README, review

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
