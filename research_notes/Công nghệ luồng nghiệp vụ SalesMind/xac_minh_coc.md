# Xác minh tiền cọc cho SalesMind AI: dịch vụ báo biến động số dư, VietQR, đối soát, AI đọc bill, pháp lý, cổng thanh toán (Việt Nam, trạng thái tới 09/11/2026)

Ghi chú phương pháp: nghiên cứu ngày 2026-11-09 bằng WebSearch/WebFetch. Những chỗ trang web trả về "đang tải" hoặc không có số liệu đều được ghi ở mục Gaps, không suy đoán. Một số kết quả do công cụ fetch tóm tắt lại (không phải đọc nguyên văn); chỗ nào có mâu thuẫn tôi ghi rõ. Giá/chính sách các nhà cung cấp thay đổi nhanh, cần xác nhận lại trên trang chính thức trước khi ký.

---

## Q1. Dịch vụ báo biến động số dư cho SME ở VN (SePay, Casso, payOS, Tingee, API ngân hàng trực tiếp): cách lấy giao dịch, webhook, chữ ký, độ trễ, giá, ngân hàng, đa tenant, điều khoản

### Takeaway
SePay và Casso là hai lựa chọn trưởng thành nhất: cả hai đều có webhook có chữ ký, cả hai kết nối theo hai kiểu (API ngân hàng chính thức cho một số ngân hàng, và kiểu khác cho phần còn lại; Casso gọi kiểu kia là RPA). SePay công bố giá rõ (FREE 50 giao dịch/tháng; STARTUP từ 120.000đ/tháng); Casso Flow không công bố giá trong nội dung lấy được. Với SaaS đa tenant nên dùng sản phẩm dành cho phần mềm (SePay Bank Hub, hoặc ủy quyền ba bên) thay vì để mỗi tenant tự cấu hình webhook thủ công; điều khoản/giá cho mô hình đối tác chưa tìm thấy công khai.

### Cited Findings

**SePay**
- Gói giá công khai: FREE 0đ, 50 giao dịch/tháng, 12 ngân hàng (Vietcombank, VPBank, ACB, Sacombank, VietinBank, MBBank, BIDV, MSB, TPBank, KienLongBank, ShinhanBank, OCB); gói FREE cho phép vượt và tính phí sau (đơn giá vượt không ghi). STARTUP từ 120.000đ/tháng, các bậc 180 -> 986.000 giao dịch/tháng (không ghi bậc nào ứng với giá nào; thanh toán năm giảm tới 20%). Tài khoản ngân hàng, người dùng, webhook/tích hợp không giới hạn trên mọi gói. — [SePay bảng giá](https://sepay.vn/bang-gia.html)
- Gói SHOP 99.000đ/tháng (70.000đ/cửa hàng/tháng nếu trả năm), không có API, không tích hợp cổng thanh toán, nên không dùng được cho SaaS cần webhook/API. — [SePay bảng giá](https://sepay.vn/bang-gia.html)
- Bank Hub là "API cho công ty phần mềm": Hosted Link (WebView/JS SDK) + REST API + webhook; có sandbox và production; khách liên kết tài khoản ngay trong Hosted Link, "không cần mật khẩu ngân hàng". Giá Bank Hub không công bố. — [SePay Bank Hub tổng quan](https://developer.sepay.vn/en/bankhub/tong-quan); [SePay bảng giá](https://sepay.vn/bang-gia.html)
- Ngân hàng hỗ trợ qua Bank Hub theo loại tài khoản: Cá nhân: VPBank(NEO), TPBank, VietinBank, ACB, BIDV, MBBank, OCB, KienLongBank, MSB, Sacombank. Hộ kinh doanh: TPBank, VietinBank, ACB, BIDV, MBBank, KienLongBank, MSB, Sacombank, VPBank(NEO). Doanh nghiệp: TPBank, ACB, MBBank, KienLongBank; VietinBank, BIDV, MSB, Sacombank, VPBank, OCB ghi "coming soon". Tính năng khác nhau theo ngân hàng (một số liên kết tài khoản chính đồng bộ tiền vào/ra, một số chỉ VA đồng bộ tiền vào). — [SePay Bank Hub tổng quan](https://developer.sepay.vn/en/bankhub/tong-quan)
- OCB doanh nghiệp: SePay hợp tác chính thức mở API; nếu OCB chưa mở API cho doanh nghiệp thì cần ký ủy quyền ba bên OCB–SePay–doanh nghiệp; mặc định chỉ nhận báo có (tiền vào). — [Hướng dẫn kết nối OCB (docs.sepay.vn)](https://docs.sepay.vn/ket-noi-ocb-api-doanh-nghiep.html)
- VietinBank tài khoản cá nhân/hộ KD: tiền tố `SEVQR` trong nội dung chuyển khoản phải được giữ nguyên, nếu không "webhook sẽ không được gửi" (cơ chế nhận diện theo nội dung). — [SePay Bank Hub tổng quan](https://developer.sepay.vn/en/bankhub/tong-quan)
- Webhook: xác thực chọn một trong `No_Authen`, `Api_Key`, `HMAC_SHA256` (khuyến nghị), `OAuth2.0`. HMAC: header `X-SePay-Signature: sha256={hex}` và `X-SePay-Timestamp` (giây); chuỗi ký là `{timestamp}.{raw_body}`, khóa là Secret Key; mẫu PHP từ chối lệch quá 300 giây; phải dùng raw body và so sánh constant-time. Endpoint phải trả HTTP 200/201 kèm `{"success": true}`. URL phải public. — [Xác thực webhook SePay](https://developer.sepay.vn/en/sepay-webhooks/xac-thuc); [Tạo webhook](https://developer.sepay.vn/en/sepay-webhooks/tao-webhook)
- Payload mẫu: `id`, `gateway`, `transactionDate`, `accountNumber`, `subAccount`, `code`, `content`, `transferType` (`in`), `transferAmount`, `accumulated`, `referenceCode`. Docs khuyên khử trùng theo `id` và kiểm tra `transferAmount` so với số tiền đơn hàng. Độ trễ tài liệu ghi: gửi webhook "trong vài giây" sau chuyển khoản (không có SLA số). — [SePay: bắt đầu nhanh](https://developer.sepay.vn/en/sepay-webhooks/bat-dau-nhanh)
- Nhận diện mã thanh toán: cấu hình tiền tố 2-5 ký tự, hậu tố 1-30 ký tự (mặc định 6-8), kiểu số hoặc số+chữ; mẫu đầu tiên khớp thì là `code`; khớp không phân biệt hoa/thường tiền tố và `code` được chuẩn hóa thành chữ hoa; có thể bật/tắt toàn cục; Test mode và Live mode cấu hình riêng. — [SePay: cấu hình mã thanh toán](https://developer.sepay.vn/en/sepay-webhooks/cau-hinh-ma-thanh-toan)
- Retry/đối soát: tối đa 7 lần retry trong 33 phút (không ghi khoảng cách); không retry nếu kết nối thành công nhưng webhook báo thất bại, trừ khi cấu hình điều kiện retry; khuyến nghị đối soát định kỳ qua API giao dịch (theo khoảng thời gian hoặc `since_id`), giới hạn 3 request/giây (429), `per_page` tối đa 100; khử trùng theo `id`/`reference_number` + UNIQUE constraint. — [SePay: đối soát giao dịch](https://developer.sepay.vn/en/sepay-webhooks/doi-soat-giao-dich); [tóm tắt tìm kiếm về điều kiện retry](https://developer.sepay.vn/en/sepay-webhooks/tao-webhook)
- Điều khoản dịch vụ do ACB công bố nêu rằng khách tự chịu rủi ro khi kết nối SePay, SePay có thể tiếp cận thông tin liên quan tài khoản, tranh chấp giữa khách và SePay do hai bên tự giải quyết, ACB được miễn trách nhiệm. (Tài liệu này là bản kết quả tìm kiếm tóm tắt, chưa đọc nguyên văn.) — [Thỏa thuận ACB–SePay](https://acb.com.vn/acbwebsite/files/Tho%CC%89a%20thua%CC%A3%CC%82n%20%C4%91a%CC%86ng%20ky%CC%81%20di%CC%A3ch%20vu%CC%A3%20ta%CC%80i%20khoa%CC%89n%20%C4%91i%CC%A3nh%20danh%20-%20SEPAY.pdf)
- Test mode hạn mức: 500 giao dịch/ngày, 50 tài khoản ngân hàng. — [SePay Test mode quotas](https://developer.sepay.vn/en/tien-ich-khac/test-mode/han-muc)

**Casso**
- Casso Flow: gói trả theo năm (không có gói tháng), tính theo số giao dịch (mỗi giao dịch có/nợ trên tài khoản liên kết tính 1; VA chỉ tính tiền vào) và số tài khoản; ba hạng Sponsor, Pioneer (ngân hàng có Official API) và Standard (ngân hàng kết nối qua RPA); ngân hàng API chính thức cập nhật real-time, ngân hàng RPA đồng bộ theo lịch; chỉ đọc, không có quyền chuyển tiền; dùng thử 14 ngày hoặc 100 giao dịch; "10+ ngân hàng". Giá VND không lấy được (trang hiển thị "Đang tải bảng giá"). — [Casso Flow bảng giá](https://casso.vn/flow/bang-gia/); [Casso bảng giá](https://casso.vn/bang-gia/)
- Webhook (V1 và V2, khuyến nghị V2): timeout 5 giây; retry 12 giờ, retry đầu sau 1 phút, khoảng cách tăng theo dãy Fibonacci, tối đa 17 lần rồi đánh dấu FAIL; sau 24 giờ lỗi liên tục cấu hình chuyển PAUSED (sự kiện mới ở HOLDING, có thể phát lại), sau 7 ngày PAUSED thì Disabled và không phát lại được; URL phải HTTPS và public; khử trùng theo `id`. Payload `data` là mảng giao dịch: `id`, `tid`, `description`, `amount`, `cusum_balance`, `when`, `subAccId`, `bankName`, `bankAbbreviation`, `virtualAccount`, `corresponsiveName`, `corresponsiveAccount`, `corresponsiveBankName`... — [Casso: thiết lập webhook thủ công (EN)](https://developer.casso.vn/english-v2-new/webhook/thiet-lap-webhook-thu-cong.md); [Casso webhook](https://developer.casso.vn/english-v2-new/webhook)
- Chữ ký Webhook V2: header `X-Casso-Signature: t=<timestamp>,v1=<hex>`; thuật toán SHA-512 với secret key V2 (README không ghi rõ là HMAC, hex 128 ký tự); quy trình: sắp xếp khóa của object `data` tăng dần, serialize JSON, ghép `timestamp + "." + json`, so với `v1`; README không nêu khoảng dung sai timestamp. Khi đổi key, sự kiện đang chờ vẫn ký bằng key cũ. Mẫu verify nhiều ngôn ngữ ở repo CassoHQ. — [Casso webhook V2 verify signature (GitHub)](https://github.com/CassoHQ/casso-webhook-v2-verify-signature); [Casso: thiết lập webhook thủ công](https://developer.casso.vn/webhook/thiet-lap-webhook-thu-cong.md)
- Mẫu NodeJS trong docs Casso không có bước verify chữ ký và có nhánh không trả response (cần tự làm đúng). — [Casso: xử lý sự kiện webhook](https://developer.casso.vn/webhook/gia-lap-giao-dich-den.md)
- API Casso có hai cách xác thực (API Key tiền tố `Apikey`, OAuth 2.0 tiền tố `Bearer`); có trang hướng dẫn kết nối ACB / ACB Biz qua "Official API". — [Casso API / tìm kiếm](https://developer.casso.vn/casso-api)

**payOS (thuộc hệ sinh thái Casso)**
- Là cổng thanh toán dùng chính tài khoản ngân hàng của người bán, xây trên chuẩn VietQR, tiền về thẳng tài khoản, hỗ trợ website, QR động tại quầy và link thanh toán gửi qua mạng xã hội; đăng ký cần CCCD, không cần giấy phép kinh doanh. Gói "Pro / BIDV-1K" miễn phí 1.000 giao dịch/năm, khuyến mãi BIDV tới 31/12/2026; không có bảng phí vượt gói trên trang. — [payOS](https://payos.vn)
- Webhook payOS: `code`, `desc`, `success`, `data` (gồm `orderCode`, `amount`, `description`, `accountNumber`, `reference`, `transactionDateTime`, `paymentLinkId`, `counterAccountBankId/Name/Number`...), và `signature`; trả HTTP 2xx để xác nhận; cách tính signature nằm ở trang riêng (không lấy được); 429 khi gửi quá nhiều request. — [payOS: dữ liệu webhook](https://payos.vn/docs/du-lieu-tra-ve/webhook/); [payOS docs](https://payos.vn/docs/)
- BIDV mở dịch vụ thu hộ qua BIDV VA Billing (công nghệ Open API) cho khách của Casso/payOS; ưu đãi 100 khách đầu 15/8/2024–31/12/2024 đã hết hạn. — [Thị trường Tài chính Tiền tệ](https://thitruongtaichinhtiente.vn/nhung-uu-dai-dac-biet-tu-su-ket-hop-bidv-casso-63115.html)

**Tingee (HENO) — đối thủ mới hơn, mới xác nhận một phần**
- Open API REST (open-api.tingee.vn), ký request bằng HMAC-SHA512 trên timestamp+body (header `x-signature`), hỗ trợ liên kết tài khoản/VA, QR, Pay by Bank, hộp loa, thu hộ, chi hộ; danh sách ngân hàng và giá không có trong trang lấy được. — [Tingee developers](http://developers.tingee.vn/docs/banking/get-banks/)

**API ngân hàng trực tiếp**
- OCB có cổng developer riêng với nhóm API doanh nghiệp (chuyển tiền theo lô, truy vấn trạng thái). Không tìm thấy tài liệu tương đương công khai cho MB, Techcombank trong lần tìm này. — [OCB developer](https://developer.api.ocb.com.vn/corporates/v2/en)

### Inferences
- Cả SePay (Bank Hub) và Casso đều là tầng tổng hợp (aggregator) trên API ngân hàng chính thức + phần còn lại; với đa tenant, giá theo "giao dịch" rất có lợi vì mỗi tenant 5-30 sale chỉ có vài trăm giao dịch cọc/tháng.
- Cả hai đều yêu cầu khử trùng theo `id` và có cơ chế đối soát lại bằng API; thiết kế SalesMind cần cả webhook lẫn job polling (pg-boss cron) để vá giao dịch bị sót.
- Độ trễ thực tế "vài giây" (SePay) phụ thuộc ngân hàng; với ngân hàng không có API chính thức/RPA (Casso) độ trễ theo lịch có thể là phút. Chưa có số đo độc lập.

### Gaps
- Giá Casso Flow (VND), giới hạn tài khoản, danh sách ngân hàng Standard/Pioneer/Sponsor: trang chỉ trả về "Đang tải".
- Đơn giá giao dịch vượt gói của SePay FREE; bảng ánh xạ bậc giao dịch ↔ giá STARTUP.
- Giá/điều khoản/quota của SePay Bank Hub và hợp đồng đối tác cho SaaS đa tenant; Casso có chương trình tương đương hay không.
- Cơ chế chính xác SePay/Casso "RPA" lấy dữ liệu với ngân hàng không có API chính thức (SMS, email, app scraping hay đăng nhập thay) và tính hợp pháp/ToS của nó: không tìm thấy tài liệu công khai.
- Pay2S, Web2M, các dịch vụ khác: tìm kiếm không trả về nguồn nào; chưa đánh giá.
- API ngân hàng trực tiếp của MB, Techcombank, ACB, BIDV, VietinBank cho doanh nghiệp: chưa tìm được tài liệu công khai trong lần này (BIDV VA Billing chỉ ở mức tin tức).
- SLA, uptime, sự cố gần đây của SePay/Casso: không tìm thấy dữ liệu độc lập.

---

## Q2. VietQR / NAPAS 247: QR động có số tiền + nội dung duy nhất; giới hạn nội dung; ngân hàng có đổi nội dung không

### Takeaway
VietQR trên chuẩn NAPAS 247 cho phép nhúng số tiền và nội dung vào QR, nhưng nội dung ngắn (19 ký tự không dấu theo một API VietQR; 50 chữ theo quick link img.vietqr.io) và một số app ngân hàng cho phép khách sửa nội dung, nên mã đơn hàng chỉ là "tín hiệu khớp", không phải bằng chứng duy nhất. Cách bền hơn là tài khoản ảo (VA) theo đơn/khách để định danh theo tài khoản nhận thay vì nội dung.

### Cited Findings
- NAPAS FastFund 247 + VietQR cho phép chuyển tiền liên ngân hàng bằng quét mã QR; mã mã hóa số tài khoản, mã ngân hàng, số tiền, nội dung. — [NAPAS FastFund 247 with VietQR](https://en.napas.com.vn/napas-fastfund-247-with-vietqr-code-service); [Tuổi Trẻ](https://tuoitre.vn/chuyen-tien-khong-can-nhap-so-tai-khoan-2021061522132852.htm)
- img.vietqr.io Quick Link: `https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-<TEMPLATE>.svg?amount=&addInfo=&accountName=`; `ACCOUNT_NO` chữ/số tối đa 19 ký tự (hỗ trợ alias và VA); `amount` số dương tối đa 13 chữ số; `addInfo` tối đa 50 ký tự, không ký tự đặc biệt (fetch mô tả "chữ", chưa rõ có cho số không, thực tế mã đơn thường có số, cần thử); `accountName` không thuộc chuẩn VietQR chỉ hiện trên ảnh; template gồm `compact2`, `compact`, `qr_only`, `print`, `payos`, `vietqr_pro`...; giới hạn 10 QR/10 giây/IP; trang không nói về giá. — [VietQR Quick Link](https://www.vietqr.io/danh-sach-api/link-tao-ma-nhanh)
- API generate của một nhà cung cấp VietQR khác (api.vietqr.vn): `content` bắt buộc, tối đa 19 ký tự, tiếng Việt không dấu, không ký tự đặc biệt; `orderId` cùng giới hạn; `amount` bắt buộc khi `qrType` là 0 hoặc 3. Đây là giới hạn của API này, chưa phải chuẩn NAPAS. — [VietQR API generate](https://api.vietqr.vn/cn/cn/api-vietqr-callback/goi-api-generate-vietqr-code)
- Tài liệu kỹ thuật VietinBank (theo bản tóm tắt tìm kiếm, chưa mở được PDF gốc) cảnh báo một số app ngân hàng cho phép người dùng sửa nội dung chuyển khoản trong mã QR (ví dụ MB Bank, VIB, Sacombank), nên đối soát chỉ theo nội dung là rủi ro. — [VietinBank: thu hộ định danh gắn mã VietQR](https://developer.vietinbank.vn/vtb/openbanking/system/files/2026-03/VIETINBANK_Thu%20h%E1%BB%99%20%C4%91%E1%BB%8Bnh%20danh%20g%E1%BA%AFn%20m%C3%A3%20VietQR.pdf) (redirect về openapi.vietinbank.vn khi mở trực tiếp)
- SePay QR dùng tham số `acc`, `bank`, `amount`, `des` và nêu mã thanh toán nên duy nhất và khó đoán; tài liệu không nêu giới hạn độ dài/ký tự của `des`. Lưu ý: bản fetch hiển thị host ảnh là `vietqr.app/img` trong khi docs nói trang tạo là `qr.sepay.vn` (có mâu thuẫn host, cần xác nhận bằng cách đọc docs gốc). — [SePay: tạo QR](https://developer.sepay.vn/en/sepay-webhooks/tao-qr-va-form-thanh-toan); [qr.sepay.vn](https://qr.sepay.vn)
- VietQR Pro (nhúng sẵn thông tin người nhận, số tiền, nội dung vào mã để giảm lỗi nhập sai nội dung) được Sapo triển khai. — [Sapo VietQR Pro](https://www.sapo.vn/cap-nhat-tinh-nang/lay-ma-chuyen-khoan-VietQR-Pro)
- Từ 01/03/2026 có quy định chuẩn hóa tài khoản nhận tiền của hộ kinh doanh; từ Nghị định 68/2026/NĐ-CP hộ kinh doanh phải thông báo cho cơ quan thuế các tài khoản dùng kinh doanh (theo MoMo; nguồn thứ cấp). — [MoMo cập nhật giải pháp nhận tiền](https://www.momo.vn/tin-tuc/thong-cao-bao-chi/momo-cap-nhat-moi-nhat-ve-giai-phap-nhan-tien-8587)

### Inferences
- Thiết kế an toàn: mã cọc ngắn (<= 12-15 ký tự, chữ hoa+số, không dấu, ví dụ tiền tố tenant + số ngắn), không dựa vào độ dài vượt 19 ký tự, và luôn coi nội dung là có thể bị mất/bị sửa. Số tiền chính xác trong QR giúp khớp khi khách không sửa.
- VA theo đơn (SePay có "tài khoản ảo theo đơn hàng") cho khớp mạnh hơn nhưng phụ thuộc ngân hàng hỗ trợ.

### Gaps
- Giới hạn chính thức của NAPAS/EMVCo cho trường nội dung (Additional Data Field, tag 62 sub-tag 08): không tìm được nguồn chính thức trong lần này; con số 19 và 50 trên đây là của các nhà cung cấp cụ thể. (Kiến thức nền, chưa xác minh: EMVCo QR thường giới hạn trường này ở 25 ký tự; không dùng làm căn cứ.)
- Danh sách cụ thể ngân hàng nào cắt/sửa/bỏ dấu nội dung, ngân hàng nào chặn khách sửa nội dung: chỉ có đề cập MB, VIB, Sacombank cho phép sửa (nguồn thứ cấp).
- img.vietqr.io miễn phí hay có SLA thương mại: trang không nói; nên tự dựng QR (thư viện EMVCo) để không phụ thuộc dịch vụ ngoài.

---

## Q3. Thuật toán đối soát (khớp theo mã, số tiền, cửa sổ thời gian; trả thiếu/thừa/nhiều lần/thiếu mã; idempotency)

### Takeaway
Các nhà cung cấp tự khuyến nghị: khử trùng theo id giao dịch (UNIQUE), kiểm tra số tiền thực nhận so với đơn, và đối soát định kỳ bằng API để bù webhook sót. Phần khớp mờ (thiếu mã, trả nhiều lần, thừa/thiếu) không có chuẩn công bố; cần tự thiết kế theo nguyên tắc "AI/hệ thống đề xuất, người xác nhận".

### Cited Findings
- SePay: webhook có thể không tới (server down, timeout, hết số lần retry); đối soát bằng `since_id` hoặc khoảng thời gian; kiểm tra trùng bằng `id`/`reference_number` + UNIQUE `sepay_id`; backfill giao dịch bị sót rồi chạy lại logic nghiệp vụ. — [SePay: đối soát giao dịch](https://developer.sepay.vn/en/sepay-webhooks/doi-soat-giao-dich)
- SePay: nên kiểm tra `transferAmount` với số tiền đơn hàng; có tùy chọn bỏ qua giao dịch không có mã (`skip_if_no_code`), chỉ nhận giao dịch từ VA, lọc tiền tố. — [SePay: bắt đầu nhanh](https://developer.sepay.vn/en/sepay-webhooks/bat-dau-nhanh); [SePay webhooks](https://developer.sepay.vn/en/sepay-webhooks)
- Casso: khử trùng theo `id`; dùng API giao dịch để kiểm tra giao dịch sót; webhook trả 200 trong 5 giây; payload có thông tin người chuyển (`corresponsiveName`, `corresponsiveAccount`, `corresponsiveBankName`) có thể dùng làm tín hiệu đối chiếu. — [Casso: thiết lập webhook thủ công](https://developer.casso.vn/english-v2-new/webhook/thiet-lap-webhook-thu-cong.md)
- payOS: webhook có `orderCode`, `reference`, `counterAccount*`; payOS tự khớp theo `orderCode` vì tạo payment link/VA riêng cho đơn. — [payOS: dữ liệu webhook](https://payos.vn/docs/du-lieu-tra-ve/webhook/); [payOS docs](https://payos.vn/docs/)

### Inferences (khuyến nghị thiết kế, không phải sự kiện có nguồn)
- Bảng `bank_transactions` lưu thô mọi giao dịch tiền vào theo (tenant, provider, provider_tx_id) UNIQUE; webhook chỉ ghi và enqueue (đúng quy tắc 5 giây của dự án); worker pg-boss chạy matching; cron đối soát mỗi giờ + ngay trước khi báo "cọc đủ".
- Khớp theo thang điểm: (1) mã đơn trong nội dung (chuẩn hóa hoa/thường, bỏ dấu cách/ký tự lạ, tolerant một ký tự sai) + (2) số tiền = cọc kỳ vọng + (3) cùng tài khoản nhận của tenant + (4) trong cửa sổ hiệu lực (ví dụ từ lúc gửi yêu cầu cọc tới hạn). Đủ 4 thì "đề xuất xác nhận mạnh"; vẫn để người xác nhận trước khi chuyển trạng thái đơn.
- Trả thiếu/nhiều lần: cộng dồn giao dịch khớp mã theo đơn, so sánh với tổng cọc; trả thừa: đề xuất xác nhận và đánh dấu "thừa X đồng" cho người quyết; thiếu mã nhưng đúng số tiền duy nhất trong cửa sổ và đúng tên người gửi như hồ sơ khách: đưa vào hàng đợi "gợi ý khớp", không tự khớp; không khớp được: "giao dịch mồ côi" cho người xử lý.
- Dùng số tiền hơi lẻ duy nhất (ví dụ cộng 0-99đ) là mẹo được dùng rộng rãi ở các hệ thống khác nhưng chưa có nguồn trong lần này và làm lệch số tiền cọc đã báo khách, nên cân nhắc/bỏ.
- Cửa sổ thời gian: chỉ nhận giao dịch có `transactionDate` >= thời điểm tạo yêu cầu cọc; giữ UTC+7 rõ ràng khi parse thời gian của provider (SePay dùng chuỗi "YYYY-MM-DD HH:mm:ss" không có múi giờ).

### Gaps
- Không có nguồn công khai về tỷ lệ khớp thực tế hay thực hành của các hệ thống VN cho trả nhiều lần/trả thừa; các điểm trên là thiết kế đề xuất.
- Múi giờ chính xác của `transactionDate` SePay chưa xác nhận trong docs (chuỗi không kèm múi giờ).

---

## Q4. AI đọc ảnh bill: mô hình vision/OCR hiện tại, độ chính xác, chi phí, kiểu gian lận bill giả ở VN, phát hiện; vai trò khi không có kết nối ngân hàng

### Takeaway
Không có benchmark công khai cho ảnh chụp màn hình app ngân hàng VN; chi phí đọc bill bằng LLM vision cực thấp (cỡ vài đồng đến vài chục đồng/ảnh theo giá token công bố), nhưng ảnh bill giả rất dễ làm (nhập số tài khoản + số tiền vào web là có bill) và nguồn chính thống đều khuyên chỉ giao hàng khi tiền đã vào tài khoản. Vì vậy OCR chỉ làm tín hiệu phụ và bước điền sẵn thông tin cho người xác nhận, không bao giờ là bằng chứng.

### Cited Findings
- Giá API (USD/1 triệu token, trang chính thức, thời điểm 2026-11): Claude Haiku 5.5 $0.10 vào / $0.50 ra (prompt tới 100k token); Claude Sonnet 5.5 $2 / $10; Claude Haiku 4.5 $1 / $5. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Gemini API (Standard, USD/1 triệu token): `gemini-3.5-flash-lite` $0.30 vào (text/ảnh/video/audio) / $2.50 ra; `gemini-3.1-flash-lite` $0.25 / $1.50; `gemini-3.8-flash` và `gemini-3.6-flash` $0.75 / $3.75 (tăng lên $1.50 / $7.50 từ 01/01/2027); `gemini-2.5-flash` định tuyến sang `gemini-3.5-flash-lite` từ 01/12/2026. — [Gemini API pricing](https://aistudio.google.com/docs/pricing)
- Không tìm thấy benchmark nào đo riêng ảnh bill chuyển khoản VN. Số liệu gần nhất: trên bộ hóa đơn/biên lai tổng quát (Braintrust, 2024), Gemini 1.5 Pro 91,15% "factuality" so với GPT-4o 84,40% (mô hình cũ, thước đo khác); một hướng dẫn CodeSOTA nêu Gemini 2.5 Pro 93% trên trích xuất hóa đơn nhưng không nêu phương pháp. Một nhà phát triển bot đọc biên lai báo OCR thường bỏ sót tổng tiền ở ảnh chụp màn hình và Gemini qua bên thứ ba trả JSON không parse được ~5/8 lần (giai thoại, không rõ phiên bản mô hình). — [Braintrust Gemini evals](https://www.braintrust.dev/evals/gemini); [CodeSOTA](https://codesota.com/guides/invoice-processing-vllm); [Google AI forum](https://discuss.ai.google.dev/t/how-to-reliably-extract-date-and-amount-from-poor-quality-photos-of-digital-receipts/184001)
- Một nhà cung cấp VN đề xuất ngưỡng độ chính xác OCR chứng từ ngân hàng >97% là tốt và >93% là tối thiểu sản xuất, và nêu lo ngại lưu trú dữ liệu khi gửi chứng từ ngân hàng lên nền tảng nước ngoài (nguồn của nhà bán dịch vụ). — [GreenNode](https://greennode.ai/blog/ocr-and-automated-document-processing-solutions-for-bank)
- Gian lận bill giả: nhóm Facebook và app làm bill giả cho "mọi ngân hàng" theo yêu cầu; kẻ gian chọn hàng, chuyển khoản, gửi ảnh bill đã chỉnh sửa, shop giao hàng khi chưa kiểm tra số dư; lạm dụng tính năng chuyển tiền hẹn giờ; khuyến cáo: không giao hàng khi chưa nhận tiền trong tài khoản dù có ảnh chụp. — [Pháp luật TP.HCM (12/04/2023, nguồn cũ)](https://tuoitre.vn/plo/ngan-hang-canh-bao-chieu-tro-gia-mao-bien-lai-chuyen-khoan-post728401.html)
- Công cụ tạo bill giả chỉ cần nhập số tài khoản người nhận và số tiền; dấu hiệu nhận biết ở bill giả: tên website lạ ở cuối bill, mã giao dịch; chiêu "shop chưa kích hoạt ví, phải gọi tổng đài". — [Thanh Tra](https://thanhtra.com.vn/an-ninh-trat-tu-D718A18CA/chieu-tro-gia-mao-bien-lai-chuyen-tien-thanh-cong-trong-mua-ban-4E5E056E.html); [Hoàng Hà Mobile](https://hoanghamobile.com/tin-tuc/cach-nhan-biet-cac-bill-chuyen-khoan-gia-khi-giao-dich/) (cả hai là báo/bán lẻ, chất lượng nguồn vừa)
- Hướng phát hiện ảnh bị sửa: Error Level Analysis (mức nén), kiểm tra phông chữ trộn, giữ lại chứng từ nghi vấn và cảnh báo; đây là mô tả của một bài kỹ thuật chung về hóa đơn, không riêng bill ngân hàng VN. — [Viblo: AI phát hiện gian lận hóa đơn](https://viblo.asia/p/ai-phat-hien-gian-lan-va-sai-lech-hoa-don-tu-dong-AWVpXj9PV05)
- Phía ngân hàng đã bổ sung cảnh báo khi quét VietQR và xác thực sinh trắc học khi chuyển tiền; deepfake đã vượt được một số hệ thống eKYC. (Bối cảnh chống gian lận người chuyển, không phải xác minh bill.) — [Thị trường Tài chính Tiền tệ](https://thitruongtaichinhtiente.vn/print/86650.html); [VnEconomy](https://vneconomy.vn/techconnect/dung-ai-deepfake-lua-dao-giong-that-den-muc-chuyen-gia-cung-co-the-mac-bay.htm)

### Inferences
- Chi phí ước tính (phép tính của tôi, không phải số liệu nhà cung cấp): một ảnh bill khoảng 1.000-1.600 token vào + ~200 token ra; với Haiku 5.5 giá công bố thì thấp hơn 0,001 USD/ảnh; với Gemini 3.5 Flash-Lite khoảng 0,0003-0,001 USD/ảnh. Chi phí không phải ràng buộc; độ chính xác và chống giả mạo mới là vấn đề. Số token ảnh phải đo thực tế.
- Nên dùng đầu ra có cấu trúc (schema chặt: số tiền VND nguyên, thời gian, tên người gửi/nhận, số tài khoản nhận che giữa, mã giao dịch, nội dung, tên ngân hàng/app, độ tự tin từng trường + câu/vùng gốc làm căn cứ) và kiểm tra chéo: số tiền trong chữ vs số, tài khoản nhận khớp tài khoản tenant, thời gian hợp lý. Khớp nguyên tắc dự án "kèm câu gốc".
- Tín hiệu rủi ro bổ sung có thể tính: mã giao dịch trong bill đã dùng cho đơn khác (băm ảnh/perceptual hash trùng), bill gửi ngay sau khi nhắc cọc nhưng chưa có giao dịch tương ứng trong phút kế tiếp, siêu dữ liệu ảnh (ảnh Messenger thường bị gỡ EXIF nên yếu), tỉ lệ giao dịch khớp ngay sau đó. Không có nguồn xác nhận hiệu quả của từng tín hiệu.
- Khi không có kết nối ngân hàng: dùng OCR chỉ để điền sẵn form "xác nhận thủ công" cho nhân viên đối chiếu với app ngân hàng của chính họ (đúng khuyến cáo nguồn báo chí), ghi nhận người xác nhận + thời gian (audit); trạng thái hiển thị riêng "đã xác nhận thủ công" khác "đã khớp biến động số dư".

### Gaps
- Không có benchmark công khai về độ chính xác của Claude/Gemini/GPT hoặc OCR VN (FPT.AI, VNPT, Viettel, Google Document AI...) trên bill app ngân hàng VN; cần tự đo bằng bộ ảnh gán nhãn.
- Không tìm thấy giá/chi tiết dịch vụ OCR chuyên biệt VN (FPT.AI, VNPT SmartReader...) trong lần này.
- Không tìm thấy thống kê 2025-2026 về tỷ lệ bill giả hay các thủ đoạn mới (nguồn tìm được là 2023 hoặc tin tiêu dùng); không có tài liệu chính thức từ NHNN hay ngân hàng về cách tra cứu xác thực một biên lai bằng mã giao dịch.
- Hiệu quả thực của ELA/phát hiện chỉnh sửa trên ảnh chụp màn hình app ngân hàng: không có nguồn.

---

## Q5. Pháp lý: Thông tư 64/2024/TT-NHNN (Open API), đồng ý của khách, luật bảo vệ dữ liệu cá nhân

### Takeaway
Thông tư 64/2024/TT-NHNN (hiệu lực 01/03/2025) cho phép ngân hàng cung cấp Open API cho bên thứ ba có hợp đồng, với yêu cầu đồng ý của khách, có công cụ thu hồi đồng ý, giới hạn thời hạn truy vấn dữ liệu (tối đa 180 ngày trừ khi thỏa thuận khác) và bảo mật mức tối thiểu; nhóm API tới bên thứ ba bị giới hạn theo Điều 5-6 (chi tiết cần đọc văn bản gốc). Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 và Nghị định 356/2025/NĐ-CP (đều hiệu lực 01/01/2026) áp dụng cho SalesMind khi lưu dữ liệu giao dịch/ảnh bill chứa thông tin cá nhân của người mua.

### Cited Findings
- TT 64/2024/TT-NHNN ký 31/12/2024, hiệu lực 01/03/2025; gồm Open API cơ bản và Open API khác; chi tiết kỹ thuật ở Phụ lục 01 (danh mục) và 02 (API khác). Theo Điều 5 ngân hàng chỉ được cung cấp nhóm API thuộc điểm c khoản 1 Điều 6 cho bên thứ ba là ngân hàng hoặc tổ chức cung ứng dịch vụ trung gian thanh toán (theo bản tóm tắt của thuvienphapluat, cần đối chiếu văn bản gốc). — [thuvienphapluat: Open API là gì](https://thuvienphapluat.vn/hoi-dap-phap-luat/open-api-la-gi-nguyen-tac-trien-khai-open-api-tu-ngay-132025-138042814.html); [Tạp chí Ngân hàng](https://tapchinganhang.gov.vn/bao-dam-an-toan-trong-viec-ket-noi-va-xu-ly-du-lieu-cua-khach-hang-khi-trien-khai-open-api-15537.html); [SBV](https://sbv.gov.vn/en/w/open-api-tr%E1%BB%A5c-k%E1%BA%BFt-n%E1%BB%91i-m%E1%BB%9Bi-c%E1%BB%A7a-h%E1%BB%87-sinh-th%C3%A1i-t%C3%A0i-ch%C3%ADnh-s%E1%BB%91-vi%E1%BB%87t-nam)
- Nghĩa vụ trong TT 64 (theo Tạp chí Ngân hàng): bên thứ ba là tổ chức/ngân hàng có hợp đồng với ngân hàng; hợp đồng tối thiểu nêu bảo mật, phạm vi dùng dữ liệu, thông báo sự cố, phí, mức an toàn hệ thống, quyền truy cập, chấm dứt; dữ liệu cá nhân của khách chỉ xử lý cho chính khách đó và đúng mục đích hợp đồng; ngân hàng và bên thứ ba đều phải có công cụ để khách tra cứu dữ liệu đã ủy quyền và rút lại đồng ý; thời hạn truy vấn sau khi đồng ý tối đa 180 ngày trừ khi ngân hàng và khách thỏa thuận khác; hệ thống Open API ít nhất cấp độ 3 theo quy định an toàn thông tin; ghi nhật ký truy cập bên thứ ba tối thiểu 3 tháng, sao lưu tối thiểu 1 năm; giới hạn số truy vấn tự động; bên thứ ba thông báo sự cố kịp thời và hệ thống của bên thứ ba phải được đánh giá, phân loại cấp độ an toàn. — [Tạp chí Ngân hàng](https://tapchinganhang.gov.vn/bao-dam-an-toan-trong-viec-ket-noi-va-xu-ly-du-lieu-cua-khach-hang-khi-trien-khai-open-api-15537.html); [thuvienphapluat: Open API](https://thuvienphapluat.vn/hoi-dap-phap-luat/open-api-la-gi-nguyen-tac-trien-khai-open-api-tu-ngay-132025-138042814.html)
- Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 (thông qua 26/06/2025) hiệu lực 01/01/2026; Nghị định 356/2025/NĐ-CP (31/12/2025) hướng dẫn, thay thế Nghị định 13/2023; chủ thể dữ liệu có quyền biết, đồng ý/không đồng ý, rút lại đồng ý, truy cập, sửa, xóa, hạn chế xử lý; Điều 19 nêu các trường hợp không cần đồng ý; cấm mua bán dữ liệu cá nhân; Điều 18 NĐ 356 siết điều kiện chuyển dữ liệu xuyên biên giới; hồ sơ đánh giá tác động theo Mẫu số 10; NĐ 330/2026/NĐ-CP (19/08/2026) quy định xử phạt vi phạm trong an ninh mạng và bảo vệ dữ liệu cá nhân. — [Hà Tĩnh gov](https://hatinh.gov.vn/vi/bai-viet/luat-bao-ve-du-lieu-ca-nhan-chinh-thuc-co-hieu-luc-thi-hanh-tu-ngay-112026); [thuvienphapluat Luật 91/2025](https://thuvienphapluat.vn/van-ban/Bo-may-hanh-chinh/Luat-Bao-ve-du-lieu-ca-nhan-2025-so91-2025-QH15-625628.aspx); [thuvienphapluat NĐ 356](https://thuvienphapluat.vn/van-ban/Quyen-dan-su/Nghi-dinh-356-2025-ND-CP-huong-dan-Luat-Bao-ve-du-lieu-ca-nhan-687428.aspx); [luatvietnam: mẫu hồ sơ đánh giá tác động](https://luatvietnam.vn/bieu-mau/mau-thong-bao-gui-ho-so-danh-gia-tac-dong-xu-ly-du-lieu-ca-nhan-571-106386-article.html); [EY: NĐ 330](https://www.ey.com/content/dam/ey-unified-site/ey-com/vi-vn/technical/tax/documents/ey-vn-decree-330-providing-sanctions-for-personal-data-protection.pdf); [PwC 01/2026](https://www.pwc.com/vn/vn/publications/2026/20260128-new-rules-personal-data-protection.pdf)
- Điều khoản ACB–SePay: khách tự chịu rủi ro khi kết nối, ACB miễn trách nhiệm (xem Q1). Hosted Link của SePay Bank Hub thể hiện đồng ý của chủ tài khoản ngay trong luồng liên kết và hỗ trợ hủy liên kết. — [Thỏa thuận ACB–SePay](https://acb.com.vn/acbwebsite/files/Tho%CC%89a%20thua%CC%A3%CC%82n%20%C4%91a%CC%86ng%20ky%CC%81%20di%CC%A3ch%20vu%CC%A3%20ta%CC%80i%20khoa%CC%89n%20%C4%91i%CC%A3nh%20danh%20-%20SEPAY.pdf); [SePay Bank Hub](https://developer.sepay.vn/en/bankhub/tong-quan)

### Inferences
- SalesMind không cần tự trở thành "bên thứ ba Open API": nếu dùng SePay/Casso/Tingee làm đơn vị trung gian, chủ tài khoản (tenant) ủy quyền cho họ, SalesMind chỉ nhận webhook. Cần hợp đồng xử lý dữ liệu (SalesMind là bên xử lý, tenant là bên kiểm soát) và điều khoản đồng ý/thông báo cho người mua về việc lưu giao dịch và ảnh bill.
- Với chuỗi này, nội dung chuyển khoản và tên người gửi là dữ liệu cá nhân; chỉ lưu trường cần thiết, che số tài khoản, đặt thời hạn lưu giữ; nếu dùng LLM nước ngoài để đọc ảnh bill, cần đánh giá chuyển dữ liệu xuyên biên giới (Điều 18 NĐ 356) hoặc dùng mô hình trong nước/triển khai tại VN.
- Cần cảnh giác với dịch vụ trung gian lấy dữ liệu bằng đăng nhập thay/SMS: khác với Open API có hợp đồng ngân hàng, rủi ro ToS ngân hàng và rủi ro lộ thông tin xác thực; ưu tiên kết nối chính thức.

### Gaps
- Nội dung nguyên văn Điều 5, 6, 8, 12 của TT 64 (các nguồn tìm được là bản tóm tắt; trang văn bản gốc không trả nội dung); nhóm API cơ bản nào dành cho bên thứ ba không phải ngân hàng/trung gian thanh toán.
- Việc TT 64/2024 đã được sửa đổi hay thay thế đến 11/2026: không thấy dấu hiệu nhưng chưa tra cứu cụ thể (kết quả tìm kiếm cho thấy bài VNBA ngày 30/07/2026 về chia sẻ dữ liệu mở nhưng chưa đọc).
- Quy định của NHNN về dịch vụ "chia sẻ biến động số dư" của bên thứ ba không có hợp đồng Open API, SMS/RPA: không tìm thấy văn bản.
- Dữ liệu tài chính có thuộc "dữ liệu cá nhân nhạy cảm" theo NĐ 356 và hệ quả (đánh giá tác động, DPO) cho SaaS: chưa đọc điều khoản cụ thể.
- Bản dịch/phân tích luật là từ trang tư vấn, không phải văn bản gốc; cần luật sư VN rà soát.

---

## Q6. Cổng thanh toán thay thế (payOS, VNPay, MoMo, ZaloPay link) cho tiền cọc: phí và mức phù hợp so với chuyển khoản thuần

### Takeaway
payOS giữ nguyên mô hình chuyển khoản (tiền về thẳng tài khoản, mỗi đơn có payment link/mã riêng) nên nhận về được độ khớp tự động mạnh mà không có phí MDR thẻ; còn ví/cổng thẻ (MoMo, VNPay) có phí theo giao dịch nhưng tôi không tìm được biểu phí hiện hành. Chưa có số liệu để kết luận cổng nào tốt hơn về chi phí, chỉ có thể kết luận về mô hình.

### Cited Findings
- payOS tuyên bố không tính phí trung gian thanh toán kiểu cổng truyền thống ("tiết kiệm tới 99%"), Pro/BIDV-1K miễn phí 1.000 giao dịch/năm đến 31/12/2026; không có bảng phí vượt gói; tiền về thẳng tài khoản ngân hàng; đăng ký bằng CCCD, không cần giấy phép kinh doanh (cá nhân/MMO được). — [payOS](https://payos.vn)
- payOS: link thanh toán gửi qua mạng xã hội không cần website/app; webhook + returnUrl báo kết quả; chương trình affiliate cho nhà phát triển (rebate 100đ/giao dịch). — [payOS](https://payos.vn); [payOS docs](https://payos.vn/docs/)
- PayOn của Sapo (cổng khác, để tham chiếu mức phí cổng thanh toán): phí thanh toán ngay 0,55%-2,4% trên đơn thành công. — [Sapo PayOn](https://www.sapo.vn/blog/cong-thanh-toan-payon)
- Mô hình A2A (VietQR/open banking) thường rẻ hơn cổng thẻ cho thanh toán VND nội địa (nhận định chung từ blog nhà cung cấp, không riêng payOS). — [Airwallex](https://www.airwallex.com/vn/blog/cong-thanh-toan-truc-tuyen-la-gi-huong-dan-2026)
- MoMo: từ 01/03/2026 mã QR nhận tiền doanh nghiệp ứng với tài khoản nhận tiền theo tên hộ kinh doanh; từ 19/03/2026 liên kết loa MoMo với tài khoản ngân hàng hộ KD. Biểu phí merchant MoMo/VNPay/ZaloPay cho link thanh toán: không tìm thấy. — [MoMo](https://www.momo.vn/tin-tuc/thong-cao-bao-chi/momo-cap-nhat-moi-nhat-ve-giai-phap-nhan-tien-8587)

### Inferences
- Với tiền cọc 50% của đơn hàng nhỏ/vừa, payOS (hoặc VA theo đơn do SePay/Casso cung cấp) cho độ khớp tự động mạnh nhất mà không đổi thói quen chuyển khoản của khách VN; phần "ảnh bill" gần như không còn cần thiết vì xác nhận đến từ webhook đã ký.
- Nhược điểm: mỗi tenant phải đăng ký tài khoản payOS/kênh thu riêng (KYC từng tenant), hạn mức 1.000 giao dịch/năm của gói miễn phí không đủ cho tenant lớn; ràng buộc tài khoản ngân hàng liên kết (BIDV/MB... theo đối tác); chưa rõ chính sách payOS cho nền tảng SaaS đa tenant. Nên giữ chuyển khoản + QR VietQR làm đường chính và coi payment link là tùy chọn.

### Gaps
- Biểu phí hiện hành của payOS (vượt gói), MoMo, VNPay, ZaloPay cho payment link/QR; chính sách đa merchant (master merchant) cho SaaS; thời gian đối soát/chi trả; hạn mức giao dịch; hoàn tiền/chargeback. Không tìm thấy trang phí chính thức (payos.vn/bang-gia trả 404).
- Danh sách ngân hàng hỗ trợ của payOS (FAQ bị ẩn khi fetch).

---

## Q7. Kiến trúc đề xuất cho SalesMind (tổng hợp, suy luận từ các mục trên)

### Takeaway
Nguyên tắc: "ảnh bill chỉ là gợi ý, biến động số dư có chữ ký từ nhà cung cấp là bằng chứng, người xác nhận quyết định". Dùng một lớp "payment provider adapter" để cắm SePay (ưu tiên), Casso, payOS/Tingee về sau; không tự xây kết nối ngân hàng.

### Cited Findings
- Các tính chất nền tảng của adapter (HMAC có raw body, timestamp, dedupe theo id, timeout 5 giây, retry, polling đối soát) đã được ghi ở Q1 và Q3 với nguồn tương ứng: [SePay xác thực](https://developer.sepay.vn/en/sepay-webhooks/xac-thuc), [SePay đối soát](https://developer.sepay.vn/en/sepay-webhooks/doi-soat-giao-dich), [Casso webhook](https://developer.casso.vn/english-v2-new/webhook/thiet-lap-webhook-thu-cong.md), [Casso verify V2](https://github.com/CassoHQ/casso-webhook-v2-verify-signature).

### Inferences
1. Cấu hình theo tenant: bảng `tenant_bank_accounts` (provider, account_no mã hóa, secret webhook mã hóa AES-256-GCM như page token, tiền tố mã cọc). Mỗi tenant có endpoint webhook riêng `/webhooks/bank/:provider/:tenantKey` (khóa bí mật khó đoán) hoặc một endpoint chung định tuyến theo tài khoản nhận.
2. Ingestion (đúng quy tắc dự án): Fastify giữ raw body, kiểm tra chữ ký/Api key theo provider (SePay: `{timestamp}.{raw_body}` HMAC-SHA256, dung sai ±300s; Casso V2: sắp xếp khóa `data` + `t.`+JSON, SHA-512 keyed; so sánh timing-safe), ghi `bank_transactions` với UNIQUE (provider, provider_tx_id) rồi enqueue pg-boss, trả 200 ngay. Không bỏ im lặng: lỗi ghi thì để provider retry (trả 5xx) hoặc dead-letter.
3. Reconciler: cron pg-boss mỗi 15-60 phút gọi API giao dịch của provider (SePay `since_id`, ≤3 req/s) để vá giao dịch sót; chạy thêm một lần khi nhân viên bấm "kiểm tra cọc".
4. Matcher (Q3): tạo `payment_match_proposals` với điểm và lý do; trạng thái đơn chỉ đổi sau khi người dùng xác nhận (hoặc quy tắc tenant bật "tự xác nhận khi khớp 4/4", mặc định tắt).
5. QR: tự sinh payload VietQR (EMVCo) tại server hoặc dùng img.vietqr.io làm phương án nhanh; mã cọc <=12-15 ký tự, chữ hoa+số, tiền tố tenant; số tiền cố định theo cọc.
6. Bill ảnh: lưu ảnh, chạy vision LLM với schema chặt, lưu `bill_extractions` kèm câu/vùng gốc; hiển thị cạnh gợi ý khớp; trạng thái "đã nhận bill, chưa thấy tiền vào" tới khi có giao dịch khớp; nếu tenant không có kết nối ngân hàng thì cho "xác nhận thủ công" có audit.
7. Chống gian lận: không bao giờ chuyển "đã cọc" từ ảnh; chặn trùng mã giao dịch/perceptual hash giữa các đơn; cảnh báo bill đến mà chưa có giao dịch sau N phút; log người xác nhận.
8. Pháp lý/dữ liệu: ghi nhận hợp đồng xử lý dữ liệu với tenant, thời hạn lưu giữ, che dữ liệu nhạy cảm trong log (đã có quy tắc không log nội dung tin nhắn), đánh giá chuyển dữ liệu ra nước ngoài khi dùng LLM đám mây.

### Gaps
- Chưa xác nhận SePay Bank Hub có phù hợp mô hình "SalesMind là phần mềm, tenant là chủ tài khoản" về hợp đồng/giá; cần liên hệ SePay/Casso để hỏi (phỏng vấn đối tác là bước ngoài phạm vi nghiên cứu web).
- Chưa kiểm chứng thực nghiệm độ trễ webhook, độ chính xác OCR, và việc ngân hàng cắt/sửa nội dung; nên làm thử nghiệm với tài khoản thật ở 3-4 ngân hàng (MB, VCB, ACB, Techcombank/BIDV) trước khi cam kết.
