# Kế hoạch sửa Module 1 theo báo cáo "Công nghệ luồng nghiệp vụ SalesMind"

Nguồn: [reports/Công nghệ luồng nghiệp vụ SalesMind.md](../reports/Công%20nghệ%20luồng%20nghiệp%20vụ%20SalesMind.md) (báo cáo tổng hợp) và 4 ghi chú gốc trong `research_notes/` (AI trích xuất, xác minh cọc, nhắn tin Meta/Zalo, engine nhắc lịch). Ngày 2026-11-09.

## Phạm vi: cái gì thuộc Module 1, cái gì không

Module 1 là tầng **tiếp nhận và lưu** tin nhắn từ Facebook Page, thuần đọc. Báo cáo có bốn mảng; chỉ một phần của mảng 3 (nhắn tin Meta) rơi vào Module 1. Còn lại là module sau và **không làm ở đây**:

| Mảng | Thuộc Module 1? | Phần Module 1 phải chuẩn bị |
|---|---|---|
| 1. AI trích xuất (quote + xác minh) | Không | `messages` cần khóa ổn định làm `message_id` trong prompt, và lưu nguyên văn tin (đã đúng) |
| 2. Xác minh cọc (SePay/Casso, bill) | Không | Không có. Dùng lại khuôn webhook (raw body, timing-safe, ghi rồi enqueue) khi làm |
| **3. Nhắn tin Meta** | **Có** | **Toàn bộ mục dưới đây** |
| 4. Engine nhắc lịch, máy trạng thái | Không | Cần dữ liệu đầu vào chính xác: lần tương tác cuối của khách, lần Page trả lời cuối |

## Phát hiện của báo cáo và thay đổi tương ứng

Điểm gốc của báo cáo: "đăng ký `message_echoes` và lưu `app_id`, là điều kiện để mọi logic bao lâu khách chưa được trả lời và đếm số lần bám đúng".

| # | Phát hiện (nguồn trong báo cáo) | Hiện trạng Module 1 | Thay đổi |
|---|---|---|---|
| A | Echo Messenger đến qua field `message_echoes`, không qua `messages`; tin gõ ở Page Inbox có `app_id` riêng (Mảng 3, "`message_echoes` là phát hiện quan trọng nhất") | Chỉ đăng ký `messages`, **bỏ** `is_echo` | Đăng ký `message_echoes`. Lưu tin của Page với `direction = outbound`, `app_id`, `sender_kind`. Khử trùng theo `mid` như cũ |
| B | Cần `last_user_interaction_at` từ `messages`, `messaging_postbacks`, `message_reactions`, `messaging_referrals` (Mảng 3, "Cửa sổ chuẩn") | Không có; chỉ `last_message_at` | Đăng ký 3 field còn lại. Thêm `conversations.last_user_interaction_at` (chỉ hành động của khách) và `last_page_message_at` |
| C | Nếu app khác giữ thread, chỉ thấy sự kiện qua `standby` | Bỏ qua mảng `standby` | Đăng ký `standby`, xử lý như `messaging[]` |
| D | Nên đăng ký `messaging_policy_enforcement` (warning/block/unblock) | Không | Đăng ký, lưu vào `page_policy_events`, log mức `warn` |
| E | `messages` cần khóa ổn định làm `message_id` trong prompt (Mảng 1, "Hệ quả cho codebase") | Có `id` (UUID v7) và `mid` | **Chọn `messages.id` (UUID)**: do ta tạo, ổn định, không phụ thuộc dạng chuỗi `mid` của Meta (webhook và Graph có thể khác dạng) |
| F | Câu hỏi 1 cho chủ sản phẩm: có cập nhật quy tắc "bỏ qua `is_echo`" không | CLAUDE.md ghi "bỏ qua is_echo" | **Cập nhật**: lưu tin của Page như dữ liệu đọc. Module 1 vẫn không gửi tin cho khách |
| G | Page đã kết nối trước khi đổi danh sách field vẫn chỉ đăng ký `messages` | Không có cách đăng ký lại | Lệnh CLI `pages:resubscribe` |
| H | Backfill nên thấy cả câu trả lời của nhân viên (cùng lý do với A) | Bỏ tin do Page gửi | Backfill lưu cả tin của Page (cần `to` để biết khách) |

### Đã xác minh với tài liệu Meta (2026-11-09)
- Cả 7 tên field `messages`, `message_echoes`, `message_reactions`, `messaging_postbacks`, `messaging_referrals`, `standby`, `messaging_policy_enforcement` đều có trong enum `subscribed_fields` của `POST /{page-id}/subscribed_apps`.
- Payload `message_reactions`: `sender`, `recipient`, `timestamp`, `reaction: { reaction, emoji, action: react|unreact, mid }`. Chỉ `react` mới là hành động của khách.
- Payload `messaging_policy_enforcement`: khóa là **`policy_enforcement`** (không phải tên field) với `action` (`warning`, `block`, `unblock`) và `reason` (vắng khi `unblock`), cùng cấp với `recipient` (là ID Page) và `timestamp`. Không có `sender`.
- Echo: `sender.id` là Page, `recipient.id` là PSID khách, kèm `message.app_id`.

### Chưa xác minh (cần Page thật, đã nêu trong báo cáo)
- `app_id` của Page Inbox: tài liệu ghi `26390203743090` (14 chữ số), giá trị thường dùng là `263902037430900` (15 chữ số). Mặc định chấp nhận cả hai, cấu hình được bằng `PAGE_INBOX_APP_IDS`.
- Business Suite và app Pages trên điện thoại có tạo echo không, và `app_id` là gì.
- Cấu trúc payload của `messaging_postbacks` và `messaging_referrals` (không lấy được từ tài liệu). Mã chỉ kiểm tra **có khóa `postback` hoặc `referral`** và người gửi là khách, không phụ thuộc cấu trúc bên trong.
- `messages` có kèm echo hay không: tài liệu nói echo Messenger đến qua `message_echoes`. Mã xử lý cả hai đường như nhau (cùng `mid` thì khử trùng).

## Các bước thực hiện

1. **Schema (migration 0002):** `messages.direction`, `messages.sender_kind`, `messages.app_id`; `conversations.last_user_interaction_at`, `conversations.last_page_message_at` (điền cho dữ liệu cũ); bảng `page_policy_events`.
2. **Phân loại người gửi:** `customer`, `page_app` (app của ta), `page_inbox` (người gõ tay), `page_other` (bot hoặc app khác), `page_unknown` (không có `app_id`, ví dụ từ backfill).
3. **Parse webhook:** thêm echo (thành tin outbound), `standby`, reaction, postback, referral, `policy_enforcement`. Một sự kiện hỏng không làm mất sự kiện khác (giữ nguyên nguyên tắc cũ).
4. **Lưu:** gộp tin và tương tác vào cùng một câu upsert hội thoại; `last_user_interaction_at` và `last_page_message_at` dùng `GREATEST` nên tin đến sai thứ tự không làm lùi.
5. **Đăng ký field:** mở rộng `SUBSCRIBED_FIELDS`; CLI `pages:resubscribe`.
6. **Backfill:** lưu cả tin của Page; lấy thêm `to`.
7. **Tài liệu:** CLAUDE.md (đổi quy tắc), README, PROGRESS.md, `doc/KET-NOI-PAGE.md` (các thử nghiệm thật mà báo cáo yêu cầu).
8. **Kiểm thử:** cập nhật test cũ theo hành vi mới, thêm test cho từng thay đổi, mutation cho các điểm quan trọng, smoke test với server thật.

## Không làm (và lý do)

- Gửi tin cho khách, kiểm tra cửa sổ 24 giờ, message tag, Zalo: thuộc module sau; báo cáo cũng khuyên **không hard-code** quy tắc cửa sổ.
- Bảng `followup_task`, `proposal`, `bank_transactions`, `extraction`: thuộc các module sau.
- Giữ nguyên các quyết định còn lại của Module 1 (hàng đợi, retry, dead-letter, mã hóa token...): báo cáo xác nhận chúng khớp (`short` + `singletonKey`, `send()` trả `null` khi khử trùng là bình thường, không bỏ tin im lặng).
