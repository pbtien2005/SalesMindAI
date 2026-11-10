# Kế hoạch hoàn thiện demo MVP: đủ cả 8 cảnh của kịch bản

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chạy trọn kịch bản `doc/KICH-BAN-DEMO-MVP.md` (cảnh 0–7, cả biến thể) bằng giao diện thật, không còn cảnh nào phải "nói miệng".

**Architecture:** Giữ nguyên đường đi hiện có (tin giả ký đúng chữ ký → `/webhook` → hàng đợi → trích xuất → `proposals` → API `/api/*` → `web/`). Thêm một lớp "giao dịch" riêng (`orders`, `payments`, `reply_drafts`, `products`) thay vì nhồi vào `proposals`, vì đơn và bill không có câu gốc dạng chuỗi con. Mọi dòng do AI tạo ra ở lớp này có trạng thái `draft`/`proposed`; chỉ hành động của Sale mới chuyển sang `confirmed`.

**Tech Stack:** Node 26, Fastify 5, Drizzle + Postgres 18, pg-boss, Vitest, `@anthropic-ai/sdk@1.6.0`; `web/`: React 19, Vite, TanStack Query, Tailwind v4.

**Spec:** [KICH-BAN-DEMO-MVP.md](KICH-BAN-DEMO-MVP.md). Nền đã có: [PLAN-demo-mvp.md](PLAN-demo-mvp.md), [PLAN-backend.md](PLAN-backend.md), [PLAN-frontend.md](PLAN-frontend.md). Hiện trạng và khoảng trống được kiểm chứng ngày 2026-11-10 (chạy Chrome qua giao diện, 542 test backend, 104 test web).

## Global Constraints

Từ `CLAUDE.md`, áp dụng cho mọi mốc:

- Chỉ `DEMO_MODE=true` mới có API demo, đồng hồ tua, tài nguyên giả; nghe `127.0.0.1`; từ chối ở `NODE_ENV=production`.
- Mọi hàm nghiệp vụ nhận `now` làm tham số; số liệu (bám, P1, quá hạn, tiền cọc hôm nay) **tính khi đọc**, không lưu số đếm.
- AI đề xuất, Sale quyết định. Không bao giờ giải biểu thức thời gian mơ hồ thành ngày. SĐT và mã hàng trích bằng code, không qua mô hình.
- Không gửi tin cho khách: Lan sao chép tin nháp sang Page Inbox.
- Không log nội dung tin, câu gốc, số tiền hay giá trị AI trích; chỉ số đếm, id, token usage.
- `AI_MODE=offline` mặc định (luật, không mạng); `live` phải đặt tường minh. Ảnh bill gửi ra nước ngoài chỉ khi `live`, chỉ dùng bill tự dựng (pháp lý Luật 91/2025/QH15 chưa xác nhận).
- Sau **mỗi** mốc: chạy test → cập nhật `PROGRESS.md` → **một** commit → dừng báo cáo → chờ "tiếp". Chưa có bằng chứng thì không ghi "xong".
- Tên tiếng Việt cho văn bản hiển thị; tiền là số nguyên VND (`bigint`), không dùng số thực.

## Review Focus

Các tình huống kịch bản không nêu nhưng dễ vỡ nhất khi demo (mỗi dòng có test ở mốc ghi trong ngoặc):

1. **Ảnh không phải bill, hoặc đọc không ra số tiền** (ảnh sofa, ảnh mờ) → thẻ "Không đọc được", tuyệt đối không tạo khoản cọc hay gợi ý "Đã cọc đủ điều kiện" (G6).
2. **Cùng một bill xử lý hai lần** (Meta gửi lại webhook, job retry, khách gửi lại ảnh) → đúng một khoản `payments` cho mỗi tin ảnh (G6).
3. **Bấm "Xác nhận đã cọc" hai lần, hoặc hai tab cùng bấm** → tiền chỉ cộng một lần (G7).
4. **Tạo đơn khi thiếu địa chỉ, hoặc khi chưa xác nhận cọc** → bị từ chối (G7). Khách nhắn tiếp sau khi Sale đã sửa đơn nháp → đơn nháp không bị ghi đè (G5).
5. **Câu "giá 12 triệu" bị hiểu thành ngân sách**, ghi đè "tầm 15 triệu"; hoặc giá khách nêu khác giá niêm yết → ngân sách giữ nguyên, đơn lấy giá niêm yết và gắn cờ `price_mismatch` (G4, G5).

Ngoài ra: "Tiền cọc hôm nay" tính theo ngày giờ Việt Nam và đồng hồ demo, tua qua nửa đêm phải đúng (G7).

## Quyết định đã chọn (người duyệt có thể đổi)

1. **Demo bằng AI thật (`AI_MODE=live`, Claude):** cả trích xuất lẫn đọc bill chạy bằng Claude. Cần `ANTHROPIC_API_KEY`; chỉ dùng câu và bill tự dựng. Bảng tra theo SHA-256 của hai ảnh mẫu (bộ đọc offline) chỉ còn là đường lui khi mạng hoặc API lỗi giữa buổi, và giao diện ghi rõ "bộ đọc mô phỏng" khi nó đang chạy. Vì AI thật là đường chính nên rủi ro lớn nhất được kiểm trước: G4 và G6 đều mở đầu bằng thử với Claude thật, trước khi xây phần còn lại.
2. **Tin nháp soạn theo mẫu** từ đơn nháp (tất định, test được), không do mô hình viết. Nhãn: "Soạn sẵn từ đơn nháp".
3. **Nút "Gửi" ngay trong Hộp đề xuất, Sale không phải soạn hay dán.** Sale đọc tin nháp (sửa được ngay tại ô), bấm "Gửi". Trong demo, "Gửi" là **gửi giả lập**: tin được ghi vào hội thoại như một tin của Page do chính SalesMind gửi (`sender_kind = page_app`, nhãn "SalesMind"), đi qua đúng đường webhook có ký; **không có gì tới Messenger thật**. Giao diện ghi rõ "Demo: tin chưa gửi tới Facebook". Bấm "Gửi" cũng chuyển đơn sang `awaiting_deposit` và tạo việc "Nhắc khách cọc" hạn +24 giờ. Gửi thật qua Messenger (Send API) là một module riêng, xem mục "Gửi tin thật" cuối tài liệu.
4. **Câu gốc giữ hiển thị sẵn** (không popup khi rê chuột): hover không dùng được trên màn cảm ứng và bàn phím. Kịch bản được sửa theo, không sửa giao diện.
5. **"Đã duyệt" trên Trang chủ đếm:** đề xuất SĐT/mốc hẹn/địa chỉ đã duyệt, ngừng bám, tin nháp đã sao chép, khoản cọc đã xác nhận, đơn đã tạo. Số hiển thị lấy theo số thật; kịch bản cập nhật theo kết quả chạy.
6. **Thêm bước vào cảnh 5:** sau khi tạo đơn, Lan nhắn xác nhận ở Page Inbox. Không có bước này, Minh (đã nhắn "chuyển cọc rồi") thành P1 thứ hai và Trang chủ ra P1 = 2 thay vì 1.
7. **Dòng nhắc "Bám 1/5" biến mất** khi Lan nhắn lại (số bám tính khi đọc nên không có trạng thái "đã xử lý"); kịch bản sửa theo.

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `backend/src/db/schema.ts`, `backend/drizzle/0004_*.sql` | Bảng và enum mới (G3) |
| `backend/src/extraction/sku.ts` | Tìm mã hàng bằng regex, kèm offset (G4) |
| `backend/src/orders/deposit.ts` | `evaluateDeposit`: hàm thuần so ngưỡng cọc (G6) |
| `backend/src/orders/draft.ts` | `buildOrderDraft`: dựng đơn nháp và tin nháp từ hồ sơ (G5) |
| `backend/src/orders/service.ts` | Hành động của Sale: sửa đơn, sao chép tin, xác nhận cọc, tạo đơn (G5, G7) |
| `backend/src/bills/*` | `BillReader`, bản offline và bản Anthropic, `readBill`, hàng đợi `read-bill` (G6) |
| `backend/src/api/{routes,read-models}.ts` | Route và mô hình đọc mới (mọi mốc) |
| `web/src/components/{OrderDraftCard,ReplyDraftCard,BillCard,DepositCard,OrdersView,OverdueView,HistoryPanel}.tsx` | Giao diện mới (G2, G8) |
| `web/e2e/run.mjs` | Kịch bản Chrome đi hết 8 cảnh, nằm trong repo (G9) |

---

### Task G1: Hoàn thiện cảnh 1–3 còn thiếu (sửa trường AI, chặn ngày quá khứ, duyệt nhiều mục, giai đoạn khách)

**Files:**
- Modify: `backend/src/extraction/proposals.ts:92-104` (chặn ngày), `backend/src/followup/overview.ts` (thêm `stage`, `nextContact`), `backend/src/api/read-models.ts` (đưa ra `stage`)
- Modify: `web/src/components/CustomerCard.tsx`, `web/src/components/ProposalBox.tsx`, `web/src/components/ChatPane.tsx`, `web/src/api/types.ts`
- Test: `backend/tests/proposals.test.ts`, `backend/tests/demo-core.test.ts`, `web/src/components/ChatView.test.tsx`, `web/src/components/ProposalBox.test.tsx`

**Interfaces:**
- Produces: `ConversationSummary.stage: 'new' | 'chasing' | 'tracking'` và `ConversationSummary.nextContact: { at: Date; reason: string } | null`. `tracking` khi khách có mốc hẹn đã duyệt (`profile_fields.timeline.chosenAt`) còn ở tương lai; `reason` = "Ngày hẹn đã xác nhận (ưu tiên 1)". `new` khi chưa có SĐT đã duyệt và chưa bám. Mã lỗi mới `ProposalErrorCode = 'past_date'` (HTTP 422).
- Produces (web): `CustomerCard` nhận thêm nút "Sửa" cho `customer_name`, `product_interest`, `budget`, `quantity` (gọi `decide` với `action: 'edit'`); `ProposalBox` có nút "Duyệt N mục" duyệt tuần tự (mốc hẹn trước, vì cần ngày), dừng và báo lỗi ở mục đầu tiên thất bại.

- [ ] **Step 1: Viết test đỏ.** `proposals.test.ts`: `decideProposal` với `chosenAt` trước `now` ném `ProposalError('past_date')`; bằng `now` thì được; không có `chosenAt` mà cờ mơ hồ vẫn `needs_date`. `demo-core.test.ts`: sau khi duyệt mốc hẹn 14/11 10:00 lúc 13/11 09:41 thì `stage === 'tracking'` và `nextContact.at` đúng 14/11 10:00; quá giờ hẹn thì `stage` trở lại `chasing` hoặc `new` tùy SĐT. `ChatView.test.tsx`: sửa "sofa" thành "tủ" trên thẻ khách → nhãn "Đã sửa và duyệt bởi Lan"; `ProposalBox.test.tsx`: chưa chọn ngày thì "Duyệt 2 mục" khóa; có ngày thì gửi hai quyết định đúng thứ tự.
- [ ] **Step 2: Chạy test, thấy đỏ:** `cd backend && npx vitest run tests/proposals.test.ts tests/demo-core.test.ts` và `cd web && npx vitest run`.
- [ ] **Step 3: Cài đặt** theo Interfaces. Ngày quá khứ chặn ở `decideProposal` (một nơi), giao diện chỉ thêm `min` cho ô ngày giờ.
- [ ] **Step 4: Chạy lại cả hai bộ test và `npm run typecheck` ở gốc, thấy xanh.**
- [ ] **Step 5: Thêm `DEMO_MODE=true`, `AI_MODE=offline`, `AI_DEBOUNCE_SECONDS=3` vào `backend/.env.example`; commit** `G1: sửa trường AI điền, chặn ngày quá khứ, duyệt nhiều mục, giai đoạn khách`.

### Task G2: Cảnh 6 còn thiếu: danh sách việc quá hạn và lịch sử duyệt

**Files:**
- Modify: `web/src/api/{client,hooks,types}.ts` (thêm `api.overdue`, `useOverdue`), `web/src/components/HomeView.tsx` (thẻ "Việc quá hạn" bấm được), `web/src/state/session.tsx` (`View` thêm `'overdue'`), `web/src/components/ChatView.tsx` (gắn `HistoryPanel`)
- Create: `web/src/components/OverdueView.tsx`, `web/src/components/HistoryPanel.tsx`
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: `GET /api/overdue → { overdue: OverdueTask[] }`, `GET /api/conversations/:id/history → { history: HistoryEntry[] }` (đã có, đã có test backend).
- Produces: `HistoryPanel({ conversationId })` hiện mỗi dòng "AI đề xuất `<giá trị>` · `<trạng thái>` bởi `<ai>` lúc `<giờ>`" kèm `EvidenceQuote`.

- [ ] **Step 1: Test đỏ trong `App.test.tsx`:** (a) bấm thẻ "Việc quá hạn" → hiện đúng 2 việc (Anh Đức, Chị Ngọc) với "quá hạn 1 ngày"; (b) bấm "Anh Đức" → mở hội thoại và `HistoryPanel` hiện "AI đề xuất" cùng người duyệt; (c) đổi sang chị Hà vẫn xem được.
- [ ] **Step 2: Chạy `cd web && npx vitest run src/App.test.tsx`, thấy đỏ.**
- [ ] **Step 3: Cài đặt** thẻ thành `button` có `aria-label`, màn `OverdueView`, `HistoryPanel`; không thêm route (vẫn chuyển màn bằng state).
- [ ] **Step 4: Chạy test và `typecheck`, thấy xanh; chạy Chrome trên backend thật (script cũ, cảnh 6) và xem ảnh chụp.**
- [ ] **Step 5: Commit** `G2: danh sách việc quá hạn và lịch sử duyệt`.

### Task G3: Nền dữ liệu cho cảnh 4–5

**Files:**
- Modify: `backend/src/db/schema.ts`, `backend/src/demo/seed.ts` (seed sản phẩm), `backend/src/extraction/types.ts` (`ALL_FIELDS` thêm `sku`, `unit_price`)
- Create: `backend/drizzle/0004_*.sql` (sinh bằng `npm run db:generate`, kiểm tay thứ tự UNIQUE trước khóa ngoại ghép như migration 0003)
- Test: `backend/tests/db-orders.test.ts`

**Interfaces (Produces):**
- Enum `proposal_field` thêm `sku`, `unit_price`. Enum mới `order_status` (`draft`, `awaiting_deposit`, `confirmed`, `cancelled`), `payment_status` (`proposed`, `confirmed`, `rejected`), `reply_draft_kind` (`confirm_order`, `top_up`, `deposit_received`), `reply_draft_status` (`pending`, `copied`, `dismissed`).
- `tenants` thêm `deposit_percent integer not null default 50`, `payment_instructions text`, `next_order_no integer not null default 1`.
- `products(id, tenant_id, sku, name, price_vnd bigint)` UNIQUE `(tenant_id, sku)`.
- `orders(id, tenant_id, conversation_id, code text null, status, customer_name, phone, address, sku, product_name, quantity int, unit_price_vnd bigint, total_vnd bigint, deposit_required_vnd bigint, deposit_paid_vnd bigint default 0, flags text[], sale_edited_at, sent_at, confirmed_at, confirmed_by, created_at)`. UNIQUE `(tenant_id, code)`; UNIQUE một phần: một đơn mở (`draft` hoặc `awaiting_deposit`) mỗi hội thoại.
- `payments(id, tenant_id, conversation_id, order_id null, message_id uuid UNIQUE → messages.id, status, read_ok boolean, amount_vnd bigint null, transfer_note text null, bill_time text null, bbox jsonb null, read_model text, amount_edited boolean default false, confirmed_by, confirmed_at, created_at)`.
- `reply_drafts(id, tenant_id, conversation_id, order_id, kind, text, status, decided_by, decided_at, created_at)`.
- Mọi khóa ngoại ghép theo `(…, tenant_id)` như các bảng Module 2.
- Seed demo: sản phẩm `SF-021 / Sofa Milan xám / 12000000`; `payment_instructions = 'Chủ TK: NOI THAT MINH PHAT (DEMO), STK 0000 0000 000, Ngân hàng DEMO'` (giả, ghi rõ).

- [ ] **Step 1: Test đỏ `db-orders.test.ts`:** một đơn mở mỗi hội thoại (đơn thứ hai `draft` bị từ chối, đơn `confirmed` thì không chặn); `payments.message_id` UNIQUE; khóa ngoại ghép chặn đơn trỏ hội thoại của tenant khác; `(tenant_id, code)` UNIQUE; `deposit_percent` mặc định 50.
- [ ] **Step 2: Chạy, thấy đỏ:** `cd backend && npx vitest run tests/db-orders.test.ts`.
- [ ] **Step 3: Cài schema, sinh migration, sửa tay thứ tự nếu drizzle-kit sinh sai, seed sản phẩm; `wipeDemoTenant` thêm bảng mới theo thứ tự khóa ngoại (`reply_drafts`, `payments`, `orders`, `products` trước `messages`).**
- [ ] **Step 4: Chạy `npm test` toàn backend (542 + mới) hai lần liên tiếp, `typecheck`; `demo:reset` chạy 3 lần cho cùng kết quả.**
- [ ] **Step 5: Commit** `G3: bảng đơn hàng, khoản thanh toán, tin nháp, sản phẩm`.

### Task G4: Trích xuất cho cảnh 4: mã hàng, đơn giá, tách ngân sách khỏi giá

**Files:**
- Create: `backend/src/extraction/sku.ts`
- Modify: `backend/src/extraction/{types,offline-extractor,prompt,run}.ts` (`PROMPT_VERSION` → `'v2'`, `MODEL_FIELDS` thêm `unit_price`), `backend/src/extraction/anthropic-extractor.ts` (schema zod), `backend/src/followup/overview.ts` (`ConversationSummary.closeSignal`)
- Test: `backend/tests/extraction-tools.test.ts`, `backend/tests/extractor.test.ts`, `backend/tests/extraction-run.test.ts`

**Interfaces:**
- Produces: `findSkus(text: string): Array<{ value: string; start: number; end: number; text: string }>`: regex `\b[A-Z]{2,3}-\d{2,4}\b` không phân biệt hoa thường, `value` viết hoa. `run.ts` thêm `buildSkuProposal(customerMsgs)` (giống `buildPhoneProposal`; trường `sku` có câu gốc đã kiểm chứng).
- `unit_price` là trường mô hình (live) và luật (offline: số tiền đi sau "giá" hoặc "với giá"). Cả `sku` và `unit_price` thuộc nhóm mới `ORDER_FIELDS` trong `types.ts`: không hiện trên thẻ khách, không vào Hộp đề xuất, chỉ làm đầu vào đơn nháp. `budget` KHÔNG được khớp khi số tiền đứng ngay sau "giá".
- `ConversationSummary.closeSignal: { text: string; messageId: string } | null`: lấy từ đề xuất `message_purpose = buy_intent` có căn cứ ở tin khách mới nhất (cho huy hiệu "Tín hiệu chốt đơn, căn cứ 'Chốt luôn'").

- [ ] **Step 1: Test đỏ.** `extraction-tools`: `findSkus('mã SF-021 nhé')` → một kết quả đúng offset; `'sf-021'` → `value 'SF-021'`; `'SF-0'` → rỗng. `extractor` (offline) với tin cảnh 4 *"Anh xem ảnh thấy ổn rồi, lấy 1 bộ Sofa Milan xám mã SF-021, giá 12 triệu như em báo nhé. Chốt luôn."* → `quantity '1 bộ'`, `unit_price` chứa "12.000.000", `message_purpose buy_intent`, **không có** candidate `budget`. `extraction-run`: sau tin này, đề xuất `budget` cũ "≈ 15.000.000 ₫" vẫn là giá trị hiện tại (không bị thay); `sku` có đúng một đề xuất với evidence là chuỗi con của tin; `closeSignal.text === 'Chốt luôn'`.
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt.** Với live: thêm `unit_price` vào schema zod và prompt (nêu rõ "giá khách nhắc lại của cửa hàng không phải ngân sách"), cập nhật test fetch giả của `extractor.test.ts`.
- [ ] **Step 4: Chạy `npm run eval:extraction` (offline vẫn 12/12, câu gốc kiểm chứng đủ, ngày bị giải 0) cùng toàn bộ test. Rồi chạy lại với `AI_MODE=live` (cần khóa) trên đúng các câu của cảnh 1, 3, 4:** thẻ khách phải ra sản phẩm, ngân sách, tên, mốc "cuối tuần này" có cờ hỏi lại, `unit_price` 12 triệu, không có `budget` ghi đè, ngày bị giải = 0; ghi kết quả, độ trễ, token vào `PROGRESS.md`. Thử `minLength`/`pattern` của strict decoding (điểm chưa xác minh #1 của Module 2). Kết quả live khác offline ở câu nào thì ghi lại, vì buổi diễn dùng live.
- [ ] **Step 5: Commit** `G4: trích mã hàng và đơn giá, tách ngân sách khỏi giá, tín hiệu chốt đơn`.

### Task G5: Đơn nháp và tin nháp (cảnh 4)

**Files:**
- Create: `backend/src/orders/draft.ts`, `backend/src/orders/service.ts`
- Modify: `backend/src/extraction/run.ts` (gọi dựng đơn nháp sau giao dịch trích xuất), `backend/src/api/{routes,read-models}.ts`, `web/src/api/{types,client,hooks}.ts`
- Create (web): `web/src/components/OrderDraftCard.tsx`, `web/src/components/ReplyDraftCard.tsx`; Modify: `web/src/components/ProposalBox.tsx`
- Test: `backend/tests/orders-draft.test.ts`, `backend/tests/api.test.ts`, `web/src/components/OrderDraftCard.test.tsx`

**Interfaces:**
- Produces: `buildOrderDraft(db: Db, tenantId: string, conversationId: string, now: Date): Promise<{ orderId: string; replyDraftId: string } | null>`: chỉ chạy khi có `closeSignal`, chưa có đơn mở. Điền: tên và SĐT (ưu tiên `profile_fields`, rồi đề xuất đang chờ), sản phẩm và `quantity` (mặc định 1), `sku` → tra `products` để lấy tên và **giá niêm yết**; địa chỉ để `null` ("Thiếu"). Nếu `unit_price` của khách khác giá niêm yết: dùng giá niêm yết và thêm cờ `price_mismatch`. `deposit_required_vnd = ceil(total × deposit_percent / 100)`. Không có `sku` hợp lệ thì không dựng đơn.
- `updateDraftOrder(db, { tenantId, orderId, by, patch: { address?: string; quantity?: number; customerName?: string; phone?: string } }, now): Promise<Order>`: đặt `sale_edited_at`; tính lại `total` và `deposit_required`; từ chối nếu đơn không còn `draft`.
- `sendReplyDraft(deps: { db; sender: MessageSender }, input: { tenantId: string; replyDraftId: string; by: string; text?: string }, now: Date): Promise<{ orderStatus: 'awaiting_deposit' | null; taskId: string | null }>`: `text` (nếu có) là bản Sale đã sửa, 1–1000 ký tự, lưu lại trong `reply_drafts.text`; gọi `sender.send(conversationId, text, now)`; sau khi gửi thành công mới đổi tin nháp sang `sent`. Với tin nháp `confirm_order`: đơn → `awaiting_deposit`, `sent_at = now`, tạo việc "Nhắc khách cọc" hạn `now + 24h` (`source: 'deposit_reminder'`). Gửi thất bại thì không đổi trạng thái nào. Idempotent theo trạng thái (lần hai trả 409, không gửi lại).
- `interface MessageSender { send(conversationId: string, text: string, now: Date): Promise<void> }`. Bản demo `DemoMessageSender` dựng echo với `app_id = FB_APP_ID` rồi ký và POST vào `/webhook` (dùng lại `simulatePageMessage`, thêm tham số `appId`). Đây là chỗ duy nhất sau này thay bằng Send API thật.
- Tin nháp: mẫu cố định từ đơn và `payment_instructions`, ví dụ "Dạ em xác nhận đơn: 1 bộ Sofa Milan xám (SF-021), 12.000.000 ₫. Anh vui lòng cọc 50% = 6.000.000 ₫ để em giữ hàng ạ. Thông tin chuyển khoản: …".
- API: `POST /api/orders/:id/update`, `POST /api/reply-drafts/:id/send { text? }`; `ConversationDetail` thêm `order: OrderView | null`, `replyDrafts: ReplyDraftView[]`.
- Web: `OrderDraftCard` hiện các trường, trường null có nhãn "Thiếu" (đỏ nhạt), ô nhập địa chỉ, dòng "AI chỉ điền nháp, Sale phải kiểm tra lại". `ReplyDraftCard` hiện tin nháp trong ô văn bản sửa được, nút "Gửi" (khóa khi đang gửi và khi ô trống), dòng "Demo: tin chưa gửi tới Facebook"; gửi xong tin hiện trong khung chat với nhãn "SalesMind".

- [ ] **Step 1: Test đỏ `orders-draft.test.ts`:** kịch bản cảnh 4 → đơn nháp `sku SF-021`, `quantity 1`, `unit_price_vnd 12000000`, `total 12000000`, `deposit_required 6000000`, `address null`, tin nháp chứa "6.000.000 ₫"; giá khách nêu 10 triệu → vẫn 12.000.000 và `flags` có `price_mismatch`; chạy hai lần chỉ một đơn; Sale sửa số lượng thành 2 rồi khách nhắn thêm → đơn không bị ghi đè (`sale_edited_at` còn); `sendReplyDraft` hai lần: lần sau 409, chỉ một tin trong `messages` và một việc nhắc cọc; `MessageSender` giả ném lỗi → tin nháp vẫn `pending`, đơn vẫn `draft`; gửi bản đã sửa → tin lưu đúng bản sửa; tin gửi ra có `sender_kind = 'page_app'` và `direction = 'outbound'`. `api.test.ts`: chạy cảnh 0–4 qua API, `order.status` `draft` rồi `awaiting_deposit` sau khi "gửi". Web: thẻ đơn nháp có nhãn "Thiếu" ở địa chỉ; nút "Gửi" gửi đúng văn bản đã sửa một lần.
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt theo Interfaces.** Một nơi gọi `buildOrderDraft` (cuối `runExtraction`, ngoài giao dịch, lỗi không làm hỏng run).
- [ ] **Step 4: Chạy test hai bộ + `typecheck`. Chạy Chrome tới hết cảnh 4, xem ảnh chụp.**
- [ ] **Step 5: Commit** `G5: đơn nháp và tin nháp xác nhận (cảnh 4)`.

### Task G6: Ảnh bill và đọc bill (đầu cảnh 5)

**Files:**
- Create: `backend/src/orders/deposit.ts`, `backend/src/bills/{types,offline-bill-reader,anthropic-bill-reader,read,schedule}.ts`, `backend/scripts/make-demo-bills.mjs`, `backend/demo-assets/bill-6000000.png`, `backend/demo-assets/bill-3000000.png`
- Modify: `backend/src/demo/simulator.ts` (`customerImagePayload`), `backend/src/demo/actions.ts` (`simulateCustomerImage`), `backend/src/queue/{boss,admin}.ts` (hàng đợi `read-bill` + dead-letter), `backend/src/server.ts` (worker), `backend/src/config/env.ts`, `backend/src/api/{routes,read-models}.ts`, `backend/tests/observability.test.ts` (đếm queue 7 → 9)
- Test: `backend/tests/bills.test.ts`, `backend/tests/bill-reader.test.ts`, `backend/tests/api.test.ts`

**Interfaces:**
- Produces: `evaluateDeposit(amountVnd: number, totalVnd: number, percent: number): { ratioPercent: number; verdict: 'ok' | 'below' }`; 6.000.000/12.000.000/50 → `{50, 'ok'}`; 3.000.000 → `{25, 'below'}`; `totalVnd <= 0` ném lỗi.
- `interface BillReader { readonly model: string; read(image: { bytes: Uint8Array; mediaType: 'image/png' | 'image/jpeg' }): Promise<BillReadOutcome> }` với `BillReadOutcome = { kind: 'ok'; amountVnd: number; transferNote: string | null; billTime: string | null; bbox: { x: number; y: number; w: number; h: number } | null } | { kind: 'unreadable' | 'refused' | 'invalid' }`. Số tiền phải là số nguyên trong `1..10_000_000_000`; `bbox` ngoài `[0,1]` thì bỏ (không ném).
- `OfflineBillReader`: tra bảng `sha256(bytes) → kết quả` cho hai ảnh mẫu; ảnh khác → `unreadable`. `AnthropicBillReader`: `messages.create` với khối ảnh base64, `output_config.format` từ zod, kiểm `stop_reason` như `AnthropicExtractor`.
- `readBill(deps: { db; reader: BillReader; assetDir: string; log }, messageId: string, now: Date): Promise<{ status: 'created' | 'skipped'; reason?: string }>`: chỉ xử lý tin **khách** có `attachments` loại `image`, tenant bật AI; ảnh lấy từ `demo-assets` theo tên file trong URL (chỉ khi `DEMO_MODE`; URL ngoài thì `skipped`). Ghi `payments` (`proposed`; `read_ok=false` khi `unreadable`) `ON CONFLICT (message_id) DO NOTHING`. Gắn `order_id` là đơn đang `awaiting_deposit` của hội thoại (nếu có).
- `GET /api/demo/assets/:file` (chỉ `DEMO_MODE`, tên trong danh sách cho phép, `Cache-Control: no-store`). `POST /api/demo/customer-image { persona | conversationId, file: 'bill-6000000.png' | 'bill-3000000.png' | 'sofa.png' }` dựng hai sự kiện (ảnh rồi chữ nếu có `caption`) qua `/webhook` có ký. `ConversationDetail.payments: PaymentView[]` với `verdict` và `ratioPercent` tính khi đọc; `MessageView` thêm `imageUrl: string | null`.
- Env: `BILL_ASSET_DIR` (mặc định `backend/demo-assets`).

- [ ] **Step 1: Test đỏ.** `bills.test.ts`: `evaluateDeposit` đủ ca biên (đúng 50% là `ok`, 49,99% là `below`); bill 6tr → `payments` `proposed`, `amount 6000000`, `verdict ok`; bill 3tr → `below`; ảnh `sofa.png` → `read_ok=false` và **không** có `verdict`; gửi lại cùng tin ảnh (mid trùng và chạy `readBill` hai lần) → một dòng; ảnh trong tin của Page (echo) → `skipped`; tenant tắt AI → `skipped`. `bill-reader.test.ts` (fetch giả): thành công, số tiền âm hoặc 0 hoặc dạng chữ → `invalid`, `bbox` ngoài khoảng bị bỏ, 429/500 ném lỗi để retry, khóa API không lọt vào lỗi. `api.test.ts`: ảnh + câu "Anh chuyển cọc rồi nhé" → `payments` trong chi tiết và ảnh truy cập được qua `/api/demo/assets/...`, `404` khi không bật `DEMO_MODE`, `404` với tên file ngoài danh sách.
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Tạo ba ảnh tự dựng trước tiên** (HTML tự viết, chụp bằng Chrome qua `make-demo-bills.mjs`; không logo ngân hàng thật; 6.000.000 VND, nội dung "Minh coc SF-021", 13/11/2026 10:09; bản 3.000.000 cùng bố cục; một `sofa.png` đơn giản). **Thử ngay với Claude thật** (`AI_MODE=live`, cần khóa): đọc cả ba ảnh vài lần, ghi vào `PROGRESS.md` số tiền đúng hay sai, `bbox` có đáng tin không, độ trễ, token. Nếu đọc sai số tiền thì chỉnh ảnh (chữ to hơn) và prompt trước khi xây tiếp; nếu `bbox` sai thì bỏ khoanh vùng. Sau đó ghi SHA-256 vào bảng của `OfflineBillReader` (đường lui) và cài đặt phần còn lại.
- [ ] **Step 4: Chạy toàn bộ test hai lần, `typecheck`.**
- [ ] **Step 5: Commit** `G6: ảnh bill, bộ đọc bill (offline và Claude), hàng đợi read-bill`.

### Task G7: Xác nhận cọc và tạo đơn (cuối cảnh 5), tiền cọc hôm nay

**Files:**
- Modify: `backend/src/orders/service.ts`, `backend/src/followup/overview.ts` (`HomeData` thêm `depositToday`, `orders`; `AiStats.approved` theo quyết định số 5), `backend/src/api/{routes,read-models}.ts`
- Create: `backend/src/util/vn-time.ts` (`startOfVnDay(now: Date): Date`)
- Test: `backend/tests/orders-service.test.ts`, `backend/tests/api.test.ts`

**Interfaces:**
- Produces: `confirmDeposit(db, { tenantId, paymentId, by, amountVnd?: number }, now): Promise<{ orderId: string; depositPaidVnd: number; createOrderProposed: true }>`: bắt buộc `payment.status = 'proposed'`, `read_ok`, có `order_id`; `amountVnd` khác số AI đọc thì đặt `amount_edited` (tính vào `saleEdited`); cộng `deposit_paid_vnd` bằng một câu `UPDATE … SET deposit_paid_vnd = deposit_paid_vnd + $x WHERE … AND status='proposed'` trong cùng giao dịch với việc đổi trạng thái khoản; sinh tin nháp `deposit_received`. `rejectPayment(db, { tenantId, paymentId, by }, now)`; bill `below` sinh tin nháp `top_up` ("nhắc chuyển nốt").
- `confirmOrder(db, { tenantId, orderId, by, address: string }, now): Promise<{ code: string }>`: yêu cầu `deposit_paid_vnd >= deposit_required_vnd`, `address` 6–200 ký tự (sau trim); cấp `code = 'DH-' + lpad(next_order_no, 4, '0')` bằng `UPDATE tenants SET next_order_no = next_order_no + 1 … RETURNING` trong cùng giao dịch; đơn → `confirmed`; đóng việc "Nhắc khách cọc".
- `loadHome` thêm `depositToday: number` = tổng khoản `confirmed` có `confirmed_at ≥ startOfVnDay(now)` và `< +24h`; `orders: OrderRow[]` cho màn Đơn hàng. API: `POST /api/payments/:id/confirm`, `POST /api/payments/:id/reject`, `POST /api/orders/:id/confirm`, `GET /api/orders`. Lỗi: `409 not_pending`, `422 deposit_not_reached | address_required`.

- [ ] **Step 1: Test đỏ `orders-service.test.ts`:** xác nhận bill 6tr → `deposit_paid 6000000`, `createOrderProposed`; `Promise.all` hai lần `confirmDeposit` cùng khoản → đúng một thành công, tiền cộng một lần; `confirmOrder` thiếu địa chỉ, địa chỉ 3 ký tự, hoặc chưa đủ cọc → lỗi đúng mã; hai đơn xác nhận liên tiếp ra `DH-0001`, `DH-0002` (kể cả chạy đồng thời); xác nhận sửa số tiền 5.900.000 → `amount_edited` và `saleEdited` tăng. `depositToday`: xác nhận 23:50 giờ VN, tua qua 00:10 hôm sau → `depositToday` về 0 (khoản vẫn còn trong `orders`); bill 3tr bị từ chối → không cộng, có tin nháp `top_up`. `api.test.ts`: chạy cả cảnh 0–6; Trang chủ chị Hà `depositToday 6000000`, `P1 = 1` (chị Thu).
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt theo Interfaces; bất kỳ nơi nào cộng tiền hoặc cấp mã chỉ đi qua `service.ts`.**
- [ ] **Step 4: Chạy toàn bộ test hai lần, `typecheck`; mutation thử:** bỏ điều kiện `status='proposed'` trong `UPDATE` thì test đua phải đỏ.
- [ ] **Step 5: Commit** `G7: xác nhận cọc, tạo đơn, tiền cọc hôm nay`.

### Task G8: Giao diện cảnh 4–5 và màn Đơn hàng

**Files:**
- Create: `web/src/components/{BillCard,DepositCard,OrdersView}.tsx`
- Modify: `web/src/components/{ChatPane,ProposalBox,SimulatorPanel,HomeView,SideNav}.tsx`, `web/src/state/session.tsx` (`View` thêm `'orders'`), `web/src/api/{types,client,hooks}.ts`, `web/src/lib/fields.ts`
- Test: `web/src/components/BillCard.test.tsx`, `web/src/App.test.tsx`

**Interfaces:**
- Consumes: toàn bộ API của G5–G7.
- Produces: tin ảnh hiện ảnh thu nhỏ trong khung chat (`alt` mô tả, bấm để phóng to); huy hiệu "Tín hiệu chốt đơn" với câu gốc; `BillCard` hiện ảnh, vùng `bbox` (nếu có), số tiền, nội dung chuyển khoản, dòng "6.000.000 / 12.000.000 = 50%, đạt ngưỡng ≥ 50%" hoặc "dưới 50%", nhãn "AI chỉ đọc số tiền, trạng thái thanh toán do Sale xác nhận", nút "Xác nhận đã cọc" và "Bỏ qua"; ảnh không đọc được hiện "Không đọc được số tiền: Sale nhập tay hoặc bỏ qua". `DepositCard` ("Tạo đơn"): ô địa chỉ bắt buộc, nút "Xác nhận tạo đơn", thông báo "Đã tạo đơn #DH-0001". `OrdersView`: bảng Mã · Khách · Sản phẩm · Tổng · Đã cọc · Còn lại · Trạng thái. Trang chủ: thẻ "Tiền cọc hôm nay" bỏ "Sắp có", hiện `depositToday` định dạng VND. Bảng Giả lập: câu mẫu cảnh 4, ba nút "Gửi ảnh bill 6 triệu", "Gửi ảnh bill 3 triệu", "Gửi ảnh sofa (không phải bill)", và mốc tua "Cảnh 4: Thứ Sáu 09:50", "Cảnh 5: Thứ Sáu 10:10", "Cảnh 6: Thứ Sáu 10:30".

- [ ] **Step 1: Test đỏ.** `BillCard.test.tsx`: 6tr → "đạt ngưỡng", nút "Xác nhận đã cọc" bật; 3tr → "dưới 50%", **không** có chữ "Đã cọc đủ điều kiện"; không đọc được → không có nút xác nhận và không có phần trăm. `App.test.tsx`: sau xác nhận cọc, hộp đề xuất hiện thẻ "Tạo đơn", nút khóa tới khi nhập địa chỉ; bấm "Xác nhận đã cọc" hai lần liên tiếp chỉ gửi một request (nút khóa khi đang chờ); `OrdersView` đúng số liệu; Trang chủ "6.000.000 ₫".
- [ ] **Step 2: Chạy `cd web && npx vitest run`, thấy đỏ.**
- [ ] **Step 3: Cài đặt; trạng thái màn không có Router như cũ. Rà trợ năng theo `web-design-guidelines` cho các thẻ mới (nhãn, focus, `aria-live` cho thông báo tạo đơn).**
- [ ] **Step 4: Chạy test, `typecheck`, `npm run build`; chạy Chrome tới hết cảnh 5 và xem ảnh chụp.**
- [ ] **Step 5: Commit** `G8: giao diện đơn nháp, bill, xác nhận cọc, màn Đơn hàng`.

### Task G9: Chạy trọn 8 cảnh, Claude thật, đồng bộ tài liệu

**Files:**
- Create: `web/e2e/run.mjs` (chuyển từ script ngoài repo, thêm cảnh 4–5, biến thể, kiểm tra không lỗi console/HTTP), `web/package.json` (devDependency `puppeteer-core`, script `e2e`)
- Modify: `doc/KICH-BAN-DEMO-MVP.md` (theo "Quyết định đã chọn" 4, 6, 7, số liệu thật, thời lượng, bỏ nhãn "chưa có" ở mục 8), `doc/CHAY-DEMO.md`, `CLAUDE.md` (bảng mới, quy tắc "dòng AI tạo ra chỉ ở `draft`/`proposed`", hàng đợi `read-bill`), `README.md`, `PROGRESS.md`

- [ ] **Step 1: Mở rộng `web/e2e/run.mjs`:** đi cảnh 0 → 1 → 2 → 3 → 4 → 5 → 6, rồi hai biến thể (bill 3 triệu → "dưới 50%" và gợi ý "nhắc chuyển nốt"; sửa trường AI điền sai → "Đã sửa bởi Lan", "Sale phải sửa" = 1); assert khớp số liệu cuối kịch bản (P1 = 1, quá hạn = 2, `depositToday` 6.000.000 ₫, hỏi lại ngày = 1). Chạy 3 lần liên tiếp, mỗi lần mở bằng "Đặt lại demo": **cả 3 lần đạt, không lỗi console, không HTTP ≥ 400** (trừ lỗi 4xx có chủ ý của biến thể).
- [ ] **Step 2: Chạy `npm test` backend 3 lần liên tiếp và `web` test, `typecheck`, `build`.** Không flaky.
- [ ] **Step 3 (cần `ANTHROPIC_API_KEY`, bỏ qua nếu chưa có và ghi rõ trong PROGRESS):** `AI_MODE=live`, chạy `npm run eval:extraction` và đọc ảnh bill 6tr, 3tr, sofa; ghi vào PROGRESS: số tiền đúng hay sai, độ trễ, token, điểm chưa xác minh #1–#4 của Module 2 và câu hỏi "Claude có trả `bbox` đáng tin không" (nếu không, bỏ khoanh vùng, giữ số tiền).
- [ ] **Step 4: Cập nhật tài liệu;** quay video dự phòng toàn kịch bản; chạy `code-review` (medium) trên toàn bộ diff từ G1; sửa phát hiện; đóng Module 2 mốc 7 (README, quan sát).
- [ ] **Step 5: Commit** `G9: chạy trọn 8 cảnh, đồng bộ kịch bản và tài liệu`.

---

## Thứ tự thực hiện đề xuất và phụ thuộc

1. **Ngay hôm nay, song song:** bạn bắt đầu K0 (Meta App, Page thử, tester, tunnel) và, nếu muốn Page ra Live, bắt đầu thủ tục K6 vì chờ duyệt lâu. Tôi làm G1, G2.
2. **K0** chạy xong trước khi làm K2–K4 (cần biết thực tế của Meta).
3. **K1** trước mọi thứ có Page thật (chặn lộ API qua tunnel).
4. **G3 → G4 → G5**; G5 dùng interface `MessageSender`, K4 thay bản gửi thật vào mà không đổi giao diện.
5. **K2, K3, K4** sau K1; **G6, G7, G8** song song với K nếu làm một mình thì xen kẽ: K2 → G6 → K3 → G7 → K4 → G8.
6. **K5** làm cùng G6; **G9** cuối cùng, chạy cả hai không gian.

**Ước lượng cộng thêm của phần K:** K0 1 ngày (cần bạn), K1 1, K2 2, K3 1,5, K4 2, K5 0,5, K6 1,5 code cộng thời gian chờ Meta: khoảng 9,5 ngày. Tổng cả kế hoạch khoảng 20 ngày làm việc. Muốn có "demo kết nối thật" sớm nhất thì cắt như sau: K0, K1, K2, K4 trước (bốn mốc này là đường tối thiểu: kết nối, nhận, trả lời thật), còn G4–G8 (đơn và bill) làm sau.

## Tự rà soát (đã chạy)

## Phần K: Kết nối Page Facebook thật (kiểu Pancake)

> **Cập nhật 2026-11-10:** người dùng cần **đăng nhập thật và nhiều Page cho mỗi doanh nghiệp**. Vì vậy **Task K1 (không gian "Page thật") và K2 (màn Kết nối) bị thay bằng P1–P5 của [PLAN-san-pham.md](PLAN-san-pham.md)**; K3 và K4 chuyển thành P7; K5 và K6 giữ nguyên (K6 mở rộng thành P10). Các mô tả K1 và K2 bên dưới chỉ còn để tham khảo, **không làm theo**. K0 vẫn là điều kiện chặn đầu tiên.

Mục tiêu: người dùng bấm "Kết nối Facebook" ngay trong giao diện, chọn Page ở hộp thoại của Facebook, rồi thấy tin của khách thật vào Hộp thư, trả lời và bấm "Gửi" thì tin **tới Messenger thật**. Phần G ở trên chạy trên dữ liệu demo; phần K thêm một **không gian làm việc thứ hai, "Page thật"**, chạy song song và không bao giờ bị `demo:reset` đụng tới. Cùng một giao diện, cùng các thẻ (đề xuất, đơn nháp, bill), chỉ khác nguồn dữ liệu.

**Điều đã có sẵn từ Module 1:** đăng nhập Facebook (OAuth, state gắn cookie), đổi token dài hạn, lưu Page token mã hóa, đăng ký webhook cấp Page, nhận webhook có chữ ký, lưu cả echo, backfill, hướng dẫn thử [KET-NOI-PAGE.md](KET-NOI-PAGE.md). **Chưa có:** giao diện kết nối (hiện phải chạy CLI `tenant:create` rồi mở liên kết), gửi tin, tên khách, hiện ảnh thật, bảo vệ API khi mở ra Internet, và **chưa từng chạy với Meta thật** (`FB_APP_ID` trong `.env` vẫn là `changeme-app-id`).

### Giới hạn bắt buộc phải nói rõ với người dùng

- **Không có đăng nhập người dùng trong SalesMind.** Một không gian làm việc cho một người vận hành, như demo. "Kiểu Pancake" ở đây nghĩa là luồng *kết nối Page* và *nhắn tin hai chiều*, không phải đa tài khoản, phân công hội thoại hay phân quyền. Làm tài khoản thật là một mốc riêng.
- **App Meta ở chế độ Development chỉ nhận tin từ tài khoản có vai trò trong app** (admin, developer, tester). Pancake nhắn được với khách bất kỳ vì app của họ đã qua App Review. Muốn như vậy phải làm Task K6 (thời gian chờ Meta tính bằng tuần, không phụ thuộc code).
- **Dữ liệu khách thật vào DB là dữ liệu cá nhân.** AI trích xuất cho không gian "Page thật" mặc định **tắt**, bật bằng công tắc riêng kèm cảnh báo pháp lý (Luật 91/2025/QH15 chưa được luật sư xác nhận: chỉ bật với tài khoản tester của chính bạn).
- **Tunnel (ngrok, cloudflared) đưa cả cổng 3000 ra Internet, gồm `/api/*` vốn không có đăng nhập.** Task K1 chặn việc này trước khi bất kỳ Page thật nào được kết nối.

### Task K0: Dựng Meta App và chạy thử luồng sẵn có với Page thật (bạn làm cùng tôi)

Không có code mới. Đây là điều kiện chặn cho K2–K4 vì nó trả lời các điểm Module 1 chưa xác minh (đơn vị `timestamp`, echo, `app_id` thật, `me/accounts`, `config_id`).

- [ ] **Step 1 (bạn):** tạo Meta App loại Business (hoặc dùng app có sẵn), một Page thử, và một tài khoản Facebook thứ hai làm tester; thêm tester vào app. Mở tunnel HTTPS tới cổng 3000. Điền `FB_APP_ID`, `APP_SECRET`, `PUBLIC_BASE_URL` vào `backend/.env` (không dán App Secret vào chat). Khai báo Redirect URI, Webhook và 7 field theo [KET-NOI-PAGE.md](KET-NOI-PAGE.md) mục A.
- [ ] **Step 2 (cùng làm):** chạy mục B, C, C1, C2 của hướng dẫn trên; ghi kết quả từng điểm vào mục "Điểm Meta API" của `PROGRESS.md` (đổi "chưa xác minh" thành bằng chứng thật).
- [ ] **Step 3:** sửa mọi chỗ code lệch thực tế (ví dụ `timestamp`, phân loại `app_id`, `FB_LOGIN_CONFIG_ID`), mỗi chỗ có test tái hiện bằng payload thật đã bỏ thông tin riêng. Đóng Module 1 mốc 4 và 5 trong `PROGRESS.md` nếu đạt. Commit `K0: xác minh Meta thật, sửa theo thực tế`.

### Task K1: Không gian "Page thật" và bảo vệ API khi có tunnel

**Files:**
- Create: `backend/src/api/guard.ts`, `backend/src/api/workspace.ts`
- Modify: `backend/src/api/routes.ts` (mọi route nhận không gian làm việc), `backend/src/config/env.ts`, `backend/src/demo/seed.ts` (tách khỏi tenant thật), `web/src/state/session.tsx`, `web/src/components/TopBar.tsx`, `web/src/api/client.ts`
- Test: `backend/tests/api-guard.test.ts`, `backend/tests/api-workspace.test.ts`

**Interfaces:**
- `isLocalRequest(req: { headers: Record<string, string | string[] | undefined>; ip: string }): boolean`: đúng khi `Host` là `127.0.0.1`, `localhost` hoặc `[::1]` (mọi cổng) **và** không có header `x-forwarded-for`, `x-forwarded-host`, `forwarded`, `ngrok-*`, `cf-connecting-ip`. `/api/*` trả `403 not_local` khi sai; `/webhook`, `/auth/facebook/*`, `/healthz`, `/readyz` không bị ảnh hưởng. Biến `API_ALLOW_REMOTE=true` bỏ chặn (mặc định tắt, ghi cảnh báo ở log khi bật, từ chối khi `NODE_ENV=production`).
- `type Workspace = 'demo' | 'live'`, đọc từ header `x-workspace` (mặc định `demo`). `resolveWorkspace(db, ws): Promise<{ tenantId: string; now: () => Promise<Date>; simulator: boolean } | null>`: `demo` dùng tenant tên "Nội thất Minh Phát (demo)" và đồng hồ demo; `live` dùng tenant **không** phải demo (tạo "Cửa hàng của tôi" nếu chưa có), `now` là giờ thật, `simulator = false`. Route giả lập, tua đồng hồ, `demo/reset` trả `404` ở không gian `live`.
- Web: `session.workspace`, công tắc "Dữ liệu demo | Page thật" ở TopBar, gửi `x-workspace`; ở `live` ẩn nút Đặt lại, Tua đồng hồ, Giả lập; mỗi dòng dữ liệu `live` có biểu ngữ "Dữ liệu khách thật".

- [ ] **Step 1: Test đỏ.** `api-guard`: request `Host: abc.ngrok-free.app` → 403; `Host: 127.0.0.1:3000` + `x-forwarded-for` → 403; `Host: localhost:5173` không header lạ → 200; `/webhook` và `/healthz` qua `Host` lạ vẫn hoạt động. `api-workspace`: `x-workspace: live` dùng tenant khác, `demo:reset` chạy xong thì tenant `live` và Page của nó còn nguyên (test kiểm số dòng trước và sau); `live` gọi `clock/advance` → 404; `now` của `live` bằng giờ thật dù đồng hồ demo đang lệch; dữ liệu hai không gian không lẫn (inbox `live` không có "Chị Thu").
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt theo Interfaces.** Một hook `onRequest` duy nhất cho `/api/*`; `resolveWorkspace` là nơi duy nhất chọn tenant và `now`.
- [ ] **Step 4: Chạy toàn bộ test hai lần, `typecheck`. Thử thật:** mở tunnel, `curl https://<tunnel>/api/home` phải ra 403.
- [ ] **Step 5: Commit** `K1: không gian Page thật, chặn API khi qua tunnel`.

### Task K2: Màn "Kết nối Page" (luồng giống Pancake)

**Files:**
- Create: `backend/src/api/pages.ts`, `web/src/components/ConnectView.tsx`
- Modify: `backend/src/auth/oauth-routes.ts` (callback chuyển hướng về web), `backend/src/meta/graph-client.ts` (`unsubscribeApp`), `backend/src/db/schema.ts` + migration `0005_*.sql` (`pages.status` thêm `disconnected`), `backend/src/config/env.ts` (`WEB_BASE_URL`), `web/src/{state/session.tsx,components/SideNav.tsx,api/*}`
- Test: `backend/tests/api-pages.test.ts`, `backend/tests/oauth-routes.test.ts`, `web/src/components/ConnectView.test.tsx`

**Interfaces:**
- `POST /api/pages/connect-url` (chỉ `live`) → `{ url: string; expiresAt: string }`: cấp state một lần cho tenant `live` (dùng lại hàm tạo liên kết của CLI `tenant:connect-url`). `GET /api/pages` → `{ pages: PageView[] }` với `PageView = { id; fbPageId; name; status: 'active' | 'token_invalid' | 'disconnected'; webhookSubscribed: boolean; conversations: number; lastMessageAt: string | null; aiEnabled: boolean; backfill: { state: string; saved: number } | null }`; **không bao giờ** trả token. `POST /api/pages/:id/disconnect` → gọi `DELETE /{page-id}/subscribed_apps` bằng Page token rồi **xóa `token_enc`** (đặt rỗng hợp lệ) và `status = disconnected`; lỗi Meta không chặn việc xóa token cục bộ nhưng được báo lại. `POST /api/pages/:id/ai { enabled: boolean }` bật/tắt `tenants.ai_extraction_enabled` (cần `acknowledgeLegal: true` trong body khi bật). `POST /api/pages/:id/backfill` (xếp việc lấy lại tin cũ như CLI).
- Callback OAuth thành công: chuyển hướng `302` về `WEB_BASE_URL/?connected=<số Page>` (thay trang HTML tĩnh khi `WEB_BASE_URL` có đặt; không đặt thì giữ trang cũ). Lỗi: `WEB_BASE_URL/?connect_error=<mã ngắn>`, không đưa thông báo thô của Meta vào URL.
- Web: màn "Kết nối" (mục thứ ba ở SideNav, chỉ ở `live`): nút "Kết nối Facebook" mở liên kết ở tab mới, trang tự làm mới danh sách mỗi 2 giây tới khi có Page; mỗi Page là một thẻ (tên, đèn trạng thái, "Webhook: đã đăng ký" hoặc "Chưa nhận được tin", số hội thoại, tin gần nhất), nút "Kết nối lại" (khi `token_invalid`), "Lấy lại tin cũ", "Ngắt kết nối" (xác nhận hai bước), công tắc "AI trích xuất" mặc định tắt kèm cảnh báo pháp lý. Thông báo lỗi dễ hiểu cho các lỗi đã biết (thiếu quyền, `redirect_uri`, liên kết hết hạn).

- [ ] **Step 1: Test đỏ.** `api-pages` (Graph giả): `connect-url` ở `demo` → 404; `GET /api/pages` không có chuỗi `token` hay `EAA` nào trong JSON; `disconnect` gọi đúng một lần `subscribed_apps` DELETE, `token_enc` bị xóa dù Meta trả 400, tin đến sau đó từ Page này không còn được xử lý như Page đang hoạt động; bật AI thiếu `acknowledgeLegal` → 422. `oauth-routes`: thành công → `302` tới `WEB_BASE_URL/?connected=1`; Meta trả lỗi → `?connect_error=` không chứa thông báo thô. Web: nút "Ngắt kết nối" phải bấm hai lần; công tắc AI tắt mặc định và hiện cảnh báo.
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt theo Interfaces.**
- [ ] **Step 4: Chạy test hai bộ, `typecheck`. Thử thật (cần K0):** bấm "Kết nối Facebook", đi hết hộp thoại, thấy Page hiện trong danh sách với "Webhook: đã đăng ký"; ngắt kết nối và kết nối lại; chụp ảnh.
- [ ] **Step 5: Commit** `K2: màn kết nối Page Facebook trong giao diện`.

### Task K3: Hộp thư thật: tên khách, ảnh thật, tin chưa đọc

**Files:**
- Create: `backend/src/meta/profile.ts`, `backend/src/workers/resolve-name.ts`
- Modify: `backend/src/meta/graph-client.ts` (`getUserProfile`), `backend/src/workers/process-webhook.ts` (xếp việc lấy tên cho hội thoại mới), `backend/src/api/read-models.ts` (`MessageView.attachments`), `web/src/components/{ChatPane,InboxList}.tsx`
- Test: `backend/tests/profile.test.ts`, `web/src/components/ChatView.test.tsx`

**Interfaces:**
- `GraphClient.getUserProfile(pageToken: string, psid: string): Promise<{ name: string } | null>`: `GET /{psid}?fields=name`; lỗi quyền hoặc người dùng không cho phép trả `null` (không ném). `resolveConversationName(deps, conversationId): Promise<'set' | 'skipped' | 'unavailable'>` chỉ ghi `conversations.display_name` khi còn trống, chạy như job nền (lỗi tạm thời thì retry, `null` thì dùng tên dự phòng "Khách ####" sẵn có). Không log tên.
- `MessageView.attachments: Array<{ type: 'image' | 'audio' | 'video' | 'file' | 'sticker' | 'other'; url: string | null }>` (chỉ `https://` và host thuộc `*.fbcdn.net` hoặc `*.facebook.com`, còn lại `url = null`). Web hiện ảnh thật (`loading="lazy"`, `alt` mô tả), loại khác hiện chip "Tệp đính kèm"; ảnh lỗi (URL Meta hết hạn) hiện khung "Ảnh không còn tải được".
- Inbox `live`: chấm "Mới" cho hội thoại khách nhắn mà Page chưa trả lời (đã có `isNew`), phân trang cứng 100 hội thoại gần nhất kèm dòng "Còn N hội thoại cũ hơn" (không cuộn vô hạn).

- [ ] **Step 1: Test đỏ.** `profile`: tin đầu của khách → đúng một job lấy tên; `getUserProfile` trả `null` thì tên vẫn là "Khách ####" và không retry vô hạn; tên có dấu và emoji lưu đúng; không ghi đè tên Sale đã đặt. `ChatView`: URL `http://evil` hoặc `javascript:` không thành `<img>`; ảnh từ host lạ bị loại.
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt.** Thử thật (K0): khách tester nhắn chữ, ảnh, sticker: tên hiện, ảnh hiện.
- [ ] **Step 4: Chạy test hai bộ, `typecheck`.**
- [ ] **Step 5: Commit** `K3: tên khách, ảnh và tệp đính kèm trong hộp thư thật`.

### Task K4: Gửi tin thật qua Messenger

**Files:**
- Create: `backend/src/send/graph-sender.ts`, `backend/src/send/window.ts`
- Modify: `backend/src/meta/graph-client.ts` (`sendText`), `backend/src/db/schema.ts` + migration (`message_source` thêm `send`), `backend/src/workers/store-messages.ts` (khử trùng echo với tin `send`), `backend/src/api/routes.ts` (`POST /api/conversations/:id/send`), `web/src/components/ChatPane.tsx`, `CLAUDE.md`
- Test: `backend/tests/send.test.ts`, `backend/tests/webhook-pipeline.test.ts`

**Interfaces:**
- `GraphClient.sendText(pageToken: string, psid: string, text: string, opts: { messagingType: 'RESPONSE' }): Promise<{ messageId: string }>`: `POST /me/messages`, `recipient.id = psid`, `message.text`. `GraphApiError` phân loại được: 190 (token), `window_closed`, `rate_limited`, `user_unavailable`.
- `sendWindow(lastUserInteractionAt: Date | null, now: Date): { open: boolean; closesAt: Date | null }`: cửa sổ 24 giờ kể từ `last_user_interaction_at` (tài liệu Meta cần đối chiếu lại khi làm; hằng số nằm **chỉ** trong `window.ts`). Cửa sổ đóng thì từ chối **trước khi** gọi Meta (`422 window_closed`, thông báo "Đã quá 24 giờ kể từ tin cuối của khách, Facebook không cho gửi chủ động").
- `GraphMessageSender implements MessageSender` (cùng interface với `DemoMessageSender` của G5): kiểm cửa sổ, kiểm Page `active`, gọi `sendText`, rồi **lưu ngay** tin vào `messages` với `mid = messageId`, `direction outbound`, `sender_kind page_app`, `source send`; `ON CONFLICT (mid) DO NOTHING` để khi echo đến cùng `mid` không tạo bản sao. Nếu echo đến với `mid` khác (điểm chưa xác minh), khử trùng dự phòng như backfill: cùng hội thoại, cùng text, trong 5 giây, hướng outbound.
- `POST /api/conversations/:id/send { text }` (cả khung chat tự do lẫn "Gửi" của tin nháp ở G5 dùng chung): `1..1000` ký tự; ở `demo` đi qua `DemoMessageSender`, ở `live` đi qua `GraphMessageSender`. **Không bao giờ có đường gửi không do Sale bấm**: không có job, cron hay hook nào gọi `send`.
- Web: ô soạn ở khung chat `live` có nút "Gửi" thật (khóa khi đang gửi, giữ văn bản khi lỗi, hiện lỗi cụ thể); biểu ngữ cửa sổ "Còn 3 giờ để trả lời" hoặc "Đã đóng, không gửi được"; ở `demo` giữ dòng "Demo: tin chưa gửi tới Facebook".

- [ ] **Step 1: Test đỏ (Graph giả).** Gửi thành công → một dòng `messages` đúng `mid`; echo cùng `mid` đến sau → vẫn một dòng; echo `mid` khác nhưng cùng text trong 5 giây → vẫn một dòng; cửa sổ 24 giờ vừa đúng và quá 1 giây (`open` đổi đúng tại biên); cửa sổ đóng → **không có request nào tới Graph**; Meta trả 190 → Page đánh dấu `token_invalid`, không lưu tin; Meta trả lỗi mạng → không lưu tin, văn bản giữ ở giao diện; hai lần bấm gửi liên tiếp (cùng nội dung, cùng giây) → hai tin riêng (đây là hành động có chủ ý), nhưng một lần bấm bị retry của client không nhân đôi (khóa idempotency `Idempotency-Key` từ web). Tin gửi cho khách của Page `disconnected` → 409.
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt.** Cập nhật `CLAUDE.md`: bỏ "Không gửi tin nhắn cho khách (module này chỉ đọc)", thay bằng quy tắc "chỉ gửi khi Sale bấm gửi, kiểm cửa sổ trước, không log nội dung tin".
- [ ] **Step 4: Chạy test hai bộ, `typecheck`. Thử thật (K0):** trả lời tester từ SalesMind, xem tin tới Messenger của tester, xem echo có trùng `mid` không, ghi kết quả vào `PROGRESS.md` (đóng điểm "`message_id` Send API có bằng `mid` của echo không"). Thử một hội thoại quá 24 giờ.
- [ ] **Step 5: Commit** `K4: gửi tin thật qua Send API, kiểm cửa sổ 24 giờ`.

### Task K5: Đọc bill và AI trên tin thật

Gộp vào G6 và G4: khi `readBill` chạy ở `live`, ảnh lấy từ URL của Meta (tải phía server, **chỉ** host `*.fbcdn.net` hoặc `*.facebook.com`, `https`, giới hạn 10 MB và 10 giây, từ chối chuyển hướng ra host ngoài danh sách để chống SSRF) thay vì thư mục `demo-assets`. Việc trích xuất AI ở `live` chạy khi công tắc AI của K2 bật. Test: URL `http://169.254.169.254/...` và host lạ bị `skipped`; ảnh quá 10 MB bị `skipped`; chuyển hướng ra host lạ bị chặn.

### Task K6: Đưa app ra chế độ Live để nhận khách bất kỳ (phần lớn là thủ tục, chạy song song)

Cần bắt đầu **sớm** vì chờ Meta duyệt tính bằng tuần, và có phần code nhỏ:

- **Code:** trang chính sách quyền riêng tư công khai (`GET /privacy`, nội dung nói rõ lưu gì, gửi AI nước ngoài khi nào, cách xóa); callback **xóa dữ liệu** `POST /meta/data-deletion` (Meta gửi `signed_request`, kiểm chữ ký bằng `APP_SECRET`, xóa tin, hồ sơ, đề xuất của PSID đó, trả `{ url, confirmation_code }`) và `GET /meta/data-deletion/status?code=`; callback `deauthorize`. Test: chữ ký sai → 400; xóa đúng một PSID, không đụng khách khác; chạy hai lần không lỗi.
- **Thủ tục (bạn làm, tôi chuẩn bị tài liệu):** xác minh doanh nghiệp (Business Verification), App Review xin Advanced Access cho `pages_messaging`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, quay video hướng dẫn từng quyền, và nếu cần gửi sau 24 giờ thì xin thêm quyền `human_agent` (tài liệu Meta cần đối chiếu lại). Tôi viết checklist và kịch bản video trong `doc/APP-REVIEW.md`.
- Commit `K6: trang quyền riêng tư, callback xóa dữ liệu, tài liệu App Review`.

---

- **Phủ kịch bản:** cảnh 0 (đã có) · 1: sửa trường AI, trả lời Page Inbox (G1) · 2: ngừng bám (đã có), dòng "đã xử lý" thành "biến mất" (quyết định 7) · 3: ngày quá khứ, giai đoạn "Theo dõi", lịch chăm sóc lại, "Duyệt N mục" (G1) · 4: tín hiệu chốt đơn, đơn nháp, tin nháp, sao chép, nhắc +1 ngày (G4, G5) · 5: bill, ngưỡng 50%, xác nhận cọc, địa chỉ, tạo đơn, màn Đơn hàng (G6–G8) · 6: danh sách quá hạn, lịch sử, tiền cọc (G2, G7, G8) · 7: không cần code · biến thể bill dưới ngưỡng (G6, G8, G9) và AI điền sai (G1, G9). Popup khi rê chuột: không làm, có quyết định 4.
- **Nhất quán tên:** `evaluateDeposit`, `buildOrderDraft`, `markReplyCopied`, `confirmDeposit`, `confirmOrder`, `readBill`, `BillReader`, `closeSignal`, `depositToday` dùng cùng một tên ở mọi mốc.
- **Phụ thuộc:** G1 và G2 độc lập với G3–G8. G4 → G5 → G6 → G7 → G8 tuần tự (G6 cần đơn `awaiting_deposit` của G5; G7 cần `payments` của G6).
- **Ước lượng:** G1 1 ngày, G2 0,5, G3 0,5, G4 1, G5 1,5, G6 2, G7 1,5, G8 2, G9 1: khoảng 11 ngày làm việc. Nếu trễ, cắt theo thứ tự: khoanh vùng `bbox`, màn Đơn hàng thành bảng tối giản, bill dưới ngưỡng (biến thể), `AnthropicBillReader` (giữ offline).
- **Rủi ro lớn nhất:** G6 với Claude thật (chưa từng gọi API ảnh); đã có đường lui offline. Rủi ro thứ hai: hai chế độ AI cho kết quả khác nhau ở cảnh 4 (câu "giá 12 triệu"); `eval:extraction` ở G4 và G9 bắt điều này.
