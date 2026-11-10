# Kế hoạch: gom backend vào `backend/` và dựng giao diện demo `web/`

## Context
Backend demo xong (15 route `/api/*`, 542 test), `web/` mới có `package.json`. Gốc repo đang lẫn mã backend (`src/`, `tests/`, `drizzle/`, `scripts/`, `package.json`, cấu hình TS/vitest/drizzle) với tài liệu và `web/`. Cần (1) gom backend vào `backend/` cho đối xứng với `web/`; (2) dựng UI theo artifact "SalesMind AI - Phác thảo giao diện" (2 màn) **cộng thêm Bảng Giả lập** (người dùng đã chọn; artifact chưa có màn này nên phải phác trước). Quyết định từ `doc/PLAN-demo-mvp.md`: Vite + React 19 + Tailwind v4 + TanStack Query, không Router, không shadcn, polling 2 giây.

## Phần A. Tái cấu trúc thư mục (mốc F0, làm trước, một commit riêng)
Kiểu **backend/ + web/**, hai package độc lập (mỗi bên có package.json và lockfile riêng, không workspaces).

```
SalesMindAI/
  backend/   src/ tests/ drizzle/ scripts/ package.json package-lock.json
             tsconfig.json tsconfig.build.json vitest.config.ts drizzle.config.ts
             .env .env.example
  web/       (package riêng, Vite)
  doc/ docker/ docker-compose.yml .claude/ .nvmrc .gitignore
  CLAUDE.md AGENTS.md PROGRESS.md README.md research_notes/ reports/ skills-lock.json
  package.json   (mỏng, chỉ script tiện: dev:api, dev:web, test:api, test:web, typecheck)
```
Các bước:
1. `git mv` từng mục vào `backend/` (giữ lịch sử); `.env` chưa theo dõi thì `mv` thường. `.nvmrc`, `docker-compose.yml`, `docker/` ở lại gốc (dùng chung).
2. Xoá `node_modules` gốc, `npm ci` trong `backend/`.
3. Rà đường dẫn tương đối bằng Grep: `drizzle` (migrationsFolder trong `src/db/migrate.ts` và test), `scripts/`, `tests/global-setup.ts`, `.env` (các script dùng `--env-file=.env` chạy theo cwd = `backend/`), `tsconfig` `include`, `.gitignore`, `.vscode`.
4. Cập nhật tài liệu có lệnh: `CLAUDE.md` (mục Lệnh chạy: thêm `cd backend`), `README.md`, `doc/CHAY-DEMO.md`, `PROGRESS.md`. Thêm vào `.gitignore` gốc `web/dist`, `backend/dist`.
5. **Kiểm chứng:** `cd backend && npm run typecheck && npm test` phải ra đúng **542 test / 29 file** như trước khi chuyển (cần `docker compose up -d`); `npm run cli -- queue:status` và `npm run dev` khởi động được. Không đạt thì không sang phần B.
6. Commit: "Tái cấu trúc: gom backend vào backend/". Rồi **dừng chờ "tiếp"** (quy tắc CLAUDE.md).

## Phần B. Phác thêm trên artifact trước khi code
Trong cùng canvas (chỉ ghi dưới `project/`), thêm các artboard còn thiếu để người dùng duyệt:
- **Bảng Giả lập** (ngăn kéo bên phải, mở từ thanh trên): chọn khách giả (5 persona: minh, thu, duc, ngoc, mai) hoặc hội thoại đang mở; ô nhập + nút "Gửi như khách"; ô nhập + nút "Gửi như Lan (Page Inbox)"; 3–4 câu mẫu bấm sẵn cho kịch bản (vd. "Chào shop, mình đang tìm sofa cho phòng khách, màu xám…", "Số mình là 0912 345 678. Cuối tuần này mình ghé xem được không?"); nhóm tua đồng hồ (+1 giờ, +24 giờ, về Thứ Sáu 09:30) và Đặt lại demo (có hỏi xác nhận).
- **Trạng thái đặc biệt** của 2 màn đã có: chưa có dữ liệu (`no_demo_data`), đang tải, lỗi API, hộp đề xuất rỗng, không có hội thoại nào được chọn, vai chị Hà ở màn Hội thoại (chỉ xem, không có nút duyệt? — chốt với người dùng khi duyệt phác thảo).
- Màn **Trang chủ** thêm khối "AI đã làm gì" (4 số: tự điền, Sale sửa, hỏi lại ngày, đã duyệt) mà phác thảo hiện chưa có nhưng cảnh 6 cần.
Người dùng duyệt phác thảo xong mới code các phần tương ứng.

## Phần C. Mã `web/` (chi tiết)
**Cấu hình:** `vite.config.ts` (react + `@tailwindcss/vite`, proxy `/api` → `http://127.0.0.1:3000`, nên backend không cần CORS), `tsconfig.json` (strict), `index.html` (lang="vi", font Inter), `src/main.tsx`, `src/index.css` (`@import "tailwindcss"` + `@theme` token lấy từ phác thảo: nền #EEF1F5, thanh trên #0F1B2D, xanh #1D4ED8, P1 #B42318, cam #D97706; bộ chip trạng thái 4 màu). Thêm devDeps: jsdom, @testing-library/react, @testing-library/user-event.

**Cấu trúc `web/src/`**
```
api/        client.ts  types.ts  hooks.ts  format.ts
state/      session.tsx   (vai trò lan|ha, hội thoại đang chọn, view chat|home, mở/đóng bảng giả lập)
components/ TopBar SideNav InboxList InboxItem ChatPane MessageBubble
            ProposalBox PhoneProposal TimelineProposal StopFollowupProposal
            CustomerCard FieldRow EvidenceQuote SimulatorPanel
            HomeView StatCard ReminderList AiStats StatusChip EmptyState ErrorBanner
App.tsx
```
- `api/client.ts`: `fetch('/api/...')` + header `x-demo-role`; ném `ApiError{code,message,status}` từ `{error:{code,message}}`.
- `api/types.ts`: chép kiểu từ `src/followup/overview.ts` (`ConversationSummary`, `HomeData`), `src/api/read-models.ts` (`ConversationDetail`, `BoxItem`, `HistoryEntry`), `src/extraction/types.ts` (`ProposalValue`, `Evidence`). Không import chéo package.
- `api/hooks.ts`: query `useNow`, `useInbox`, `useHome`, `useConversation(id)` đều `refetchInterval: 2000`; mutation `useDecide`, `useStopFollowup`, `useAdvanceClock`, `useResetDemo`, `useCustomerMessage`, `usePageMessage`, sau thành công thì invalidate các query liên quan.
- `api/format.ts`: định dạng ngày giờ từ chuỗi ISO của server theo múi +07:00 ("Thứ Sáu 13/11 09:30"), "chờ 22 phút", `toIsoWithOffset(datetimeLocal)` → `2026-11-14T10:00:00+07:00`. Không dùng `Date.now()` (đồng hồ demo tua được nên mọi thời điểm "bây giờ" lấy từ `/api/now`).

**Ánh xạ màn ↔ dữ liệu**
| Phần giao diện | Nguồn |
|---|---|
| Thanh trên: đồng hồ, vai trò | `GET /now`; `POST /clock/advance {minutes}`; `POST /demo/reset` |
| Danh sách hội thoại + bộ lọc (Tất cả / Chưa trả lời / P1) | `GET /inbox` → `waitingOn`, `waitingMinutes`, `isP1`, `isNew`, `followup{count,max,suggestStop}`; lọc phía client |
| Khung chat | `GET /conversations/:id` → `messages` (`direction`, `senderKind`), `<mark>` theo `evidence.start/end` (đơn vị UTF-16, dùng `String.slice`) |
| Nhãn nguồn tin Page | `senderKind` = `page_inbox` → "Page Inbox"; các giá trị khác hiện nhãn tương ứng |
| Hộp đề xuất | `box[]`: `kind:'proposal'` (phone, timeline, address) và `kind:'stop_followup'` |
| Thẻ khách | `autoFill[]` (tên, sản phẩm, ngân sách, số lượng: "AI điền, chưa duyệt") + `approved[]` ("Đã duyệt bởi Lan, giờ") + trường thiếu ("Thiếu") |
| Trang chủ | `GET /home` → `p1`, `overdue`, `reminders` (đỏ/cam/xanh theo `kind`), `suggestStop`, `ai` |
| Giả lập | `POST /demo/customer-message {persona,text}`, `POST /demo/page-message {conversationId,text}` (202) |

**Quy tắc nghiệp vụ UI (không được phá)**
- Mốc thời gian có cờ `needs_clarification`: hiện câu gốc + "Tin gửi lúc …", `datetime-local` **để trống**, nút Duyệt bị `disabled` đến khi chọn; chip gợi ý (Thứ Bảy 10:00, Chủ Nhật 10:00) chỉ điền khi người dùng bấm; gửi `{action:'accept', chosenAt}`. Server trả 422 `needs_date` thì hiện lỗi tại chỗ.
- Sửa SĐT: `{action:'edit', editedText}`; Bỏ qua: `{action:'dismiss'}`.
- Đề xuất ngừng bám (Cô Mai 5/5) chỉ gọi `POST /conversations/:id/stop-followup` khi Sale bấm; kèm dòng "Hệ thống chỉ đề xuất, việc bỏ bám do Sale xác nhận".
- Mọi trường AI điền đều kèm `EvidenceQuote`; hover/focus mở popup tin gốc với đoạn tô vàng.
- Lỗi `no_demo_data` (409): màn hướng dẫn chạy `npm run cli -- demo:reset` trong `backend/`. `not_pending` (409): làm mới dữ liệu và báo "đề xuất đã được xử lý".
- Không hiển thị `intent`/`message_purpose` (tín hiệu nội bộ). Không log nội dung tin ra console.
- Trợ năng: nút thật `<button>`, `<label>` cho input, tương phản ≥ 4.5:1, chip trạng thái không chỉ dựa vào màu; mục tiêu bấm ≥ 44px ở thanh điều hướng.
- Thẻ "Tiền cọc hôm nay" giữ placeholder "Sắp có" (ngoài phạm vi demo).

## Phần D. Thứ tự mốc (mỗi mốc: test → cập nhật PROGRESS.md → 1 commit → dừng chờ "tiếp")
- **F0** Tái cấu trúc `backend/` (Phần A).
- **F1** ~~Phác Bảng Giả lập + trạng thái đặc biệt trên artifact~~ **Bỏ** (2026-11-10, theo yêu cầu người dùng): Bảng Giả lập và các trạng thái lỗi/rỗng làm thẳng bằng code ở F4, theo mô tả ở Phần B.
- **F2** Khung `web/` + `api/*` + TopBar/SideNav + test `client`, `format` (ISO +07:00, `chosenAt`).
- **F3** Màn Hội thoại: InboxList, ChatPane, ProposalBox, CustomerCard + test ProposalBox (khoá Duyệt khi thiếu ngày, không điền sẵn ngày, gửi đúng `chosenAt`), test tô câu gốc theo offset.
- **F4** Trang chủ + Bảng Giả lập + trạng thái lỗi/rỗng.
- **F5** Chạy thử toàn kịch bản cảnh 0–3 và 6, rà trợ năng (`web-design-guidelines`) và hiệu năng React (`vercel-react-best-practices`, bỏ nhóm Server Components), `code-review`, cập nhật `CLAUDE.md`, `doc/CHAY-DEMO.md`.

## Kiểm chứng đầu-cuối
1. `docker compose up -d`; `cd backend && npm run db:migrate && npm run cli -- demo:reset && npm run dev`.
2. `cd web && npm run typecheck && npm test && npm run build && npm run dev`.
3. Đi kịch bản: Trang chủ vai Lan (P1=1 Chị Thu, quá hạn=2) → Giả lập tin anh Minh (thẻ tự điền "sofa phòng khách, màu xám", "15 triệu", hộp đề xuất trống) → Lan trả lời qua Page Inbox → tua tới Thứ Sáu 09:30 (Minh Bám 1/5; Cô Mai đề xuất ngừng bám) → khách gửi SĐT + "cuối tuần này" (hộp có 2 mục; Duyệt mốc hẹn khoá đến khi chọn Thứ Bảy 10:00) → Trang chủ hiện lịch nhắc "Thứ Bảy 14/11 10:00" → đổi sang chị Hà xem "AI đã làm gì".
