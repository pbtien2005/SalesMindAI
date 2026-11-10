# Đưa app Meta ra chế độ Live (App Review)

Việc này **do bạn làm** (cần tài khoản Meta của doanh nghiệp). Tài liệu này liệt kê những gì code đã chuẩn bị sẵn và những gì còn lại. Tên menu của Meta hay đổi: đối chiếu theo ý nghĩa và tài liệu chính thức; các quyền và điều kiện dưới đây **chưa được kiểm chứng lại với Meta** ở thời điểm viết.

## Vì sao cần
Khi app còn ở chế độ **Development**, chỉ tài khoản có vai trò trong app (admin, developer, tester) mới đăng nhập Facebook, kết nối Page và nhắn tin được. Muốn doanh nghiệp bất kỳ kết nối Page và khách bất kỳ nhắn tin, app phải qua App Review và chuyển sang **Live**.

## Code đã sẵn sàng
| Yêu cầu | Đường dẫn | Ghi chú |
|---|---|---|
| Chính sách quyền riêng tư (URL công khai) | `PUBLIC_BASE_URL/privacy` | Nói rõ lưu gì, AI mặc định tắt, cách xóa dữ liệu |
| Điều khoản sử dụng | `PUBLIC_BASE_URL/terms` | |
| Callback xóa dữ liệu | `POST PUBLIC_BASE_URL/meta/data-deletion` | Kiểm chữ ký `signed_request` bằng `APP_SECRET`, trả `{url, confirmation_code}`. Trang trạng thái: `/meta/data-deletion/status?code=` |
| Callback gỡ ứng dụng | `POST PUBLIC_BASE_URL/meta/deauthorize` | Hiện chỉ xác minh chữ ký và ghi log |
| Xuất và xóa dữ liệu doanh nghiệp | Màn **AI** (chủ doanh nghiệp) | `GET /api/tenant/export`, `POST /api/tenant/delete` |

**Giới hạn đã biết:** `user_id` trong callback xóa dữ liệu là ID người dùng theo ứng dụng, chưa chắc trùng PSID của khách. Code xóa dữ liệu nếu trùng một PSID đã lưu; nếu không trùng thì chỉ ghi nhận yêu cầu (`deletion_requests`, trạng thái `received`) để người vận hành xử lý tay. Cần kiểm chứng với Meta thật.

## Việc bạn cần làm
1. **Xác minh doanh nghiệp (Business Verification)** trong Meta Business Settings. Thường mất vài ngày đến vài tuần.
2. Điền trong App Dashboard: URL chính sách quyền riêng tư, URL điều khoản, URL callback xóa dữ liệu, URL callback gỡ ứng dụng, danh mục app, biểu tượng.
3. **App Review**: xin Advanced Access cho các quyền app đang dùng (xem `LOGIN_SCOPES` trong `backend/src/meta/graph-client.ts`): về cơ bản `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`.
4. Với mỗi quyền, quay **video hướng dẫn** (dùng tài khoản tester): đăng nhập Facebook từ nút "Kết nối Page Facebook", chọn Page, khách nhắn tin, tin hiện trong Hộp thư, nhân viên bấm Gửi và tin tới Messenger của khách. Nêu rõ mục đích từng quyền.
5. Nếu cần trả lời **sau 24 giờ** kể từ tin cuối của khách: xin thêm quyền cho phép gửi ngoài cửa sổ (tag `HUMAN_AGENT` hoặc cơ chế Meta đang áp dụng; tài liệu cần đối chiếu lại). Code hiện **không** hỗ trợ gửi ngoài cửa sổ 24 giờ.
6. Điền đủ thông tin "Data Use Checkup" hằng năm theo yêu cầu của Meta.

## Sau khi Live
- Chạy lại danh sách thử trong [KET-NOI-PAGE.md](KET-NOI-PAGE.md) bằng một Page và một tài khoản **không** có vai trò trong app.
- Giữ `AI` ở trạng thái tắt cho tới khi luật sư xác nhận việc gửi nội dung chat ra nhà cung cấp AI ở nước ngoài (Luật 91/2025/QH15, Nghị định 356/2025/NĐ-CP).
