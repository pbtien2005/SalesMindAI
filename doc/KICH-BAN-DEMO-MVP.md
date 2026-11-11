# Kịch bản demo MVP SalesMind AI

Cập nhật 2026-11-11 theo bản đã xây (bản nháp gốc ngày 2026-11-09). Căn cứ: luồng nghiệp vụ trong `doc/salesmind (4).drawio`, đề án `.docx` (tình huống nội thất, phạm vi MVP), `doc/PLAN-module2.md`.
Thời lượng: khoảng 8 phút 30 giây. Mọi cảnh đã xây và chạy được bằng kịch bản Chrome `web/e2e/run.mjs` (xem mục 8); phần nối với Facebook thật chưa kiểm chứng.

## 1. Ba điều khán giả phải nhớ

1. **Mọi thứ AI trích đều có câu gốc.** Ở Hộp đề xuất, câu gốc hiện sẵn. Ở Thẻ khách và Lịch sử duyệt, câu gốc thu gọn sau nút **Căn cứ** (một cú bấm, không cần rê chuột nên dùng được trên màn cảm ứng và bàn phím). Đoạn khớp tô vàng trong chat.
2. **AI không tự đoán ngày.** "Cuối tuần này" hiện cờ hỏi lại, Sale chọn ngày.
3. **AI đề xuất, Sale quyết định ở chỗ có hậu quả:** ngừng bám, tin gửi khách, xác nhận cọc, tạo đơn. Còn thông tin nhẹ (sản phẩm, ngân sách, tên) thì AI tự điền và gắn nhãn "chưa duyệt".

## 2. Nhân vật và thiết bị

| Vai | Người thật ngồi | Thiết bị | Việc |
|---|---|---|---|
| Khách "anh Minh" | Bạn A | Điện thoại, tài khoản Facebook tester, app Messenger | Nhắn vào Page demo, gửi ảnh bill |
| Sale "Lan" | Bạn B (hoặc chính người dẫn) | Laptop, màn hình SalesMind | Duyệt, sửa, trả lời qua Page Inbox |
| Quản lý "chị Hà" | Người dẫn | Cùng laptop, nút đổi vai trò | Xem Trang chủ |
| AI và hệ thống | Không ai | Server | Phần "Hệ thống hiện" |

Cửa hàng demo: **Nội thất Minh Phát (demo)**. Sản phẩm: **Sofa Milan xám, mã SF-021, 12.000.000 ₫**.

## 3. Bố cục màn hình dùng trong demo

- **Màn Chat** gồm 3 vùng. *Trái:* Inbox list (có chấm cảnh báo, bộ đếm bám) và thẻ khách ghim góc trái như drawio. *Giữa:* nội dung chat real-time, tin của Page có nhãn nguồn (Page Inbox). *Phải:* **Hộp đề xuất** chứa các mục cần Sale duyệt, mỗi mục có khung câu gốc và nút Duyệt / Sửa / Bỏ qua.
- **Trang chủ:** 4 thẻ (hội thoại P1, việc quá hạn, tiền cọc thực tế, lịch nhắc) và dòng số liệu AI.
- **Đơn hàng và Thanh toán:** bảng đơn, tiền đã cọc, công nợ.
- Không có đăng nhập thật: góc trên có nút chọn vai trò Lan / chị Hà.

Nhãn dùng xuyên suốt: **AI điền, chưa duyệt** (xám), **Đã duyệt bởi Lan, giờ** (xanh), **Cần xác nhận** (cam), **Thiếu** (đỏ nhạt).

## 4. Dữ liệu nền và đồng hồ demo

Đồng hồ demo bắt đầu **Thứ Năm 12/11/2026, 09:00**. Có nút "Tua đồng hồ" chỉ dùng khi demo. Tin của khách được phát lại bằng tin giả ký đúng chữ ký, nên giờ gửi do ta đặt.

Bốn khách nền, có sẵn trong Inbox:

| Khách | Trạng thái lúc 09:00 Thứ Năm | Dùng ở cảnh |
|---|---|---|
| Chị Thu | Nhắn 08:40 hỏi cách thanh toán, chưa ai trả lời. Gắn **P1** | 0, 6 |
| Anh Đức | Việc "gọi lại báo giá" hạn Thứ Năm 08:00, chưa làm. **Quá hạn** | 0, 6 |
| Chị Ngọc | Việc "nhắc thanh toán" hạn Thứ Năm 08:30, chưa làm. **Quá hạn** | 0, 6 |
| Cô Mai | **Bám 5/5** (Page đã trả lời rồi bám 5 lần, mỗi lần cách 24 giờ), khách im lặng; mới nhắn lần cuối 10:30 Thứ Tư nên chưa đủ 24 giờ chờ để đề xuất ngừng | 2 |

Định nghĩa dùng cho demo (drawio không định nghĩa, xem mục 10): P1 là khách có tín hiệu mua hoặc hỏi thanh toán mà chưa được trả lời quá 15 phút; quá hạn là việc có hạn đã qua mà chưa hoàn thành.

Tài liệu giả cần chuẩn bị: một ảnh bill chuyển khoản **tự dựng** (không dùng logo ngân hàng thật), số tiền 6.000.000 VND, nội dung "Minh coc SF-021", 13/11/2026 10:09.

## 5. Kịch bản từng cảnh

### Cảnh 0. Mở đầu (0:30)

| Ai | Thao tác | Hệ thống hiện | Lời dẫn |
|---|---|---|---|
| Người dẫn | Mở Trang chủ ở vai Lan | P1: **1** · Quá hạn: **2** · Tiền cọc hôm nay: **0 ₫** · Lịch nhắc: Anh Đức (đỏ), Chị Ngọc (đỏ) | "Đây là một buổi sáng của Lan. Có khách chờ, có việc đã trễ. Hôm nay chúng ta theo một khách mới, từ tin nhắn đầu tiên tới tiền cọc." |

### Cảnh 1. Khách hỏi lần đầu, chưa có SĐT (1:30), 09:05

| Ai | Thao tác | Hệ thống hiện | Lời dẫn |
|---|---|---|---|
| Khách (Bạn A) | Gửi 2 tin cách nhau vài giây: **"Chào shop, anh đang tìm sofa phòng khách tầm 15 triệu"** rồi **"Có mẫu nào màu xám không em?"** | Màn Chat: hội thoại "Facebook: anh Minh" nhảy lên đầu Inbox, chấm xanh "Mới", tin hiện real-time | "Khách nhắn, không ai phải nhập tay." |
| Lan | Mở hội thoại | Thẻ khách góc trái chỉ có tên Facebook. Dòng trạng thái: "Chưa có SĐT, Bám 0/5" | |
| AI | Tự chạy, sau 3 giây (đã chỉnh từ 30 giây) | Thẻ khách tự điền: *Mẫu đã hỏi:* "sofa phòng khách, màu xám" · *Ngân sách:* "≈ 15.000.000 ₫ (khách nói 'tầm')". Cả hai có nhãn **AI điền, chưa duyệt**. **Hộp đề xuất vẫn trống** | "Thông tin nhẹ AI điền sẵn, Lan không phải bấm gì." |
| Lan | Bấm **Căn cứ** ở dòng "Ngân sách" | Câu gốc mở ngay tại dòng: "…**tầm 15 triệu**" (đoạn khớp tô vàng), có "xem trong chat" | "Mọi thông tin đều truy được về câu gốc." |
| Lan | Bấm **Duyệt thông tin AI điền (2)** (một nút cho cả thẻ; muốn chỉnh dòng nào thì bấm Sửa trước) | Các dòng chuyển "**Đã duyệt bởi Lan, giờ**". Lịch sử duyệt ghi người duyệt; vẫn mở được **Căn cứ** ở đó | "Một cú bấm, và vẫn truy được căn cứ." |
| Lan | Trả lời ở Page Inbox: **"Dạ em chào anh ạ. Em gửi anh vài mẫu sofa xám, nổi bật là Sofa Milan xám (SF-021) giá 12 triệu ạ. Anh cho em xin SĐT để em tư vấn thêm nhé."** | Tin của Page hiện trong chat, nhãn "Page Inbox". Inbox list: "Chờ khách trả lời 0 phút" | "Nhân viên vẫn trả lời ở công cụ quen thuộc, hệ thống thấy được." |

### Cảnh 2. Khách im lặng, hệ thống nhắc bám (1:00)

| Ai | Thao tác | Hệ thống hiện | Lời dẫn |
|---|---|---|---|
| Người dẫn | Bấm "Tua đồng hồ" tới **Thứ Sáu 13/11, 09:30** | Đồng hồ góc màn hình nhảy. Lịch nhắc của Lan thêm dòng cam: **"Anh Minh, Đến hạn bám lần 1/5"** (Lan mới trả lời, chưa bám lần nào, nhưng đã quá 24 giờ). Hộp đề xuất xuất hiện mục cho Cô Mai: **"AI đề xuất Ngừng bám"**, lý do "5/5 lượt bám không phản hồi" | "Một ngày trôi qua, khách im lặng." |
| Lan | Mở Cô Mai, bấm **Xác nhận ngừng bám** | Cô Mai chuyển "Đã ngừng bám", ghi "Đã duyệt bởi Lan". Chú thích nhỏ: "Hệ thống chỉ đề xuất, việc bỏ bám do Sale xác nhận" | "Dừng chăm một khách là quyết định của người, không phải của AI." |
| Lan | Mở Anh Minh, nhắn ở Page Inbox: **"Anh Minh ơi, mẫu Sofa Milan xám em gửi hôm qua anh xem thế nào ạ? Anh cho em xin SĐT để em giữ hàng nhé."** | Tin Page hiện trong chat. Tin này cách tin trả lời trước hơn 24 giờ nên tính là **lần bám thứ nhất**: dòng chuyển "Bám 1/5", hết "đến hạn" | |

### Cảnh 3. Khách quay lại, có SĐT, hẹn mơ hồ (1:30), 09:40

| Ai | Thao tác | Hệ thống hiện | Lời dẫn |
|---|---|---|---|
| Khách | **"Anh Minh đây, hôm qua bận quá. SĐT anh 0912 345 678. Cuối tuần này anh ghé shop xem được không?"** | Inbox: bộ đếm "Bám 1/5" về **0/5** (khách phản hồi thì về 0), vì tin có thông tin mới (hẹn lịch) | |
| AI | Tự chạy | Thẻ khách: *Tên:* "Minh" (**AI điền, chưa duyệt**). Hộp đề xuất, 2 mục cần duyệt: **(1) SĐT** "0912 345 678", dấu ✓ hợp lệ, có câu gốc. **(2) Mốc hẹn**, cụm gốc "**cuối tuần này**", nhãn **Cần xác nhận**: "Chưa có ngày. Tin gửi lúc Thứ Sáu 13/11 09:40", ô chọn ngày giờ **để trống** | "Chỗ này AI dừng lại. 'Cuối tuần' là Thứ Bảy hay Chủ Nhật, sáng hay chiều? AI không đoán." |
| Lan | Chọn **Thứ Bảy 14/11/2026, 10:00**, bấm **Duyệt 2 mục** | Hai mục chuyển "Đã duyệt bởi Lan, 09:41". Trạng thái khách: **Theo dõi và chốt đơn**. Lịch chăm sóc lại: "**Thứ Bảy 14/11 10:00**, lý do: ngày hẹn đã xác nhận (ưu tiên 1)" | "Ngày hẹn là do người chọn. Hệ thống dùng đúng ngày đó để nhắc." |

### Cảnh 4. Khách chốt đơn (1:00), 09:50

| Ai | Thao tác | Hệ thống hiện | Lời dẫn |
|---|---|---|---|
| Khách | **"Anh xem ảnh thấy ổn rồi, lấy 1 bộ Sofa Milan xám mã SF-021, giá 12 triệu như em báo nhé. Chốt luôn."** | Huy hiệu **Tín hiệu chốt đơn** trên hội thoại, căn cứ "Chốt luôn" | |
| AI | Tự chạy | Hộp đề xuất, 2 mục. **(1) Đơn nháp:** Tên nhận hàng *Minh* · SĐT *0912 345 678* · Địa chỉ ***Thiếu*** · Mẫu đã hỏi *sofa phòng khách, màu xám* · Mã hàng *SF-021* · Số lượng *1 bộ* · Giá *12.000.000 ₫* · Thanh toán *Chờ thanh toán* · Trạng thái đơn *Nháp*. **(2) Tin nháp:** "Dạ em xác nhận đơn: 1 bộ Sofa Milan xám (SF-021), 12.000.000 ₫. Anh vui lòng cọc 50% = 6.000.000 ₫ để em giữ hàng ạ. Thông tin chuyển khoản: [số tài khoản demo]." Dòng chú ý: "AI chỉ điền nháp, Sale phải kiểm tra lại" | "AI soạn sẵn đơn và tin xác nhận, nhưng chưa gửi gì cho khách." |
| Lan | Đọc, sửa một chữ trong tin nháp ngay tại ô, bấm **Gửi** (demo: gửi giả lập, ghi rõ "Demo: tin chưa gửi tới Facebook"; tenant thật: gửi qua Messenger) | Tin hiện trong chat với nhãn **SalesMind**. Đơn: **Chờ cọc 6.000.000 ₫**. Việc "Nhắc khách cọc" hạn +24 giờ. Lịch nhắc thêm: "Nếu khách chưa cọc sau 1 ngày, nhắc Lan" | "Gửi tin là việc của Lan." |

### Cảnh 5. Cọc bằng bill (1:30), 10:10

| Ai | Thao tác | Hệ thống hiện | Lời dẫn |
|---|---|---|---|
| Khách | Gửi ảnh bill đã chuẩn bị, kèm **"Anh chuyển cọc rồi nhé"** | Ảnh bill hiện trong chat | |
| AI | Tự chạy | Hộp đề xuất, thẻ **Bill**: ảnh thu nhỏ, vùng số tiền được khoanh, "**6.000.000 ₫**", nội dung "Minh coc SF-021". Dòng so sánh: "**6.000.000 ₫ / 12.000.000 ₫ = 50%, đạt ngưỡng ≥ 50%**". Ghi chú: "AI chỉ đọc số tiền, trạng thái thanh toán do Sale xác nhận" | "AI đọc bill, nhưng không biết tiền đã thật sự về tài khoản chưa." |
| Lan | Nói to "em kiểm tra app ngân hàng của shop", bấm **Xác nhận đã cọc** | Thanh toán: **Đã cọc 6.000.000 ₫, còn lại 6.000.000 ₫**. Hiện đề xuất **Tạo đơn** đã điền sẵn, ô Địa chỉ vẫn *Thiếu* | "Người xác nhận tiền, một cú chạm." |
| Lan | Gõ địa chỉ "12 Nguyễn Trãi, Hà Đông, Hà Nội" (địa chỉ giả), bấm **Xác nhận tạo đơn** | Thông báo "Đã tạo đơn #DH-0001". Màn Đơn hàng và Thanh toán: dòng đơn *Minh · SF-021 ×1 · 12.000.000 ₫ · Đã cọc 6.000.000 ₫ · Còn 6.000.000 ₫ · Đã xác nhận* | "Từ tin nhắn đầu tiên tới đơn hàng có cọc, Lan chỉ bấm vài lần." |
| Lan | Bấm **Gửi** ở tin nháp "báo đã nhận cọc" (xin thêm địa chỉ nếu cần) | Tin hiện trong chat. Anh Minh không còn là khách chờ trả lời (không thành P1 thứ hai) | "Trả lời khách là việc của Lan, AI chỉ soạn sẵn." |

### Cảnh 6. Quản lý xem kết quả (1:00), 10:30

| Ai | Thao tác | Hệ thống hiện | Lời dẫn |
|---|---|---|---|
| Người dẫn | Đổi vai sang **chị Hà**, mở Trang chủ | P1: **1** (chị Thu) · Quá hạn: **2** · Tiền cọc hôm nay: **6.000.000 ₫** (từ 0 ở đầu buổi) · Lịch nhắc: Anh Đức (đỏ), Chị Ngọc (đỏ), Anh Minh (xanh) "Thứ Bảy 14/11 10:00, khách ghé xem". Dòng AI (số đo được khi chạy `web/e2e/run.mjs`, bộ trích offline): **tự điền 4 · Sale sửa vì sai 0 · hỏi lại ngày 1 · đề xuất Sale đã duyệt 7** (SĐT, mốc hẹn, ngừng bám, tin nháp đã gửi, khoản cọc, đơn đã tạo). Với Claude thật các số này có thể lệch | "Chị Hà không phải hỏi từng người. Thấy ngay ai bị bỏ quên." |
| Chị Hà | Bấm thẻ **Quá hạn: 2**, rồi bấm Anh Đức | Danh sách 2 việc quá hạn. Mở Anh Đức: hội thoại, câu gốc làm căn cứ, lịch sử "AI đề xuất, ai duyệt, lúc nào" | "Có căn cứ, có người chịu trách nhiệm cho từng việc." |

### Cảnh 7. Kết (0:30)

Người dẫn quay lại ba điều ở mục 1, nói một câu mỗi điều. Hiện lại Trang chủ ở trạng thái cuối.

## 6. Hai biến thể, dùng khi còn thời gian hoặc bị hỏi

- **Bill dưới ngưỡng (cảnh 5):** bill 3.000.000 ₫ (25%) thì thẻ Bill ghi "**dưới 50%**". Lan bấm **Bỏ qua** thì có tin nháp "nhắc chuyển nốt" (Lan vẫn phải bấm Gửi). Không có chữ nào nói đã đủ cọc.
- **AI điền sai (cảnh 1):** chủ động gửi một tin có số gây hiểu lầm. Lan bấm **Sửa** ở dòng sai, nhập giá trị đúng, nhãn chuyển thành **Đã sửa và duyệt bởi Lan**. Con số "Sale sửa vì sai" ở Trang chủ tăng lên 1.

## 7. Phân tầng AI trong demo

| Tầng | Mục | Hành vi |
|---|---|---|
| Tự điền (nhãn "chưa duyệt", chưa vào hồ sơ đã duyệt) | Mẫu đã hỏi, ngân sách, tên | Hiện sẵn, không cần bấm. Sale chỉ sửa khi sai, lúc đó mới thành dữ liệu đã duyệt |
| Phải duyệt | SĐT, mốc hẹn mơ hồ, ngừng bám, tin nháp xác nhận đơn, xác nhận cọc, tạo đơn | Hộp đề xuất, Duyệt / Sửa / Bỏ qua |

Quy tắc không đổi so với CLAUDE.md: dữ liệu chưa duyệt chỉ nằm ở `proposals` trạng thái `pending`, không vào `profile_fields`. Dữ liệu chưa duyệt chỉ chuyển thành đã duyệt khi Sale chủ động sửa hoặc bấm xác nhận, không tự động theo thời gian.

## 8. Trạng thái xây dựng (2026-11-11)

| Phần | Trạng thái |
|---|---|
| Nhận tin qua webhook, lưu cả tin Page gửi (echo), đồng hồ "chờ khách trả lời" | **Có**, test với Graph giả. Chưa thử với Meta thật (xem `doc/KET-NOI-PAGE.md`) |
| Trích xuất kèm câu gốc, đề xuất `pending`, cờ ngày mơ hồ, kiểm tra SĐT | **Có**. Bộ trích offline (luật) đạt 12/12 ca đánh giá; **chưa chạy với Claude thật** (cần `ANTHROPIC_API_KEY`) |
| Hộp đề xuất, thẻ khách, nhãn "chưa duyệt", màn Hội thoại, Trang chủ, Đơn hàng, Việc quá hạn, Lịch sử duyệt | **Có** (`web/`) |
| Bộ đếm bám, đề xuất ngừng bám, lịch nhắc, nhắc cọc sau 24 giờ | **Có** (tính khi đọc từ dữ liệu và `now`) |
| Tín hiệu chốt đơn, đơn nháp, tin nháp | **Có** (mẫu cố định, không do mô hình viết) |
| Đọc ảnh bill, so ngưỡng cọc | **Có**: `AnthropicBillReader` (Claude vision, chỉ thử với fetch giả) và bộ đọc mô phỏng (tra bảng SHA-256 của 2 ảnh mẫu, giao diện ghi rõ) |
| Bảng đơn hàng và công nợ | **Có** |
| Đồng hồ demo tua được, đổi vai, dữ liệu nền | **Có** |
| Gửi tin cho khách | **Có**: nút Gửi. Demo ghi giả lập; tenant thật gửi qua Send API (chưa thử với Meta thật) |

## 9. Rủi ro và phương án dự phòng

- **Meta thật:** app đang ở chế độ Development, chỉ tài khoản có vai trò trong app nhắn được. Mốc 4 và 5 của Module 1 chưa thử với Page thật. Phương án chính: phát lại tin giả ký đúng chữ ký. Dùng Page thật chỉ khi đã thử xong theo `doc/KET-NOI-PAGE.md`.
- **Mạng hoặc API AI lỗi giữa buổi:** quay sẵn video toàn bộ kịch bản, và lưu sẵn kết quả AI của từng cảnh để phát lại.
- **AI trích sai khi trình diễn trực tiếp:** dùng đúng các câu ở mục 5 đã chạy thử nhiều lần. Có sẵn biến thể "AI điền sai" để biến lỗi thành điểm mạnh.
- **Đọc bill sai số tiền:** ảnh bill tự dựng, chữ lớn, chạy thử trước. Nếu vẫn sai, Lan sửa số tiền và nói rõ đó là lý do trạng thái thanh toán do Sale xác nhận.
- **Pháp lý:** chỉ dùng hội thoại và bill tự dựng. Không đưa chat hay ảnh chuyển khoản của khách thật vào demo cho tới khi luật sư xác nhận việc gửi dữ liệu ra API nước ngoài (Luật 91/2025/QH15).

## 10. Giả định cần xác nhận

1. Sản phẩm, mã SF-021, giá, tên khách, số điện thoại, địa chỉ đều do tôi bịa cho demo.
2. **Bộ đếm bám đếm hành động chăm sóc thật của nhân viên, không đếm ngày** (đổi 2026-11-11, vì cách đếm theo ngày làm 37/62 hội thoại Page thật hiện 5/5 dù mới nhắn 1 lần). Tin Page đầu tiên sau khách là trả lời, không tính; mỗi tin Page tiếp theo cách mốc trước ít nhất 24 giờ là một lần bám; tin dồn trong 24 giờ chỉ tính một; tối đa 5; khách phản hồi thì về 0. Sau tin Page cuối quá 24 giờ mà chưa đủ 5 lần thì **đến hạn bám** (hiện ở Lịch nhắc). Đủ 5 lần và chờ thêm 24 giờ mà khách vẫn im thì mới đề xuất ngừng. Drawio không ghi cách đếm. Ngưỡng 24 giờ là hằng số `FOLLOWUP_GAP_MS`.
3. Ngưỡng 50% tính trên một bill so với tổng đơn. Drawio không nói có cộng dồn nhiều lần chuyển khoản không.
4. P1 và "quá hạn SLA" dùng định nghĩa ở mục 4. Drawio và đề án chưa định nghĩa hai khái niệm này.
5. Lịch nhắc của Lan hiện thêm một dòng "sắp tới" (Anh Minh, Thứ Bảy). Drawio chỉ ghi "trong ngày".
6. SĐT nằm ở tầng "phải duyệt" vì nó quyết định khách rẽ sang Bám hay Theo dõi.
7. Tin nháp xác nhận đơn dùng số tài khoản giả. Chưa có nơi cấu hình thông tin chuyển khoản của cửa hàng.
