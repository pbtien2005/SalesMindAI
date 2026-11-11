# Triển khai miễn phí: Oracle Cloud Always Free + DuckDNS + Caddy

Kết quả: một URL HTTPS cố định (`https://ten.duckdns.org`) chạy 24/7, tắt laptop vẫn truy cập được. Bản này `DEMO_MODE=false`, có đăng nhập thật, không có nút "vào nhanh".

## 1. Tạo VM (Oracle Cloud)
1. Đăng ký oracle.com/cloud/free (cần thẻ để xác minh, không bị trừ tiền). Chọn region còn suất VM ARM.
2. Compute > Instances > Create: image **Ubuntu 24.04**, shape **Ampere A1** (VM.Standard.A1.Flex, 2 OCPU / 12 GB là đủ), gán public IP, tải khóa SSH.
   - Báo "Out of capacity": thử lại sau vài giờ hoặc đổi availability domain. Đừng dùng shape micro 1 GB (không đủ RAM build).
3. Networking > VCN > Security List: thêm Ingress cho TCP **80** và **443** từ `0.0.0.0/0` (22 đã có). KHÔNG mở 5432/5433/3000.

## 2. DuckDNS
Vào duckdns.org, đăng nhập, tạo subdomain (ví dụ `salesmind-demo`), điền **public IP của VM**. Địa chỉ: `salesmind-demo.duckdns.org`.

## 3. Cài Docker trên VM
```bash
ssh ubuntu@<IP-VM>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit   # đăng nhập lại để có quyền docker
```
Mở firewall trong VM (ảnh Ubuntu của Oracle chặn sẵn, hay quên):
```bash
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
```

## 4. Đưa code lên và cấu hình
```bash
git clone <repo-của-bạn> salesmind && cd salesmind   # hoặc scp/rsync thư mục dự án
cp deploy/.env.prod.example deploy/.env.prod
cp backend/.env.docker.example backend/.env.docker
```
- `deploy/.env.prod`: đặt `DOMAIN` và `POSTGRES_PASSWORD` (dài, ngẫu nhiên).
- `backend/.env.docker`: `PUBLIC_BASE_URL=https://<DOMAIN>`, `DEMO_MODE=false`, `SIGNUP_MODE=closed`, `AI_MODE=offline`, và `TOKEN_ENC_KEY` (`openssl rand -base64 32`). Các biến Meta (`FB_APP_ID`, `APP_SECRET`, `VERIFY_TOKEN`) điền giá trị bất kỳ nếu chưa nối Page thật.

## 5. Chạy
```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
docker compose -f docker-compose.prod.yml logs -f caddy app   # chờ Caddy xin xong chứng chỉ
```
Lần build đầu mất vài phút. Mở `https://<DOMAIN>` kiểm tra.

## 6. Tạo doanh nghiệp và tài khoản cho khán giả
```bash
C="docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod exec -T app node dist/cli/index.js"
$C tenant:create "Demo"            # ghi lại <tenant-id>
echo "MatKhauTam123" | $C user:create khan-gia@demo.vn "Khán giả" --tenant <tenant-id> --role sale
```
Đưa email và mật khẩu lên slide cùng QR. Đổi mật khẩu sau sự kiện.

## 7. QR
Tạo QR cho `https://<DOMAIN>` (qr-code-generator hoặc `qrencode -t PNG -o qr.png "https://<DOMAIN>"`). Thử bằng điện thoại 4G trước giờ G.

## Vận hành
- Cập nhật: `git pull` rồi chạy lại lệnh `up -d --build` ở bước 5.
- Sao lưu: `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U salesmind salesmind > backup.sql`.
- Dùng VM ít nhất vài lần/tuần để Oracle không thu hồi gói free. Cập nhật IP DuckDNS nếu VM bị gán IP mới.
- Giữ nguyên các ràng buộc: không bật `DEMO_MODE`, không bật AI live khi chưa xong kiểm tra pháp lý (xem `CLAUDE.md`).
