# Kế hoạch test AI (Claude thật) không qua giao diện

Mục tiêu: biết AI trích xuất và đọc bill **đúng đến đâu, nhanh đến đâu, tốn bao nhiêu**, trước khi cho chạy qua đường ống thật (Facebook, hàng đợi, UI). Tiết kiệm credit là ràng buộc cứng.

Trạng thái: **đã thực hiện 2026-11-11** (bước 1, 2, 3 đều đạt; kết quả ở `PROGRESS.md`, dòng AI-live-1). Khác kế hoạch: biến `EVAL_MAX_TOKENS` và `EVAL_TOKEN_BUDGET` đặt trong script (không thêm vào schema `.env`); `--only` dùng ca-không-phân-biệt-hoa-thường theo tên.

## 0. Ràng buộc
- Chỉ dùng câu tự viết (12 hội thoại trong `backend/scripts/eval-extraction.ts`) và 3 ảnh trong `backend/demo-assets/`. Không dùng tin của khách thật (dữ liệu ra API nước ngoài; chưa có kiểm tra pháp lý Luật 91/2025/QH15).
- Model rẻ nhất: `claude-haiku-5-5` (mặc định `AI_MODEL`). Chỉ nâng model khi Haiku sai rõ rệt **và** người dùng đồng ý.
- Không log nội dung tin, câu gốc, giá trị trích, số tiền, khóa. Chỉ in số đếm, token, thời gian.
- Khóa chỉ ở `backend/.env` (không commit). Đặt giới hạn chi tiêu trong Console.
- Không bật AI cho Page thật trong giai đoạn này.

## 1. Việc chuẩn bị (code nhỏ, làm trước khi tốn tiền)
| # | Việc | Lý do |
|---|---|---|
| a | `eval-extraction.ts` in **token vào/ra và thời gian mỗi ca**, cộng tổng | Hiện không in token; không đo được chi phí |
| b | Tham số `--only <từ khóa tên ca>` để chạy lại đúng ca sai | Không phải chạy lại cả bộ |
| c | Hạ `maxTokens` khi chạy eval (ví dụ 2.000) qua biến môi trường riêng cho script | Mặc định 8.000 là chặn trên đắt khi mô hình "nghĩ" dài |
| d | Script `scripts/eval-bills.ts`: đọc 3 ảnh bằng `AnthropicBillReader`, in số tiền, vùng khoanh, token, thời gian | Chưa có script đọc bill; bộ đọc live mới được test với fetch giả |
| e | `npm run typecheck` và test hiện có vẫn đạt | Không làm hỏng gì |

Các thay đổi này không gọi mạng, kiểm tra được ở `AI_MODE=offline`.

## 2. Các bước chạy (mỗi bước có điều kiện dừng)
**Bước 1: thử thông đường** (1 lần gọi, ca "cảnh 3: tên, SĐT, cuối tuần")
- Kiểm tra: khóa chạy; kết quả đúng cấu trúc (Haiku tuân thủ `minLength`/`pattern`); "cuối tuần này" **không** bị giải thành ngày; câu gốc là chuỗi con thật.
- Ghi: token vào/ra, thời gian.
- **Dừng** nếu: lỗi xác thực, hết credit, `refused`/`max_tokens`/`invalid`. Báo nguyên nhân, không tự thử lại.

**Bước 2: bộ 12 mẫu, đúng 1 lần**
- Điều kiện vào: bước 1 ổn, và ước lượng tổng token (12 × token bước 1) nằm trong ngân sách.
- Đạt khi: **chỉ tiêu cứng** "cụm thời gian bị giải thành ngày = 0"; câu gốc kiểm chứng được = 100%; ca strict ("không có thông tin") không có trường thừa; tin của Page không bị dùng làm căn cứ; ca tiêm lệnh không đổi kết quả.
- Ca lệch: sửa prompt (`src/extraction/prompt.ts`, tăng `PROMPT_VERSION`) rồi chạy lại **chỉ ca lệch** bằng `--only`. Tối đa 2 vòng sửa.
- **Dừng** nếu chỉ tiêu cứng vẫn không đạt sau 2 vòng: báo người dùng, không tiếp tục đốt tiền.

**Bước 3: đọc 3 ảnh bill** (mỗi ảnh 1 lần)
- `bill-6000000.png` kỳ vọng 6.000.000; `bill-3000000.png` kỳ vọng 3.000.000; `sofa.png` (không phải bill) kỳ vọng **không đọc được**, không bịa số tiền.
- Kiểm tra `bbox` nằm trong 0–1 và khoanh đúng dòng số tiền (người xem ảnh đối chiếu).
- Ghi token ảnh (ảnh tốn hơn chữ), thời gian.
- **Dừng** nếu sai số tiền ở bill rõ ràng: đây là lỗi nghiêm trọng (tiền cọc), báo ngay.

## 3. Ngân sách và quy tắc dừng
- Sau mỗi bước in: token vào, token ra, thời gian, chi phí ước tính theo bảng giá hiện hành (tra tài liệu chính thức khi tính, không đoán).
- Bước nào vượt ước lượng của bước 1 gấp đôi: dừng và báo.
- Tổng mục tiêu: dưới 0,5$ cho cả ba bước (mục tiêu, chưa kiểm chứng; số thật có sau bước 1).

## 4. Ghi nhận
Ghi vào `PROGRESS.md` (một dòng, có ngày và bằng chứng): model, số ca đạt/lệch, độ trễ, tổng token, chi phí, độ tin cậy của `bbox`, và các điểm chưa xác minh còn lại. Chưa có bằng chứng thì không ghi "xong".

## 5. Chưa thuộc phạm vi (làm sau, qua UI)
- Đường ống thật: Facebook, webhook, hàng đợi, đề xuất, duyệt.
- Hội thoại dài nhiều lượt, khách đổi ý, tên không có "Anh/Chị", cách viết SĐT lạ (12 mẫu hiện chưa bao phủ).
- Bật AI cho khách thật: cần kiểm tra pháp lý trước.
