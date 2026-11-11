# Triển khai miễn phí: Render + Neon (không cần thẻ quốc tế)

Kết quả: `https://<tên>.onrender.com` cố định, HTTPS tự động, tắt laptop vẫn chạy. Bản `DEMO_MODE=false`, có đăng nhập thật.
Render gói free **ngủ sau ~15 phút không có truy cập** (lần quét đầu chờ ~1 phút): dùng UptimeRobot ở bước 5 để giữ thức.

## 1. Postgres miễn phí (Neon)
1. neon.tech > đăng ký (đăng nhập GitHub/Google) > tạo project, region Singapore.
2. Copy **connection string KHÔNG qua pooler** (tắt "Connection pooling"; chuỗi không có `-pooler` trong host). Hàng đợi pg-boss không chạy đúng qua pooler.
3. Chuỗi có dạng `postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`. Giữ lại, đây là `DATABASE_URL`.

## 2. Đưa code lên GitHub (Render deploy từ GitHub)
Repo hiện chưa có remote. Tạo repo **Private** trên github.com rồi:
```bash
git remote add origin https://github.com/<bạn>/salesmind.git
git push -u origin main
```
Kiểm tra trước khi push: `git status` không có `.env`, `backend/.env.docker`, `deploy/.env.prod` (đã bị gitignore), và không có tệp dữ liệu khách thật.

## 3. Tạo Web Service trên Render
render.com > New > **Web Service** > chọn repo > Language **Docker** (dùng `Dockerfile` gốc) > Instance type **Free**. Health Check Path: `/healthz`. Environment variables:

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | chuỗi Neon ở bước 1 |
| `PUBLIC_BASE_URL` | `https://<tên>.onrender.com` (đúng tên Render cấp, không có `/` cuối) |
| `TRUST_PROXY` | `true` |
| `DEMO_MODE` | `false` |
| `SIGNUP_MODE` | `closed` |
| `AI_MODE` | `offline` |
| `TOKEN_ENC_KEY` | `openssl rand -base64 32` (hoặc `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) |
| `FB_APP_ID`, `APP_SECRET`, `VERIFY_TOKEN` | giá trị tạm bất kỳ nếu chưa nối Page thật |
| `GRAPH_API_VERSION` | `v26.0` |

Render tự đặt `PORT`. Lần đầu build vài phút; migration chạy tự động khi container khởi động. Nếu bạn đặt tên service khác dự kiến, sửa `PUBLIC_BASE_URL` rồi Redeploy (cookie đăng nhập phụ thuộc biến này).

## 4. Tạo doanh nghiệp và tài khoản (chạy từ laptop, trỏ vào DB Neon)
Free Render không có shell, nên chạy CLI tại máy bạn với `DATABASE_URL` của Neon (PowerShell, trong `backend/`):
```powershell
$env:DATABASE_URL = "<chuỗi Neon>"
$env:PUBLIC_BASE_URL = "https://<tên>.onrender.com"
npm run cli -- tenant:create "Demo"        # ghi lại <tenant-id>
"MatKhauTam123" | npm run cli -- user:create khan-gia@demo.vn "Khán giả" --tenant <tenant-id> --role sale
```
Nếu CLI báo thiếu biến khác trong `backend/.env`, để nguyên file `.env` đó, chỉ ghi đè hai biến trên. Dữ liệu tạo ở đây là dữ liệu trên Neon, không phải DB dev. Mở `https://<tên>.onrender.com` đăng nhập thử.

## 5. Giữ thức (tránh ngủ)
uptimerobot.com (free) > Add monitor > HTTP(s) > URL `https://<tên>.onrender.com/healthz` > interval 5 phút. Render free có hạn giờ chạy mỗi tháng (~750 giờ), đủ cho 1 service chạy liên tục.

## 6. QR
Tạo QR cho `https://<tên>.onrender.com`, đưa email/mật khẩu khán giả lên slide, thử bằng 4G trước giờ G.

## Lưu ý
- Neon free tự tạm dừng DB khi nhàn rỗi, thức lại sau vài giây; UptimeRobot ping `/healthz` có thể không chạm DB. Mở app một lần trước giờ demo để chắc.
- Đĩa Render free không lưu: mọi dữ liệu nằm ở Neon, không ghi file lên đĩa.
- Không bật `DEMO_MODE`, không bật AI live khi chưa xong kiểm tra pháp lý (xem `CLAUDE.md`).
