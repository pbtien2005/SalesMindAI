<div align="center">

# SalesMind AI

**Không để cơ hội bán hàng nào bị bỏ quên.**

Trợ lý AI cho đội Sale Việt Nam: đọc tin nhắn khách trên Facebook Page, rút ra nhu cầu, ngân sách, mốc thời gian, rồi đề xuất việc cần làm. Nhân viên xác nhận, hệ thống nhắc đúng hạn, quản lý nhìn thấy toàn cảnh.

![Node.js 26](https://img.shields.io/badge/Node.js-26_LTS-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Fastify 5](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![PostgreSQL 18](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Tailwind v4](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white)

</div>

---

## Vấn đề

Đội Sale 5–30 người chốt đơn qua Messenger. Khách hỏi giá lúc 8 giờ sáng, nhân viên bận, tin chìm xuống. Một câu "cuối tuần này em qua xem" không ai ghi lại. Khách đặt cọc xong, đơn nằm trong một ảnh chụp màn hình. Quản lý chỉ biết khi khách đã đi chỗ khác.

## Giải pháp

```
Khách nhắn vào Page ─▶ AI trích xuất ─▶ Đề xuất việc ─▶ Sale xác nhận ─▶ Nhắc hạn ─▶ Báo cáo quản lý
   (Messenger)        (có câu gốc)     (không tự quyết)  (con người quyết)  (theo giờ)   (Trang chủ)
```

### Ba nguyên tắc không thương lượng

| | Nguyên tắc | Nghĩa là |
|---|---|---|
| 1 | **AI đề xuất, con người quyết định** | Ngừng bám, gửi tin, xác nhận cọc, tạo đơn đều cần Sale bấm. AI không tự làm. |
| 2 | **Mọi thông tin AI trích đều kèm câu gốc** | Mỗi trường có `evidence` là chuỗi con đã được kiểm chứng trong tin khách. Không lưu chuỗi do mô hình tự viết. |
| 3 | **Mốc thời gian mơ hồ thì hỏi lại** | "Cuối tuần này" hiện cờ để Sale chọn ngày. Không có đường nào tự điền ngày. |

## Tính năng

**Tiếp nhận tin nhắn (Module 1)**
- Nhận webhook từ Facebook Page, kiểm tra chữ ký HMAC-SHA256 (so sánh timing-safe), trả 200 trong vài mili giây rồi xử lý ở hàng đợi.
- Khử trùng theo `message.mid`, retry rồi vào dead-letter: **không bỏ tin im lặng**.
- Lưu **cả tin do Page gửi** (kể cả tin nhân viên gõ ở Page Inbox) để biết khách đã được trả lời chưa.
- Backfill tin cũ, kết nối Page qua Facebook Login, Page token mã hóa AES-256-GCM.

**AI trích xuất (Module 2)**
- Trích nhu cầu, ngân sách, mốc thời gian thành **đề xuất** chờ duyệt. Số điện thoại trích bằng code, không qua mô hình.
- Hai chế độ: `offline` (luật tất định, không gọi mạng, mặc định) và `live` (Claude), phải bật tường minh theo từng tenant.
- Có bộ đánh giá trích xuất riêng, đo token và ngân sách.

**Giao diện làm việc**
- **Hội thoại** có hộp thư, thẻ khách và Hộp đề xuất ngay bên cạnh khung chat.
- **Trang chủ** cho quản lý: hội thoại ưu tiên (P1), việc quá hạn, tiền cọc thực tế, lịch nhắc.
- **Đơn nháp và thanh toán:** AI đọc số tiền từ ảnh bill, Sale xác nhận cọc rồi hệ thống cấp mã đơn.
- Số lần bám khách, quá hạn và lịch nhắc **tính khi đọc** từ dữ liệu, không lưu số đếm nên không bao giờ lệch.

**Nền tảng sản phẩm**
- Tài khoản đăng nhập thật (email và mật khẩu), nhiều doanh nghiệp, vai trò owner, manager, sale.
- Cách ly tenant: tenant lấy từ phiên đăng nhập, không bao giờ từ client; tài nguyên của tenant khác trả 404. Test cách ly tự liệt kê mọi route.
- Gửi tin cho khách **chỉ khi người dùng bấm gửi**, có kiểm cửa sổ 24 giờ trước khi gọi Meta.

## Kiến trúc

```
                        ┌──────────────────────── Backend (Fastify 5) ────────────────────────┐
 Facebook ──webhook──▶  │  Chữ ký ─▶ pg-boss ─▶ Worker ─▶ PostgreSQL 18 ◀── Drizzle ORM       │
 Page                   │                          │                                            │
                        │                          ▼                                            │
                        │           Pipeline trích xuất (offline / live) ─▶ Đề xuất (proposals) │
                        │                          │                                            │
                        │           Service duyệt ─▶ Hồ sơ khách ─▶ Đơn hàng, thanh toán       │
                        └──────────────────────────┬────────────────────────────────────────────┘
                                                   │ /api/* (cookie phiên, chống CSRF)
                                                   ▼
                              Giao diện web (React 19, Vite, TanStack Query, Tailwind v4)
```

| Lớp | Công nghệ |
|---|---|
| Backend | Node.js 26, TypeScript, Fastify 5 (pino) |
| Dữ liệu | PostgreSQL 18, Drizzle ORM, hàng đợi pg-boss (chạy ngay trên Postgres, không cần Redis) |
| AI | Luật tất định (offline) hoặc Claude (live), kiểm chứng câu gốc bằng code |
| Giao diện | React 19, Vite, TanStack Query, Tailwind v4 |
| Kiểm thử | Vitest (Postgres và pg-boss thật), kịch bản Chrome đi hết 7 cảnh demo |
| Triển khai | Docker một image (API và giao diện), Render + Neon, hoặc VM với Caddy |

## Bảo mật và quyền riêng tư

- Webhook sai chữ ký trả 403; token Page mã hóa khi lưu.
- Không ghi vào log: nội dung tin nhắn, câu gốc, giá trị AI trích, số tiền, token, query string.
- Không hard-code secret; mọi cấu hình qua biến môi trường.
- AI bật **theo từng tenant** và mặc định tắt. Chỉ nên bật `live` cho khách thật sau khi có kiểm tra pháp lý về chuyển dữ liệu ra nước ngoài (Luật 91/2025/QH15, chưa được luật sư xác nhận).

## Bắt đầu nhanh

Cần Node.js 26 (`.nvmrc`) và Docker.

```bash
docker compose up -d                 # PostgreSQL 18 ở cổng 5433
cd backend
npm install
cp .env.example .env                 # đặt DEMO_MODE=true để chạy demo
npm run db:migrate
npm run dev                          # API: http://localhost:3000
```

```bash
cd web
npm install
npm run dev                          # Giao diện: http://localhost:5173
```

Chế độ demo (`DEMO_MODE=true`) có đồng hồ tua, bảng giả lập tin nhắn và nút vào nhanh với hai tài khoản mẫu, **chỉ nghe `127.0.0.1` và không chạy ở production**. Kịch bản 8 phút: [doc/KICH-BAN-DEMO-MVP.md](doc/KICH-BAN-DEMO-MVP.md), cách chạy: [doc/CHAY-DEMO.md](doc/CHAY-DEMO.md).

```bash
cd backend && npm test               # Vitest, cần Postgres đang chạy
cd web && npm test
```

## Triển khai

Một `Dockerfile` ở gốc dựng cả API lẫn giao diện (`web/dist` do backend phục vụ).

| Hướng | Phù hợp | Hướng dẫn |
|---|---|---|
| **Render + Neon** | Nhanh, không cần thẻ quốc tế, URL cố định (gói free tự ngủ khi nhàn rỗi) | [doc/DEPLOY-RENDER.md](doc/DEPLOY-RENDER.md) |
| **VM + Caddy** | Chạy 24/7, HTTPS tự động | [doc/DEPLOY-ORACLE.md](doc/DEPLOY-ORACLE.md) |

Bản công khai luôn `DEMO_MODE=false`, tài khoản tạo bằng CLI, và cần Meta App thật để nhận tin. Chọn **Language: Docker** và để **Root Directory trống** khi tạo service trên Render.

## Trạng thái

| Hạng mục | Trạng thái |
|---|---|
| Module 1: tiếp nhận tin (mốc 0–6) | Mã và test tự động xong. **Mốc 4 (kết nối Page) và mốc 5 (backfill) chờ thử với Page Facebook thật.** |
| Module 2: AI trích xuất | Service, CLI, giao diện duyệt xong; chạy `offline` và có bộ test Claude thật không giao diện |
| Giao diện | Trang chủ, Hội thoại, Hộp đề xuất, Bảng Giả lập, quản lý Page |
| Tài khoản và nhiều doanh nghiệp | Xong (P1–P3) |
| Đơn hàng, thanh toán, đọc bill | Xong ở chế độ demo |
| Gửi email xác minh | Chưa có (chưa có SMTP); tài khoản tạo bằng CLI |

Điều **chưa kiểm chứng với Meta thật** (đơn vị `timestamp` webhook, `id` tin Conversations API có trùng `mid`, hành vi chế độ Development) được liệt kê trong [PROGRESS.md](PROGRESS.md). Dự án không khẳng định "xong" khi chưa có test hoặc kết quả chạy làm bằng chứng.

## Cấu trúc kho mã

```
backend/        API Fastify: src/, tests/, drizzle/ (migration), scripts/
web/            giao diện React (Vite)
doc/            kế hoạch, hướng dẫn kết nối Page, kịch bản demo, triển khai
deploy/, docker-compose.prod.yml   triển khai VM
docker/, docker-compose.yml        Postgres dev
```

## Tài liệu

- [doc/VAN-HANH.md](doc/VAN-HANH.md): cấu hình `.env`, CLI, endpoint, vận hành, kiểm thử, cấu trúc mã chi tiết
- [doc/KET-NOI-PAGE.md](doc/KET-NOI-PAGE.md): kết nối và kiểm tra với Page Facebook thật
- [doc/KICH-BAN-DEMO-MVP.md](doc/KICH-BAN-DEMO-MVP.md) và [doc/CHAY-DEMO.md](doc/CHAY-DEMO.md): kịch bản và cách chạy demo
- [doc/PLAN-module2.md](doc/PLAN-module2.md), [doc/PLAN-san-pham.md](doc/PLAN-san-pham.md): kế hoạch Module 2 và sản phẩm
- [doc/DEPLOY-RENDER.md](doc/DEPLOY-RENDER.md), [doc/DEPLOY-ORACLE.md](doc/DEPLOY-ORACLE.md): triển khai
- [PROGRESS.md](PROGRESS.md): trạng thái từng mốc, bằng chứng, điểm Meta API đã và chưa xác minh
- [CLAUDE.md](CLAUDE.md): quy tắc kỹ thuật và quy trình làm việc theo mốc
