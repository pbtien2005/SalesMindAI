# Chạy demo (cảnh 0–3 và 6)

Kịch bản: [KICH-BAN-DEMO-MVP.md](KICH-BAN-DEMO-MVP.md). Kế hoạch: [PLAN-demo-mvp.md](PLAN-demo-mvp.md), [PLAN-backend.md](PLAN-backend.md).

## Cảnh báo trước khi chạy

- `DEMO_MODE=true` bật route demo (đồng hồ tua, giả lập, đặt lại) và nút **vào nhanh không cần mật khẩu** (Lan, chị Hà) cho tenant demo. Server chỉ nghe `127.0.0.1` và từ chối chạy khi `NODE_ENV=production`. Không dùng dữ liệu khách thật, và **không mở tunnel khi DEMO_MODE bật** (ai có địa chỉ tunnel vào được tenant demo). Khi dùng dữ liệu thật hãy chạy với `DEMO_MODE=false` và tạo tài khoản bằng CLI: `echo "mật-khẩu" | npm run cli -- user:create <email> <tên> --tenant <id> --role owner`.
- Sau `npm run build` trong `web/`, backend phục vụ giao diện tại cổng 3000 (không cần chạy Vite). Trên máy có `wslrelay` chiếm `[::1]`, dùng `127.0.0.1` thay `localhost` trong `DATABASE_URL`.
- `AI_MODE=offline` là bộ trích bằng luật, không gọi mạng, không cần khóa. Nó chỉ hiểu các câu mẫu trong kịch bản và biến thể gần (có hoặc không dấu). Chưa kiểm chứng với Claude thật: để thử, đặt `AI_MODE=live` và `ANTHROPIC_API_KEY` (gửi chat ra nước ngoài, chỉ dùng câu tự viết).
- Đồng hồ demo **trôi theo giờ thật** từ mốc đã đặt. Để lâu rồi mới diễn thì giờ đã lệch: chạy `demo:reset` ngay trước khi diễn.
- Tin của khách là tin giả có ký đúng chữ ký, đi qua `POST /webhook` thật. Chưa dùng Page Facebook thật.

## Chạy

Lệnh `docker compose` chạy ở gốc repo; mọi lệnh `npm` bên dưới chạy trong `backend/`.

```
docker compose up -d
cd backend
npm install
npm run db:migrate
```

Trong `backend/.env` (sao chép từ `backend/.env.example`) đặt:

```
DEMO_MODE=true
AI_MODE=offline
AI_DEBOUNCE_SECONDS=3
```

```
npm run cli -- demo:reset      # dựng 4 khách nền, đặt đồng hồ về Thứ Năm 12/11/2026 09:00
npm run dev                    # server, cổng 3000
```

## Giao diện (`web/`)

Ở một cửa sổ terminal khác (backend phải đang chạy ở cổng 3000):

```
cd web
npm install
npm run dev                    # http://localhost:5173
```

Vite chuyển tiếp `/api` tới `127.0.0.1:3000`, nên backend không cần CORS. Mở http://localhost:5173.

- **Trang chủ** (cảnh 0 và 6) và **Hội thoại** (cảnh 1–3): chọn ở thanh bên trái. Đổi vai Lan / chị Hà ở góc trên phải.
- **Bảng Giả lập** (nút "Giả lập" ở thanh trên): gửi tin như khách, gửi tin như Lan ở Page Inbox, và tua đồng hồ tới đúng mốc từng cảnh. Có sẵn câu mẫu lấy nguyên văn từ kịch bản; bộ trích offline chỉ hiểu các câu này và biến thể gần.
- **Đặt lại demo** ở thanh trên (có hỏi xác nhận) tương đương `demo:reset`: về Thứ Năm 12/11 09:00 và dựng lại dữ liệu nền. Đồng hồ chỉ tiến, không lùi.
- Giao diện chỉ hoạt động khi backend có `DEMO_MODE=true`; nếu chưa bật hoặc chưa có dữ liệu, màn hình báo lỗi kèm cách khắc phục.
- Kiểm thử giao diện: `cd web && npm test` (Vitest, không cần backend). Kiểm tra kiểu: `npm run typecheck`.

Thứ tự diễn gợi ý: Trang chủ (Lan) → Giả lập: "Cảnh 1: Thứ Năm 09:05", gửi hai tin cảnh 1 → mở Minh, thẻ khách tự điền → Lan trả lời → "Cảnh 2: Thứ Sáu 09:30", xác nhận ngừng bám cho Cô Mai → "Cảnh 3: Thứ Sáu 09:40", gửi tin cảnh 3 → duyệt SĐT, chọn ngày hẹn, duyệt mốc hẹn → Trang chủ → đổi sang chị Hà xem số liệu AI.

Nếu không dùng giao diện thì vẫn demo được bằng CLI và `curl` tới `/api/*`; mục bên dưới là cách đó.

## Lệnh demo (không cần giao diện)

Trên Windows, `curl -d` từ Git Bash có thể làm hỏng dấu tiếng Việt; hãy dùng CLI này, Node hoặc giao diện để gửi tin.

```
npm run cli -- demo:send minh "Cho mình hỏi mẫu này còn không?"     # khách gửi tin
npm run cli -- demo:send minh "Dạ còn ạ" --page                      # tin nhân viên gõ ở Page Inbox
npm run cli -- demo:clock                                            # xem đồng hồ
npm run cli -- demo:clock --advance 1440                             # tua 24 giờ
npm run cli -- demo:clock --to 2026-11-13T09:30:00+07:00
npm run cli -- extract:status                                        # tình trạng trích xuất, kể cả lần lỗi
npm run cli -- proposals:list
```

Persona: minh, thu, duc, ngoc, mai.

## Kiểm tra nhanh

- `curl http://127.0.0.1:3000/api/home` cho P1 = Chị Thu và 2 việc quá hạn ngay sau `demo:reset`.
- Gửi tin của khách, chờ khoảng 3 giây (debounce), rồi `GET /api/conversations/<id>`: thẻ khách có trường AI điền ("chưa duyệt"), SĐT và mốc thời gian nằm trong đề xuất.
- Mốc "cuối tuần này": duyệt không kèm `chosenAt` trả 422; hệ thống không tự điền ngày.

## Khi có sự cố

- Trích xuất không chạy: `extract:status`; tenant demo phải bật AI (`demo:reset` đã bật). Lần lỗi hiện ở trạng thái `failed`; chạy lại bằng `extract:run`.
- Job kẹt trong hàng đợi: `queue:status`, `queue:redrive extraction`.
- Số liệu lệch giờ: `demo:reset`.
