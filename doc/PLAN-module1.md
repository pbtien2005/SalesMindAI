# Kế hoạch Module 1: Tiếp nhận tin nhắn từ Facebook Page

Phiên bản sau khi đối chiếu tài liệu Meta ở mốc 1 (2026-11-09). Trạng thái từng mốc xem `PROGRESS.md`; danh sách điểm Meta API đã xác minh hoặc chưa xác minh cũng nằm ở đó.

## Mục tiêu
Nhận webhook của Meta, kiểm tra chữ ký, khử trùng, lưu vào Postgres; kết nối Page thật qua OAuth; backfill tin cũ. Chưa có AI, chưa có giao diện, không gửi tin cho khách.

Quyết định đã chốt: OAuth Facebook Login ở mốc 4; schema có `tenant_id` ngay; đã có Meta App (Development) và Page thử nghiệm; repo git riêng trong thư mục này; Node 26 LTS.

## Cấu trúc thư mục
```
src/
  config/env.ts            # đọc và kiểm tra .env bằng zod (đã có)
  db/{schema.ts,client.ts} # Drizzle
  crypto/token-crypto.ts   # AES-256-GCM
  meta/{signature.ts,graph-client.ts,parse-webhook.ts}
  webhook/routes.ts        # GET/POST /webhook
  queue/{boss.ts,jobs.ts}  # pg-boss
  workers/{process-webhook.ts,backfill-conversation.ts}
  auth/oauth-routes.ts     # mốc 4
  cli/                     # tenant:create, backfill
  app.ts, server.ts        # buildApp() để test bằng inject()
tests/                     # Vitest
drizzle/                   # migration sinh ra
```
Cấu trúc theo skill `nodejs-backend-patterns` (phần Fastify): validate đầu vào bằng zod, lỗi có lớp riêng, log có cấu trúc (pino), connection pool, health check, tắt server nhẹ nhàng (đóng pool và pg-boss khi nhận SIGTERM).

## Mô hình dữ liệu (mốc 2)
- `tenants(id, name, created_at)`
- `pages(id, tenant_id, fb_page_id UNIQUE, name, token_enc, status, subscribed_at, backfill_state, created_at)`; `status`: `active` | `token_invalid`
- `conversations(id, tenant_id, page_id, psid, last_message_at)`, UNIQUE(page_id, psid)
- `messages(id, tenant_id, page_id, conversation_id, mid UNIQUE, text, attachments jsonb, sent_at timestamptz, received_at, source 'webhook'|'backfill')`
- `oauth_states(state, tenant_id, expires_at, used_at)` (mốc 4)

Khử trùng bằng `INSERT ... ON CONFLICT (mid) DO NOTHING`. Sắp xếp theo `sent_at`. Chỉ lưu tin của khách; tin của Page (`is_echo`) bỏ qua.

Mã hóa token: AES-256-GCM, IV ngẫu nhiên 12 byte mỗi lần, chuỗi lưu `v1:iv:tag:ciphertext` (base64), AAD = `fb_page_id`, khóa từ `TOKEN_ENC_KEY` (base64, đúng 32 byte, kiểm tra lúc khởi động). Tiền tố `v1` để xoay khóa sau này.

## Các mốc

### Mốc 0: Môi trường (xong)
Node 26, TypeScript, Fastify, Vitest, docker-compose Postgres 18, `GET /healthz`.

### Mốc 1: Kế hoạch (tài liệu này)
Lưu kế hoạch, đối chiếu tài liệu Meta, điền "Điểm chưa xác minh" trong `PROGRESS.md`, đổi `GRAPH_API_VERSION` mẫu sang `v26.0`.

### Mốc 2: DB và mã hóa token
Schema Drizzle, migration, `token-crypto.ts`, client Postgres (pool).
Test: mã hóa rồi giải mã khớp; sửa 1 byte ciphertext hoặc tag thì lỗi; sai khóa thì lỗi; sai AAD thì lỗi; hai lần mã hóa cùng token cho IV khác nhau; khóa sai độ dài thì app không khởi động (đã có trong `env.ts`); unique `mid` chặn bản trùng.

### Mốc 3: Webhook, chữ ký, khử trùng
- `GET /webhook`: kiểm tra `hub.mode=subscribe` và `hub.verify_token` (timing-safe), trả `hub.challenge` dạng text.
- `POST /webhook`: parser JSON riêng cho route giữ `Buffer` thô; HMAC-SHA256 bằng `APP_SECRET`; header `X-Hub-Signature-256` có tiền tố `sha256=`; so bằng `timingSafeEqual` (kiểm tra độ dài trước); sai hoặc thiếu chữ ký trả 403; đúng thì đưa nguyên payload vào pg-boss rồi trả 200, không xử lý nặng trong request.
- Worker: payload có dạng `object` / `entry[]` / `messaging[]`. Meta gộp tối đa 1000 sự kiện mỗi request và nói không đảm bảo gộp, nên worker xử lý từng sự kiện độc lập. Bỏ `message.is_echo` và sự kiện không phải tin nhắn; sắp theo `timestamp`; upsert conversation theo `sender.id` (PSID); insert message `ON CONFLICT DO NOTHING`. Job lỗi thì retry có backoff, quá số lần thì vào dead-letter.
- Làm sạch NUL (`\u0000`) khỏi payload ở route trước khi vào hàng đợi (pg-boss lưu jsonb, không nhận NUL). Worker lưu bằng truy vấn hàng loạt trong một transaction. Tin gửi tới Page chưa có trong DB thì lưu phần của Page đã biết rồi ném lỗi để retry, hết retry vào dead-letter (không bỏ im lặng). Log request bỏ query string.
- `timestamp` giả định là mili giây (ví dụ trong tài liệu có 13 chữ số, tài liệu không nói rõ đơn vị). Đổi bằng `new Date(ms)`; xác minh bằng webhook thật ở mốc 4.
- Chỉ subscribe field `messages`, không subscribe `message_echoes`. Vẫn giữ lớp kiểm tra `is_echo` và `sender.id == page id` để phòng thủ.
Test (dùng `app.inject()`): chữ ký đúng 200, sai 403, thiếu 403, payload bị sửa 403; payload có tiếng Việt và khoảng trắng vẫn khớp HMAC; cùng `mid` hai lần chỉ còn 1 dòng; `is_echo` không lưu; batch nhiều sự kiện; tin đến sai thứ tự vẫn sắp đúng; handler trả lời nhanh dù worker chậm; log không chứa nội dung tin ở mức info.

### Mốc 4: Kết nối Page thật (OAuth)
1. CLI `tenant:create <tên>` tạo tenant và một dòng `oauth_states` dùng một lần (hết hạn sau khoảng 10 phút), in URL `/auth/facebook/start?state=...`. Không có state hợp lệ thì endpoint từ chối.
2. `/auth/facebook/start` chuyển hướng sang hộp thoại Facebook Login. Quyền xin: `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`.
3. `/auth/facebook/callback`: kiểm tra state (đúng, chưa dùng, chưa hết hạn), đổi `code` lấy user token, đổi sang token dài hạn (`oauth/access_token`, `grant_type=fb_exchange_token`, gọi từ server vì có app secret), gọi `{user-id}/accounts` lấy Page và Page token, mã hóa rồi lưu, gọi `subscribed_apps` đăng ký field `messages`. Trả trang HTML tối giản "Đã kết nối N Page".
4. Tunnel (ngrok hoặc cloudflared) để Meta gọi webhook; khai báo URL và `VERIFY_TOKEN` trong Meta App.
5. Graph client: gặp lỗi token không hợp lệ (ví dụ mã lỗi OAuthException 190, cần đối chiếu mã chính xác) thì đặt `pages.status = token_invalid` và dừng gọi tiếp, không thử lại vô hạn.
Biến môi trường thêm vào `.env.example`: `FB_APP_ID`, `PUBLIC_BASE_URL` (redirect URI luôn là `PUBLIC_BASE_URL/auth/facebook/callback`, nên bỏ `OAUTH_REDIRECT_URI` để khỏi cấu hình lệch), và tùy chọn `FB_LOGIN_CONFIG_ID` (Facebook Login for Business). State còn được gắn với trình duyệt bằng cookie (nonce); chi tiết trong PROGRESS.md.
Test: state sai, đã dùng, hết hạn đều bị từ chối; token lưu dạng mã hóa, không xuất hiện trong log; Graph client dùng mock (không gọi Meta thật trong test).
Kiểm tra tay: nhắn từ tài khoản Tester vào Page thử nghiệm, dòng mới xuất hiện trong `messages`.

### Mốc 5: Backfill tin cũ
Giới hạn thực tế theo tài liệu: chi tiết tin nhắn chỉ lấy được cho **20 tin gần nhất** mỗi cuộc hội thoại (tin cũ hơn trả lỗi "đã xóa"); hội thoại trong thư mục Requests không hoạt động 30 ngày không được trả về. Nên backfill chỉ phục hồi tối đa 20 tin gần nhất mỗi cuộc hội thoại.
- Duyệt `GET /{page-id}/conversations?platform=messenger`, rồi `GET /{conversation-id}?fields=messages` (chỉ trả `id`, `created_time`), rồi `GET /{message-id}?fields=id,created_time,from,to,message` cho từng tin. Phân trang: tài liệu không nói, xử lý `paging.next` nếu có và kiểm tra bằng Page thật.
- Mỗi conversation là một job pg-boss; backoff khi chạm giới hạn tốc độ (tài liệu không nêu hạn mức, phải đọc mã lỗi và header khi gặp); lưu con trỏ vào `pages.backfill_state` để chạy lại được; bỏ tin có `from.id` là chính Page.
- **Dự phòng khử trùng:** tài liệu không nói `id` của Conversations API có trùng `message.mid` của webhook không. Mốc 5 bắt đầu bằng một thử nghiệm với Page thật: so một tin có cả webhook và Conversations API. Nếu trùng, khử trùng theo `mid` như thường. Nếu không trùng, dùng khóa phụ (page, PSID, `sent_at`, băm nội dung) cho tin `source=backfill`, và ghi rõ giới hạn này.
Test: phân trang nhiều trang, chạy lại không tạo bản trùng, lỗi giữa chừng thì tiếp tục từ con trỏ, tin backfill và tin webhook trùng nhau không thành hai dòng.

### Mốc 6: Quan sát, README, review
pino `redact` (token, header chữ ký, nội dung tin), request id, `GET /readyz` (kiểm tra DB), log độ sâu hàng đợi và số job lỗi, README (cài đặt, `.env`, tunnel, đăng ký webhook, chạy test), chạy `code-review` cho toàn module và sửa lỗi thật.

## Rủi ro và lưu ý
- Meta thử lại webhook "ngay lập tức, rồi giảm dần tần suất trong 36 giờ" nếu không nhận 200, rồi bỏ. Vì vậy khử trùng theo `mid` là bắt buộc, và `POST /webhook` chỉ ghi queue.
- Tài liệu không nêu thời gian chờ webhook; con số 5 giây là yêu cầu của dự án, giữ nguyên.
- Raw body phải lấy trước khi Fastify parse JSON; test bằng payload tiếng Việt để chắc HMAC khớp byte.
- Page token từ user token dài hạn không có ngày hết hạn nhưng vẫn có thể bị vô hiệu (đổi mật khẩu, thu hồi quyền); cần xử lý `token_invalid`.
- Nếu Page dùng Handover Protocol / Conversation Routing, tin có thể nằm trong mảng `standby` thay vì `messaging` (tài liệu không giải thích rõ). Module này giả định Page không dùng; nếu gặp thì ghi lại.
- Không gọi Meta thật trong test tự động; chỉ kiểm tra tay ở mốc 4 và 5.

## Kiểm tra cuối module
`npm run typecheck`, `npm test` đạt; `docker compose up -d`, chạy server qua tunnel; nhắn từ tài khoản Tester vào Page thì có dòng trong `messages`; gửi lại cùng payload không thêm dòng; gửi sai chữ ký bằng curl thì 403; chạy backfill thì tin cũ vào DB, chạy lần hai không thêm; log không có token hay nội dung tin ở mức info.
