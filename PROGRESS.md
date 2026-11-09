# PROGRESS — Module 1: Tiếp nhận tin nhắn từ Facebook Page

Cập nhật file này sau mỗi mốc, trước khi commit. Trạng thái: `chưa làm` | `đang làm` | `xong`.
Cột "Bằng chứng" ghi kết quả test, mã commit hoặc liên kết cụ thể; chưa có thì không ghi "xong".
Kế hoạch chi tiết: [doc/PLAN-module1.md](doc/PLAN-module1.md).

| Mốc | Nội dung | Trạng thái | Ngày | Bằng chứng |
|---|---|---|---|---|
| 0 | Môi trường: Node 26, TypeScript, docker-compose Postgres 18, Vitest, khung Fastify | xong | 2026-11-09 | Node v26.13.0 LTS (MSI đã đối chiếu SHA256; commit mốc 0 làm trên v24.22.2, sau đó chuyển lên 26 theo yêu cầu, typecheck, test, healthz đạt lại). `docker compose up -d`: container healthy, PostgreSQL 18.6, có DB `salesmind` và `salesmind_test`. `npm run typecheck` đạt. `npm test` 5/5 đạt. Chạy thật server, `GET /healthz` trả 200 `{"status":"ok"}`. |
| 1 | Kế hoạch: chia việc, quyết định kỹ thuật, điểm Meta API cần xác minh | xong | 2026-11-09 | Kế hoạch lưu ở `doc/PLAN-module1.md`. Đã đối chiếu 8 điểm Meta API với tài liệu chính thức (bảng dưới): 4 điểm xác minh được, 4 điểm tài liệu không nói rõ và cần thử bằng Page thật ở mốc 4–5. `GRAPH_API_VERSION` mẫu đổi sang v26.0. `npm run typecheck` và `npm test` (5/5) vẫn đạt. |
| 2 | DB (Drizzle) và mã hóa Page token (AES-256-GCM) | xong | 2026-11-09 | `npm run typecheck` sạch; `npm test` 36/36 đạt (token-crypto 16, db 15, env 4, healthz 1) trên Postgres 18.6 của Docker. `db:migrate` chạy được 2 lần liên tiếp (idempotent) và từ thư mục khác. `code-review` (medium) 9 phát hiện: đã sửa 8 (khóa ngoại ghép tenant/page/conversation, handler lỗi pool, đường dẫn migration, bỏ credentials hard-code khỏi `drizzle.config.ts`, `global-setup` tự tạo DB test, kiểm tra khóa base64 chặt, `truncateAll` động, index FK), hoãn 1 sang mốc 3 (`last_message_at` chỉ có đường ghi khi có worker). Đổi cổng Postgres Docker sang 5433 vì PostgreSQL cài sẵn trên máy chiếm 5432. |
| 3 | Webhook, kiểm tra chữ ký, khử trùng theo message.mid | chưa làm | | |
| 4 | Kết nối Page thật | chưa làm | | |
| 5 | Backfill tin cũ | chưa làm | | |
| 6 | Quan sát (log, metric), README, review | chưa làm | | |

## Điểm Meta API (đối chiếu tài liệu chính thức ngày 2026-11-09)

Trạng thái: **đã xác minh** = có trong tài liệu; **chưa xác minh** = tài liệu không nói, phải thử bằng Page thật (ghi rõ mốc làm).

| # | Điểm | Trạng thái | Kết luận và nguồn |
|---|---|---|---|
| 1 | `id` tin trong Conversations API có trùng `message.mid` của webhook không | **chưa xác minh** (mốc 5) | Tài liệu không nói. Kế hoạch: thử bằng Page thật đầu mốc 5; nếu không trùng thì dùng khóa phụ (page, PSID, `sent_at`, băm nội dung) cho tin backfill. [Conversations API](https://developers.facebook.com/docs/messenger-platform/conversations/) |
| 2 | Quyền cần để nhận tin và đăng ký webhook | **đã xác minh một phần** | Subscribe field `messages` cần `pages_messaging` và `pages_manage_metadata`, Page token của người có tác vụ `MODERATE`. `pages_show_list` để lấy danh sách Page. Backfill cần thêm `pages_read_engagement`. Standard Access chỉ nhận tin từ người có vai trò trong app; nhận tin khách thật cần Advanced Access (App Review). Chưa xác minh: `business_management` có bắt buộc không; hành vi chính xác ở chế độ Development (thử bằng tài khoản Tester ở mốc 4). [Webhooks](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks), [Overview](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview) |
| 3 | Page token có hết hạn không | **đã xác minh** | Đổi user token ngắn hạn sang dài hạn (khoảng 60 ngày) qua `oauth/access_token` với `grant_type=fb_exchange_token`, gọi từ server. Page token lấy từ token dài hạn "không có ngày hết hạn", chỉ hết hiệu lực trong một số điều kiện (nên xử lý `token_invalid`). Lấy Page qua `{user-id}/accounts`. [Long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/) |
| 4 | Giới hạn Conversations API | **đã xác minh một phần** | Chi tiết tin chỉ có cho 20 tin gần nhất mỗi hội thoại; hội thoại ở thư mục Requests không hoạt động 30 ngày không được trả về; danh sách tin chỉ trả `id`, `created_time`, chi tiết lấy qua `/{message-id}`. Chưa xác minh: phân trang, giới hạn tốc độ, và việc mở rộng `messages{...}` trong một lời gọi (kiểm tra mốc 5). |
| 5 | Phiên bản Graph API | **đã xác minh** | v26.0 ra mắt 29/07/2026 (hết hạn chưa xác định); v25.0 hết hạn 29/07/2028; v23.0 hết hạn 08/10/2027. Changelog nhắc tới v27.0 là mới nhất nhưng không nêu ngày. Dùng `v26.0`. [Changelog](https://developers.facebook.com/docs/graph-api/changelog/) |
| 6 | Payload tin có attachment, hạn URL attachment | **đã xác minh một phần** | Cấu trúc: `attachments[].type` (`image`, `audio`, `video`, `file`, `sticker`, `reel`...) và `payload.url`. Hạn của URL không có trong tài liệu: chỉ lưu metadata, không coi URL là vĩnh viễn. Sau 30/08/2026 sticker chỉ gửi type `sticker`. [Messages event](https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages) |
| 7 | Meta thử lại webhook thế nào | **đã xác minh** | Không nhận 200 thì thử lại ngay, rồi giảm dần tần suất trong 36 giờ, sau đó bỏ. Gộp tối đa 1000 sự kiện mỗi request (không đảm bảo gộp). Chữ ký `X-Hub-Signature-256` có tiền tố `sha256=`, tính trên payload bằng App Secret. GET xác minh gồm `hub.mode`, `hub.challenge`, `hub.verify_token`. Tài liệu không nêu thời gian chờ; 5 giây là yêu cầu của dự án. [Webhooks getting started](https://developers.facebook.com/docs/graph-api/webhooks/getting-started) |
| 8 | Echo và tin do Page gửi | **đã xác minh** | `message.is_echo` là boolean; trong echo, `sender.id` là Page, `recipient.id` là PSID. Echo đến qua field `message_echoes`; tài liệu không nói field `messages` có kèm echo không. Quyết định: chỉ subscribe `messages`, vẫn bỏ `is_echo`; có cần lưu tin Page gửi để AI có ngữ cảnh hay không sẽ quyết khi làm AI. [Message echoes](https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/message-echoes) |

Điểm bổ sung (chưa xác minh, từ tài liệu):
- Đơn vị của `timestamp` trong webhook không được ghi; ví dụ có 13 chữ số nên giả định mili giây, xác minh bằng webhook thật ở mốc 4.
- Tin có thể nằm trong mảng `standby` thay vì `messaging` nếu Page dùng Handover Protocol; giả định Page không dùng.
