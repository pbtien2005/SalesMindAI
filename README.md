# SalesMind AI — Module 1: Tiếp nhận tin nhắn từ Facebook Page

Module này nhận tin nhắn khách gửi vào Facebook Page của doanh nghiệp **và tin Page trả lời khách** (kể cả tin nhân viên gõ ở Page Inbox), kiểm tra tính xác thực, khử trùng và lưu vào PostgreSQL, để các module sau (AI trích nhu cầu, đề xuất việc, nhắc hạn) dùng làm dữ liệu đầu vào. Ghi nhận thêm lần tương tác cuối của khách (tin, reaction, postback, referral) và cảnh báo chính sách của Meta.

**Phạm vi:** chỉ đọc và lưu tin. Không có AI, không có giao diện, **không gửi tin cho khách**.

> **Trạng thái:** mã nguồn và test tự động đã xong. Việc kết nối Page thật và nhận tin từ Meta thật **chưa được kiểm tra** (cần Meta App và Page của bạn). Xem [PROGRESS.md](PROGRESS.md) và [doc/KET-NOI-PAGE.md](doc/KET-NOI-PAGE.md).

## Cách hoạt động

```
Meta ──POST /webhook──▶ kiểm tra chữ ký ──▶ pg-boss (hàng đợi) ──▶ worker ──▶ PostgreSQL
                         (trả 200 ngay)        retry + dead-letter    (khử trùng theo mid)

Quản trị viên ──CLI──▶ liên kết dùng một lần ──▶ Facebook Login ──▶ lưu Page (token mã hóa)
                                                                 └─▶ đăng ký webhook cho Page

CLI backfill ──▶ pg-boss ──▶ worker ──▶ Graph API (Conversations) ──▶ PostgreSQL
```

Nguyên tắc cốt lõi:
- `POST /webhook` chỉ kiểm tra chữ ký (HMAC-SHA256, so sánh timing-safe) rồi ghi vào hàng đợi và trả 200. Xử lý nặng làm ở worker.
- Khử trùng theo `message.mid`: Meta có thể gửi lại cùng một tin nhiều lần (tới 36 giờ nếu ta không trả 200).
- **Lưu cả tin của Page (echo).** Messenger gửi echo qua field riêng `message_echoes`; bỏ qua nó thì câu trả lời của nhân viên vô hình và không tính được "bao lâu khách chưa được trả lời". Mỗi tin có `direction` (inbound hoặc outbound) và, với tin của Page, `sender_kind` suy ra từ `app_id` (`page_app`, `page_inbox`, `page_other`, `page_unknown`).
- `conversations.last_user_interaction_at` chỉ tính hành động của khách (tin, reaction, postback, referral), tách khỏi `last_page_message_at`. Quy tắc cửa sổ nhắn tin 24 giờ không nằm ở module này.
- Không bỏ tin im lặng: tin chưa lưu được thì retry, hết retry thì vào dead-letter để chạy lại sau.
- Page token luôn mã hóa khi lưu (AES-256-GCM). Token và nội dung tin không bao giờ vào log.

## Yêu cầu

- Node.js 26 (xem `.nvmrc`)
- Docker (PostgreSQL 18 cho môi trường dev)
- Meta App và Facebook Page để thử với dữ liệu thật

## Cài đặt và chạy

```bash
npm install
cp .env.example .env          # rồi điền giá trị, xem bảng bên dưới
docker compose up -d          # PostgreSQL 18 ở cổng 5433
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

Meta chỉ gọi được địa chỉ HTTPS công khai, nên khi dev cần tunnel (ngrok hoặc cloudflared). Hướng dẫn từng bước cùng bảng lỗi thường gặp: **[doc/KET-NOI-PAGE.md](doc/KET-NOI-PAGE.md)**. Tóm tắt:

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
- **Chạy trong container:** phải để `node` là PID 1 (`CMD ["node", "dist/server.js"]`, hoặc `exec node ...` trong shell). Nếu bọc bằng `sh -c "... && node ..."` thì `sh` không chuyển `SIGTERM` cho `node` và container không tắt nhẹ nhàng.
- **Migration:** chạy trước khi khởi động bản mới; server không tự chạy migration. Khi dev: `npm run db:migrate`. Trong môi trường production (không có devDependencies): `npm run build` rồi `npm run db:migrate:prod` (cần thư mục `drizzle/` cạnh `dist/`).
- **Bản production:** `npm run build` rồi `npm start` (hoặc `node dist/server.js`). Đặt `NODE_ENV=production`. Đã thử build, khởi động và `/readyz` trên máy dev.

## Kiểm thử

```bash
docker compose up -d      # test cần PostgreSQL
npm test                  # Vitest: unit, tích hợp với Postgres và pg-boss thật
npm run typecheck
```

Test dùng database `salesmind_test` (tự tạo, và dựng lại schema sạch mỗi lần chạy, nên tên database phải kết thúc bằng `_test`). Test không gọi Meta thật; lời gọi Graph API được thay bằng `fetch` giả.

## Cấu trúc

```
src/
  app.ts, server.ts       dựng Fastify, logging, request id; điểm khởi động và tắt nhẹ nhàng
  config/env.ts           đọc và kiểm tra .env (zod)
  webhook/                GET/POST /webhook
  meta/                   chữ ký, parse payload, Graph client, làm sạch dữ liệu
  workers/                xử lý webhook, lưu tin (dùng chung với backfill)
  backfill/               job liệt kê hội thoại và job từng hội thoại
  auth/                   Facebook Login: state dùng một lần, lưu Page, route, tenant
  queue/                  pg-boss: hàng đợi, worker, quản trị (redrive), monitor
  db/                     schema Drizzle, client, migrate
  crypto/                 AES-256-GCM cho Page token
  cli/                    lệnh quản trị
drizzle/                  migration SQL
tests/                    Vitest
doc/                      kế hoạch, hướng dẫn kiểm tra với Page thật, đề án gốc
```

## Giới hạn và rủi ro đã biết

- **Chưa thử với Meta thật.** Đơn vị `timestamp` của webhook (giả định mili giây), cấu trúc payload thật của tin có ảnh, và `id` tin của Conversations API có trùng `mid` của webhook không đều là điểm chưa xác minh. Danh sách đầy đủ trong [PROGRESS.md](PROGRESS.md).
- Dead-letter không có cảnh báo ngoài log. Hết 14 ngày mà chưa xử lý thì tin mất.
- Chưa biết Business Suite và app Pages trên điện thoại có tạo echo không và `app_id` của chúng (chỉ Page Inbox được tài liệu nhắc); xem [doc/KET-NOI-PAGE.md](doc/KET-NOI-PAGE.md) mục C1.
- Chưa có đăng nhập người dùng: luồng kết nối Page được bảo vệ bằng liên kết dùng một lần do quản trị viên tạo qua CLI.
- `npm audit` báo 4 cảnh báo mức vừa của `esbuild` cũ bên trong `drizzle-kit` (chỉ dev, không vào production).

## Tài liệu khác

- [CLAUDE.md](CLAUDE.md): quy tắc kỹ thuật và quy trình làm việc theo mốc
- [PROGRESS.md](PROGRESS.md): trạng thái từng mốc, bằng chứng, điểm Meta API đã và chưa xác minh
- [doc/PLAN-module1.md](doc/PLAN-module1.md): kế hoạch Module 1
- [doc/PLAN-sua-module1-theo-bao-cao.md](doc/PLAN-sua-module1-theo-bao-cao.md): các thay đổi Module 1 theo báo cáo nghiên cứu (echo, tương tác, standby, chính sách)
- [doc/KET-NOI-PAGE.md](doc/KET-NOI-PAGE.md): kiểm tra với Page thật
