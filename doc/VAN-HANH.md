# Vận hành và tham chiếu kỹ thuật

Tách từ README để README gọn. Gồm cài đặt chi tiết, cấu hình `.env`, kết nối Page, CLI, endpoint, vận hành, kiểm thử và cấu trúc mã.

## Yêu cầu

- Node.js 26 (xem `.nvmrc`)
- Docker (PostgreSQL 18 cho môi trường dev)
- Meta App và Facebook Page để thử với dữ liệu thật

## Cài đặt và chạy

Repo gồm hai package độc lập: `backend/` (Fastify) và `web/` (Vite, giao diện demo). Mọi lệnh backend chạy trong `backend/`; từ gốc có thể dùng `npm run dev:api`, `test:api`, `typecheck`.

```bash
docker compose up -d          # ở gốc repo: PostgreSQL 18 ở cổng 5433
cd backend
npm install
cp .env.example .env          # rồi điền giá trị, xem bảng bên dưới
npm run db:migrate
npm run dev                   # http://localhost:3000
```

Kiểm tra: `GET http://localhost:3000/healthz` trả `{"status":"ok"}`, `GET /readyz` trả `ready` khi DB và hàng đợi chạy.

Postgres của Docker dùng cổng **5433** (không phải 5432) để khỏi đụng PostgreSQL cài sẵn trên máy.

### Cấu hình (`.env`)

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `FB_APP_ID` | có | App ID của Meta App (Settings > Basic) |
| `APP_SECRET` | có | App Secret. Kiểm tra chữ ký webhook, đổi code lấy token, tính `appsecret_proof`. **Bí mật.** |
| `VERIFY_TOKEN` | có | Chuỗi tự đặt, khai báo lại trong Meta App khi đăng ký webhook |
| `TOKEN_ENC_KEY` | có | Khóa AES-256-GCM, base64 chuẩn của đúng 32 byte. Sinh: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Mất khóa thì không giải mã được token đã lưu.** |
| `PUBLIC_BASE_URL` | có | Địa chỉ công khai HTTPS của server (địa chỉ tunnel khi dev), không có `/` ở cuối |
| `DATABASE_URL` | có | Chuỗi kết nối PostgreSQL |
| `GRAPH_API_VERSION` | có | Phiên bản Graph API, ví dụ `v26.0` |
| `PORT` | không | Mặc định 3000 |
| `PAGE_INBOX_APP_IDS` | không | `app_id` của Page Inbox, cách nhau bằng dấu phẩy. Mặc định chấp nhận cả `263902037430900` và `26390203743090` (tài liệu Meta và thực tế lệch nhau, chưa xác minh) |
| `TRUST_PROXY` | không | `true` khi chạy sau tunnel, proxy hoặc load balancer (để lấy IP thật cho giới hạn tốc độ). Mặc định `false`. |
| `FB_LOGIN_CONFIG_ID` | không | ID cấu hình Facebook Login for Business, nếu app của bạn cần thay cho `scope` |
| `TEST_DATABASE_URL` | không | Database cho test; tên PHẢI kết thúc bằng `_test` |

## Kết nối Page và nhận tin

Meta chỉ gọi được địa chỉ HTTPS công khai, nên khi dev cần tunnel (ngrok hoặc cloudflared). Hướng dẫn từng bước cùng bảng lỗi thường gặp: **[KET-NOI-PAGE.md](KET-NOI-PAGE.md)**. Tóm tắt:

1. Khai báo trong Meta App: Valid OAuth Redirect URI `PUBLIC_BASE_URL/auth/facebook/callback`, Webhook URL `PUBLIC_BASE_URL/webhook` với `VERIFY_TOKEN`, và **Subscribe 7 field ở cấp App**: `messages`, `message_echoes`, `message_reactions`, `messaging_postbacks`, `messaging_referrals`, `standby`, `messaging_policy_enforcement` (thiếu `message_echoes` thì tin nhân viên gõ ở Page Inbox không vào DB).
2. `npm run cli -- tenant:create "Tên doanh nghiệp"` in một liên kết dùng một lần (hết hạn sau 10 phút).
3. Người quản lý Page mở liên kết bằng trình duyệt, đăng nhập Facebook, cấp quyền. Hệ thống lưu Page và đăng ký webhook.

Cần các quyền: `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`. Muốn nhận tin từ **khách thật** (không có vai trò trong app) cần Advanced Access qua App Review của Meta; ở chế độ Development chỉ nhận tin từ admin, developer, tester của app.

## Lệnh CLI

```bash
npm run cli -- <lệnh>
```

| Lệnh | Việc làm |
|---|---|
| `tenant:create <tên>` | Tạo doanh nghiệp và in liên kết kết nối Page |
| `tenant:connect-url <id>` | Liên kết kết nối mới cho tenant đã có |
| `tenant:list` | Liệt kê tenant và số Page |
| `backfill [<fbPageId>] [--force]` | Xếp việc lấy lại tin cũ (server xử lý). Bỏ qua Page đang có backfill chạy dở, trừ khi `--force` |
| `backfill:status` | Tiến độ backfill từng Page và độ sâu hàng đợi |
| `pages:resubscribe [<fbPageId>]` | Đăng ký lại webhook theo danh sách field hiện hành cho Page đã kết nối (cần khi danh sách field đổi) |
| `queue:status` | Độ sâu mọi hàng đợi và cảnh báo; thoát mã 2 nếu có vấn đề |
| `queue:redrive <webhook\|backfill> [--limit N] [--dry-run]` | Đưa job trong dead-letter về hàng đợi gốc |

**Backfill chỉ phục hồi tối đa 20 tin gần nhất mỗi hội thoại** (giới hạn của Meta) và không lấy tin chỉ có ảnh (ảnh vẫn vào qua webhook). Đây không phải khôi phục toàn bộ lịch sử.

## Endpoint

| Endpoint | Việc |
|---|---|
| `GET /healthz` | Liveness: tiến trình còn sống (không phụ thuộc DB) |
| `GET /readyz` | Readiness: DB và hàng đợi sẵn sàng; 503 nếu không (chỉ nêu tên thành phần lỗi) |
| `GET /webhook` | Meta xác minh webhook (`hub.challenge`) |
| `POST /webhook` | Meta gửi tin; sai chữ ký trả 403 |
| `GET /auth/facebook/start` và `/callback` | Luồng Facebook Login, giới hạn 30 yêu cầu mỗi phút mỗi IP |

Mọi phản hồi có header `x-request-id` (cũng có trong log dưới tên `reqId`) để đối chiếu một request với log.

## Vận hành

- **Log:** JSON (pino). Không ghi query string, token, nội dung tin, PSID hay chữ ký. Có thêm redact phòng thủ cho các trường nhạy cảm.
- **Hàng đợi:** server ghi log độ sâu hàng đợi mỗi phút; cảnh báo (mức `warn`) khi dead-letter có job, có job lỗi, hoặc job chờ quá 5 phút (worker có thể đang tắc).
- **Dead-letter** giữ nguyên payload (gồm nội dung tin) **14 ngày** rồi mất. Khi thấy cảnh báo: sửa nguyên nhân (ví dụ kết nối Page còn thiếu), rồi `npm run cli -- queue:redrive webhook`. Dùng `--dry-run` để xem trước.
- **Tắt server** bằng `SIGTERM` hoặc `SIGINT`: ngừng nhận request, chờ job đang chạy xong, đóng kết nối. Đã kiểm tra trên Linux (Node 26): thoát mã 0 sau chưa tới 1 giây.
- **Chạy cả hệ thống bằng Docker:** `Dockerfile` ở gốc (multi-stage: build `web/`, build backend, chạy) tạo một image chứa cả API lẫn giao diện. Sao chép `backend/.env.docker.example` thành `backend/.env.docker` (không commit), điền rồi `docker compose --profile app up -d --build`; mở http://127.0.0.1:3000. Container tự migrate rồi mới chạy server, `NODE_ENV=production` (nên `DEMO_MODE` phải `false`; thư xác minh email chưa gửi được vì chưa có SMTP). Chưa có reverse proxy HTTPS: tạm dùng tunnel. Đã kiểm tra: build, migrate, `/healthz`, đăng ký, đăng nhập, tắt nhẹ nhàng (1 giây, mã 0). Chưa thử trên máy chủ thật.
- **Triển khai công khai (miễn phí):** hai hướng, đều dùng `Dockerfile` gốc. Bản production luôn `DEMO_MODE=false` (route demo và nút vào nhanh không tồn tại), `TRUST_PROXY=true` khi đứng sau proxy, `PUBLIC_BASE_URL` là URL HTTPS công khai (cookie đăng nhập phụ thuộc biến này).
  - Render + Neon (không cần thẻ quốc tế, URL cố định, gói free tự ngủ khi nhàn rỗi): [DEPLOY-RENDER.md](DEPLOY-RENDER.md). Phải chọn **Language: Docker** và để **Root Directory trống**; chọn Node sẽ lỗi `Missing script: "build"`. `DATABASE_URL` trên Render dùng chuỗi Neon **không qua pooler** (pg-boss không chạy đúng qua pooler).
  - VM Oracle Always Free + DuckDNS + Caddy: [DEPLOY-ORACLE.md](DEPLOY-ORACLE.md), dùng `docker-compose.prod.yml` và `deploy/Caddyfile` (Postgres không mở cổng ra ngoài).
  - Chưa chạy thử trên Render hay VM thật. Bản công khai không có dữ liệu mẫu và không nhận tin nếu chưa có Meta App thật; ở chế độ Development của Meta chỉ người có vai trò trong app dùng được. Tài khoản tạo bằng CLI `user:create` (chưa có SMTP nên không tự đăng ký).
- **Chạy trong container:** phải để `node` là PID 1 (`CMD ["node", "dist/server.js"]`, hoặc `exec node ...` trong shell). Nếu bọc bằng `sh -c "... && node ..."` thì `sh` không chuyển `SIGTERM` cho `node` và container không tắt nhẹ nhàng.
- **Migration:** chạy trước khi khởi động bản mới; server không tự chạy migration. Khi dev: `npm run db:migrate`. Trong môi trường production (không có devDependencies): `npm run build` rồi `npm run db:migrate:prod` (cần thư mục `drizzle/` cạnh `dist/`).
- **Bản production:** `npm run build` rồi `npm start` (hoặc `node dist/server.js`). Đặt `NODE_ENV=production`. Đã thử build, khởi động và `/readyz` trên máy dev.

## Kiểm thử

```bash
docker compose up -d      # ở gốc repo; test cần PostgreSQL
cd backend
npm test                  # Vitest: unit, tích hợp với Postgres và pg-boss thật
npm run typecheck
```

Test dùng database `salesmind_test` (tự tạo, và dựng lại schema sạch mỗi lần chạy, nên tên database phải kết thúc bằng `_test`). Test không gọi Meta thật; lời gọi Graph API được thay bằng `fetch` giả.

## Cấu trúc

```
backend/
  src/
    app.ts, server.ts     dựng Fastify, logging, request id; điểm khởi động và tắt nhẹ nhàng
    config/env.ts         đọc và kiểm tra .env (zod)
    webhook/              GET/POST /webhook
    meta/                 chữ ký, parse payload, Graph client, làm sạch dữ liệu
    workers/              xử lý webhook, lưu tin (dùng chung với backfill)
    backfill/             job liệt kê hội thoại và job từng hội thoại
    auth/                 Facebook Login: state dùng một lần, lưu Page, route, tenant
    queue/                pg-boss: hàng đợi, worker, quản trị (redrive), monitor
    db/                   schema Drizzle, client, migrate
    crypto/               AES-256-GCM cho Page token
    cli/                  lệnh quản trị
  drizzle/                migration SQL
  tests/                  Vitest
  scripts/                công cụ đánh giá trích xuất
web/                      giao diện demo (Vite, React)
doc/                      kế hoạch, hướng dẫn kiểm tra với Page thật, đề án gốc
docker/, docker-compose.yml   Postgres dev
docker-compose.prod.yml, deploy/   triển khai VM (Postgres + app + Caddy HTTPS)
```
