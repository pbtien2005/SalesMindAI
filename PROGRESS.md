# PROGRESS — Module 1: Tiếp nhận tin nhắn từ Facebook Page

Cập nhật file này sau mỗi mốc, trước khi commit. Trạng thái: `chưa làm` | `đang làm` | `xong`.
Cột "Bằng chứng" ghi kết quả test, mã commit hoặc liên kết cụ thể; chưa có thì không ghi "xong".

| Mốc | Nội dung | Trạng thái | Ngày | Bằng chứng |
|---|---|---|---|---|
| 0 | Môi trường: Node 24, TypeScript, docker-compose Postgres 18, Vitest, khung Fastify | xong | 2026-11-09 | Node v24.22.2 (MSI đã đối chiếu SHA256). `docker compose up -d`: container healthy, PostgreSQL 18.6, có DB `salesmind` và `salesmind_test`. `npm run typecheck` đạt. `npm test` 5/5 đạt. Chạy thật server, `GET /healthz` trả 200 `{"status":"ok"}`. |
| 1 | Kế hoạch: chia việc, quyết định kỹ thuật, điểm Meta API cần xác minh | đang làm | | |
| 2 | DB (Drizzle) và mã hóa Page token (AES-256-GCM) | chưa làm | | |
| 3 | Webhook, kiểm tra chữ ký, khử trùng theo message.mid | chưa làm | | |
| 4 | Kết nối Page thật | chưa làm | | |
| 5 | Backfill tin cũ | chưa làm | | |
| 6 | Quan sát (log, metric), README, review | chưa làm | | |

## Điểm chưa xác minh (Meta API)
Thêm vào đây mỗi khi gặp chi tiết chưa chắc, kèm liên kết tài liệu đã đối chiếu.

- **Quyền để nhận tin qua webhook** (mới đối chiếu một phần, hoàn tất ở mốc 1):
  - Đã thấy trong tài liệu: subscribe field `messages` cần `pages_messaging` và `pages_manage_metadata`, dùng Page token của người có tác vụ `MODERATE`; `pages_show_list` để lấy danh sách Page. Nguồn: https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks
  - Standard Access chỉ nhận tin từ người có vai trò trong app; nhận tin từ khách thật cần Advanced Access (qua App Review).
  - Chưa xác minh: `pages_read_engagement` và `business_management` có bắt buộc cho module này không; hành vi chính xác ở chế độ Development (tài liệu không nói thẳng, cần thử với tài khoản Tester).
