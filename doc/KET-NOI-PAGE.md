# Kiểm tra mốc 4 với Page thật

Hướng dẫn cho người vận hành (bạn) thử luồng kết nối Page và nhận tin bằng Meta App và Page thật. Code và test tự động đã xong; phần này kiểm tra những gì chỉ Meta thật mới trả lời được.

Tên menu trong Meta App Dashboard hay đổi. Nếu tên ở đây khác giao diện của bạn, đi theo ý nghĩa và báo lại để cập nhật file này.

## A. Chuẩn bị

1. **Tunnel (địa chỉ HTTPS công khai).** Meta không gọi được `localhost`. Dùng ngrok hoặc cloudflared trỏ vào cổng 3000, lấy địa chỉ dạng `https://xxxx.ngrok-free.app`. Địa chỉ miễn phí thường đổi mỗi lần chạy lại tunnel, khi đó phải sửa lại `.env` và hai chỗ trong Meta App (mục 4).
2. **Điền `.env`** (đã có sẵn, chỉ sửa 3 dòng đầu):
   - `FB_APP_ID`, `APP_SECRET`: Meta App > Settings > Basic. **Không dán App Secret vào chat.**
   - `PUBLIC_BASE_URL`: địa chỉ tunnel, không có dấu `/` ở cuối.
3. **Chạy:** `docker compose up -d`, rồi `npm run db:migrate`, rồi `npm run dev`. Mở `PUBLIC_BASE_URL/healthz` trên trình duyệt phải thấy `{"status":"ok"}`.
4. **Khai báo trong Meta App Dashboard:**
   - **Valid OAuth Redirect URIs** (Facebook Login > Settings): đúng chuỗi `PUBLIC_BASE_URL/auth/facebook/callback`.
   - **Webhooks** > đối tượng **Page**: Callback URL `PUBLIC_BASE_URL/webhook`; Verify Token là giá trị `VERIFY_TOKEN` trong `.env`. Bấm Verify, phải thành công (nếu lỗi, xem log server).
   - **Đăng ký field `messages` ở cấp App** (cùng chỗ Webhooks, bấm Subscribe cho `messages`). Meta chỉ gửi webhook khi field được đăng ký ở **cả cấp App lẫn cấp Page**. Cấp Page do server tự làm khi kết nối; cấp App phải làm tay.
5. **Tài khoản:** người đăng nhập Facebook phải quản lý Page, và (khi app còn ở chế độ Development) phải có vai trò admin, developer hoặc tester của app. Người nhắn tin thử cũng vậy.

## B. Kết nối Page

```
npm run cli -- tenant:create "Tên doanh nghiệp thử"
```

Lệnh in ra một liên kết, dùng **một lần**, hết hạn sau 10 phút. Mở nó bằng **một trình duyệt** (bật cookie), đăng nhập Facebook, chọn Page, cấp quyền. Nếu thành công sẽ thấy trang "Kết nối thành công" liệt kê tên Page.

Kiểm tra DB:

```
docker exec salesmind-postgres psql -U salesmind -d salesmind -c "select fb_page_id, name, status, subscribed_at, left(token_enc, 3) as token from pages"
```

Mong đợi: `status = active`, `subscribed_at` có giá trị, `token = v1:` (token đã mã hóa, không phải chuỗi `EAA...`).

## C. Nhận tin

Dùng tài khoản Facebook **khác** (vai trò tester) nhắn một tin vào Page. Trong vài giây:

```
docker exec salesmind-postgres psql -U salesmind -d salesmind -c "select mid, text, sent_at, source from messages order by sent_at desc limit 5"
```

Kiểm tra:
- Có dòng mới, `source = webhook`, `text` đúng (thử cả tiếng Việt có dấu và emoji).
- **`sent_at` khớp giờ bạn vừa nhắn.** Mã giả định `timestamp` của Meta là mili giây; nếu sai bạn sẽ thấy năm 1970 hoặc năm rất xa. Đây là điều cần xác nhận nhất.
- Trả lời tin đó từ hộp thư của Page: **không** tạo thêm dòng nào (tin của Page bị bỏ).
- Gửi một ảnh: dòng có `text` rỗng và cột `attachments` chứa metadata.

## C2. Thử backfill (lấy lại tin cũ)

Trước tiên nhắn vài tin vào Page từ tài khoản tester, **chờ vài phút**, rồi (khi `npm run dev` đang chạy):

```
npm run cli -- backfill
npm run cli -- backfill:status
```

Mong đợi: trạng thái chuyển `running` rồi `listed`, `đã lưu từ backfill` tăng với các tin chưa có từ webhook. Để thử đúng việc "bù tin bị lỡ", tắt server, nhắn thêm vài tin, bật lại server rồi chạy backfill: các tin nhắn trong lúc server tắt sẽ xuất hiện với `source = backfill`.

Hai điều cần xác nhận:
- **Không có tin trùng** giữa tin đã vào qua webhook và qua backfill: `select mid, source, count(*) from messages group by mid, source` rồi so với số tin bạn thật sự đã nhắn. Nếu bị gấp đôi, id của Conversations API khác mid của webhook: báo lại cho tôi và gửi log (có cảnh báo "khác mid").
- Chỉ lấy được **20 tin gần nhất** mỗi hội thoại, và tin chỉ có ảnh không được backfill (ảnh vẫn vào qua webhook).

## D. Báo lại cho tôi

Cho tôi biết kết quả từng bước A đến C và, nếu có lỗi, chép nguyên văn thông báo (hộp thoại Facebook, trang kết quả, hoặc log server). Log server không chứa token hay nội dung tin nên chép được. Đừng gửi App Secret hay token.

## Lỗi thường gặp

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Facebook báo `redirect_uri` không hợp lệ | Chuỗi trong Valid OAuth Redirect URIs không khớp từng ký tự với `PUBLIC_BASE_URL/auth/facebook/callback` (tunnel đổi địa chỉ, thừa dấu `/`). |
| Hộp thoại báo lỗi về quyền hoặc `scope` | App loại Business có thể cần cấu hình Facebook Login for Business. Tạo cấu hình trong Dashboard, điền ID vào `FB_LOGIN_CONFIG_ID` trong `.env`, chạy lại server. Tôi chưa xác minh được với app của bạn. |
| Verify webhook thất bại | `VERIFY_TOKEN` trong Dashboard khác `.env`, hoặc tunnel chưa chạy. |
| Kết nối xong nhưng không có tin | Chưa Subscribe `messages` ở cấp App (mục A.4); người nhắn không có vai trò trong app (Development); trang kết quả ghi "chưa nhận được tin" (đăng ký cấp Page lỗi, xem mã lỗi Meta). |
| Trang "Liên kết không hợp lệ" | Liên kết đã dùng hoặc quá 10 phút, hoặc mở ở hai trình duyệt khác nhau. Chạy `npm run cli -- tenant:connect-url <id>` để lấy liên kết mới. |
| Mã lỗi Meta 190 | Token không hợp lệ hoặc hết hiệu lực; kết nối lại bằng liên kết mới. |

## Điều tôi chưa xác minh với Meta thật

Ghi lại để bạn biết kết quả nào là "xác nhận" và kết quả nào là "bất ngờ":
- Đơn vị `timestamp` của webhook (giả định mili giây).
- Cấu trúc payload thật của tin có ảnh, sticker.
- Gọi `me/accounts` có trả đủ Page kèm Page token không (tài liệu dùng dạng `{user-id}/accounts`).
- Có cần `business_management` hay `config_id` cho app của bạn không.
- `code` của OAuth có dùng được một lần không (tài liệu không nói).
- Hành vi ở chế độ Development với tài khoản tester.
- Với backfill: `id` tin có trùng `mid` webhook không; thứ tự và cách phân trang của danh sách tin; mã lỗi khi bị giới hạn tốc độ và khi tin quá cũ.
