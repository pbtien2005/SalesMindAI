# Kế hoạch nền tảng nhiều người dùng: đăng nhập, nhiều doanh nghiệp, nhiều Page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một người dùng đăng ký hoặc được mời, đăng nhập vào SalesMind, tự kết nối một hoặc nhiều Page Facebook của doanh nghiệp mình, và cả đội nhìn thấy, trả lời tin của khách trên các Page đó. Dữ liệu của doanh nghiệp này không bao giờ lọt sang doanh nghiệp khác.

**Architecture:** Giữ nguyên mô hình `tenant` đã có từ Module 1 (mọi bảng đã có `tenant_id` và khóa ngoại ghép). Thêm `users`, `memberships`, `sessions`, `invitations`. API `/api/*` hiện cố định vào tenant demo; đổi thành lấy tenant từ **phiên đăng nhập**, không bao giờ từ dữ liệu client gửi lên. Demo trở thành một tenant thường có hai tài khoản thật (Lan là `sale`, chị Hà là `manager`) và vẫn chỉ bật khi `DEMO_MODE=true`. Backend phục vụ luôn bản build của `web/` cùng một origin để cookie phiên an toàn, không cần CORS.

**Tech Stack:** như cũ (Node 26, Fastify 5, Drizzle, Postgres 18, pg-boss, React 19) cộng `@fastify/cookie`, `@fastify/static`, `nodemailer`. Băm mật khẩu bằng `scrypt` có sẵn trong `node:crypto` (không thêm thư viện).

**Spec:** yêu cầu của người dùng ngày 2026-11-10: "người dùng có thể đăng nhập và kết nối vào fb page của họ, có thể có nhiều fb page". Thay thế Task K1 và K2 trong [PLAN-demo-full.md](PLAN-demo-full.md) (K0, K3, K4, K5, K6 vẫn dùng).

## Global Constraints

- `tenant_id` của mọi truy vấn lấy từ `req.auth.tenantId`; không có tham số, header hay body nào của client được quyết định tenant. Tài nguyên của tenant khác trả **404**, không phải 403 (không lộ sự tồn tại).
- Không log mật khẩu, token phiên, token mời, token đặt lại mật khẩu, Page token, nội dung tin, câu gốc, giá trị AI trích, số tiền. Chỉ id, số đếm, mã lỗi.
- Token (phiên, mời, đặt lại, xác minh email) là 32 byte ngẫu nhiên; DB chỉ lưu **băm SHA-256**.
- Cookie phiên: `HttpOnly`, `SameSite=Lax`, `Secure` ngoài localhost, tên `__Host-sm_session` ở production. Không dùng `localStorage` cho phiên.
- Mọi request `POST/PUT/PATCH/DELETE` dưới `/api` phải có header `x-requested-with: salesmind` (kiểm cả `Origin` nếu có). Không bật CORS.
- `NODE_ENV=production` từ chối `DEMO_MODE=true`. Công cụ giả lập, tua đồng hồ, đặt lại demo chỉ tồn tại khi `DEMO_MODE=true` **và** chỉ cho thành viên tenant demo.
- AI trích xuất và gửi ảnh ra nước ngoài **tắt mặc định** cho mọi tenant mới; chỉ `owner` bật được, kèm xác nhận pháp lý được ghi lại (Luật 91/2025/QH15 chưa được luật sư xác nhận).
- Sau **mỗi** mốc: chạy test → cập nhật `PROGRESS.md` → **một** commit → dừng báo cáo → chờ "tiếp".

## Review Focus

1. **Người dùng tenant A đoán hoặc dùng lại id của tenant B** (hội thoại, đề xuất, đơn, Page, thành viên, lời mời) trên **mọi** route → 404 và không thay đổi dữ liệu nào. Test chạy theo danh sách route tự liệt kê, không viết tay từng route (P2).
2. **Đăng nhập sai nhiều lần, hoặc email không tồn tại** → cùng một thông báo, cùng thời gian xấp xỉ, khóa tạm sau 5 lần sai; không biết được email có tài khoản hay không (P1).
3. **Phiên bị đánh cắp hoặc người bị gỡ khỏi đội còn phiên đang mở** → gỡ thành viên, đổi mật khẩu, hoặc `disabled` thì mọi phiên của người đó vô hiệu ngay ở request kế tiếp (P1, P4).
4. **Hai doanh nghiệp cùng kết nối một Page**, hoặc một Page bị ngắt rồi kết nối lại bởi tenant khác → Page thuộc đúng một tenant; tin cũ không chuyển sang tenant mới; webhook của Page đã ngắt không còn lưu tin (P5).
5. **Doanh nghiệp có nhiều nghìn hội thoại** → Hộp thư phân trang theo con trỏ, không nạp cả bảng vào bộ nhớ; Trang chủ tính bằng truy vấn tổng hợp (P6). **Một tenant bật AI làm cạn hạn mức** → chỉ tenant đó bị dừng, có thông báo rõ, các tenant khác không bị ảnh hưởng (P8).

## Đã được người dùng duyệt (2026-11-10)

- **Đăng nhập bằng email và mật khẩu** (không đăng nhập bằng Facebook ở giai đoạn này).
- **Triển khai:** chưa có máy chủ; giai đoạn này chạy trên máy của người dùng qua tunnel HTTPS. Vì vậy **P9 tách đôi**: phần **phục vụ `web/dist` từ backend** (cần để người thử vào qua địa chỉ tunnel, cookie `Secure` hoạt động, không CORS) làm cùng P3; phần **Docker, Caddy, sao lưu, vận hành** hoãn tới khi có máy chủ.
- **Thứ tự:** nền tảng trước (P1 → P5, rồi tin thật), đơn và bill (G4–G8) sau.

## Quyết định đã chọn (người duyệt có thể đổi)

1. **Đăng nhập bằng email và mật khẩu là chính.** Lý do: app Meta chưa qua App Review thì "Đăng nhập bằng Facebook" chỉ dùng được với tài khoản có vai trò trong app, nghĩa là người dùng bình thường không vào được SalesMind. Email và mật khẩu thì ai cũng dùng được; kết nối Page (cần Facebook) mới bị giới hạn bởi trạng thái app. "Đăng nhập bằng Facebook" thêm sau khi app Live (không nằm trong kế hoạch này).
2. **Ba vai trò:** `owner` (một hoặc nhiều; bật AI, ngắt Page, quản lý đội, xem mọi thứ), `manager` (kết nối Page, mời thành viên, Trang chủ quản lý), `sale` (Hộp thư, duyệt đề xuất, gửi tin). Vai trò "Lan" và "chị Hà" của demo ánh xạ sang `sale` và `manager`.
3. **Mỗi người dùng thuộc đúng một doanh nghiệp** (UNIQUE `memberships.user_id`). Cột và bảng cho phép nới sau; không làm bộ chuyển doanh nghiệp ở bản này.
4. **Đăng ký:** `SIGNUP_MODE=closed` (mặc định: chỉ tạo bằng CLI hoặc lời mời) hoặc `open` (ai cũng đăng ký, bắt buộc xác minh email trước khi kết nối Page). Chưa xác minh email thì không kết nối Page.
5. **Tất cả thành viên thấy mọi hội thoại của doanh nghiệp** (chưa phân công hội thoại cho từng sale). Phân công là tính năng riêng, không có trong kế hoạch này.
6. **Gửi email** qua interface `Mailer`: bản `ConsoleMailer` (dev, in liên kết ra log) và `SmtpMailer` (`nodemailer`, cấu hình bằng `.env`). Mọi lời mời đều có nút "Sao chép liên kết" nên chạy được mà không cần SMTP.
7. **Triển khai một container duy nhất** (Fastify phục vụ cả API lẫn `web/`), Postgres do dịch vụ ngoài hoặc compose; HTTPS qua reverse proxy (Caddy). Địa chỉ webhook cố định, hết cảnh tunnel đổi địa chỉ.

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `backend/src/auth/{password,session,users,invites,mailer}.ts` | Băm mật khẩu, phiên, người dùng, lời mời, gửi thư (P1, P4) |
| `backend/src/api/{auth-routes,guard,scope}.ts` | Route đăng nhập, hook `requireAuth` và CSRF, `req.auth`, kiểm tra quyền (P1, P2) |
| `backend/src/api/{pages,team}.ts` | Route Page và đội (P4, P5) |
| `backend/src/ai/budget.ts` | Hạn mức và đo lường AI theo tenant (P8) |
| `web/src/components/{LoginView,SignupView,TeamView,PagesView,PageFilter}.tsx` | Giao diện mới |
| `Dockerfile`, `docker-compose.prod.yml`, `Caddyfile`, `doc/VAN-HANH.md` | Triển khai và vận hành (P9) |

---

### Task P1: Lõi tài khoản: người dùng, phiên, đăng nhập

**Files:**
- Create: `backend/src/auth/{password,session,users,mailer}.ts`, `backend/src/api/auth-routes.ts`, `backend/drizzle/0005_*.sql`
- Modify: `backend/src/db/schema.ts`, `backend/src/app.ts` (cookie, hook), `backend/src/config/env.ts` (`SIGNUP_MODE`, `SMTP_*`, `SESSION_IDLE_DAYS`, `SESSION_MAX_DAYS`), `backend/src/cli/index.ts` (`user:create`, `user:reset-password`)
- Test: `backend/tests/auth-password.test.ts`, `backend/tests/auth-session.test.ts`, `backend/tests/auth-routes.test.ts`

**Interfaces:**
- Bảng: `users(id, email unique, password_hash, display_name, status 'active'|'disabled', email_verified_at, failed_logins int default 0, locked_until, created_at, last_login_at)`; `memberships(user_id unique → users, tenant_id → tenants, role 'owner'|'manager'|'sale', created_at)`; `sessions(id, user_id, token_hash unique, created_at, expires_at, last_seen_at, user_agent)`; `audit_log(id, tenant_id, user_id, action, target, meta jsonb, at)`.
- `hashPassword(plain: string): Promise<string>` → `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>` (N=2^15, r=8, p=1, salt 16 byte); `verifyPassword(plain: string, stored: string): Promise<boolean>` so sánh `timingSafeEqual`, tự nâng tham số khi đổi cấu hình (`needsRehash(stored): boolean`). Mật khẩu 10–128 ký tự, không trùng email.
- `normalizeEmail(raw: string): string` (NFC, trim, hạ chữ thường; từ chối thiếu `@`, dài quá 254 ký tự).
- `createSession(db, userId, ctx: { userAgent: string }, now: Date): Promise<{ token: string; expiresAt: Date }>`; `resolveSession(db, token: string, now: Date): Promise<{ userId: string; tenantId: string; role: Role; email: string; displayName: string } | null>` (hết hạn nhàn rỗi, hết hạn tuyệt đối, user `disabled` → `null`; gia hạn `last_seen_at` tối đa mỗi 5 phút); `revokeSessions(db, userId, exceptSessionId?)`.
- Route: `POST /api/auth/signup` (chỉ khi `SIGNUP_MODE=open`: tạo user + tenant + membership `owner`, gửi thư xác minh), `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/verify-email {token}`, `POST /api/auth/forgot {email}` (luôn 202), `POST /api/auth/reset {token, password}` (đổi mật khẩu thì thu hồi mọi phiên), `POST /api/auth/change-password`. Đăng nhập: sai bất kỳ lý do nào đều `401 invalid_credentials` cùng nội dung; email không tồn tại vẫn chạy một lần `verifyPassword` với băm giả để thời gian tương đương; 5 lần sai liên tiếp khóa 15 phút (`locked_until`, vẫn trả `401` giống hệt); giới hạn tốc độ theo IP bằng `@fastify/rate-limit`.
- CLI: `user:create <email> <tên> --tenant <id> --role owner|manager|sale [--password-stdin]`, `user:reset-password <email>`.

- [ ] **Step 1: Test đỏ.** `auth-password`: băm hai lần cùng mật khẩu ra hai chuỗi khác nhau; `verifyPassword` đúng/sai; chuỗi băm hỏng hoặc thiếu trường → `false` (không ném); mật khẩu 9 ký tự bị từ chối. `auth-session`: token trả về không xuất hiện trong DB (chỉ băm); phiên hết hạn nhàn rỗi 7 ngày và hết hạn tuyệt đối 30 ngày (tại biên); user `disabled` → `null`; `revokeSessions` vô hiệu mọi phiên cũ. `auth-routes`: đăng nhập đúng đặt cookie `HttpOnly`, `SameSite=Lax`, không có token trong body; **email lạ và mật khẩu sai trả đúng cùng một body và cùng mã**; lần sai thứ 5 khóa, lần đúng thứ 6 trong 15 phút vẫn `401`; `/api/auth/me` không cookie → 401; `POST` thiếu `x-requested-with` → 403; `forgot` với email lạ vẫn 202 và không gửi thư; dùng token đặt lại hai lần → lần hai lỗi; đặt lại xong mọi phiên cũ vô hiệu; `signup` ở `closed` → 404.
- [ ] **Step 2: Chạy, thấy đỏ:** `cd backend && npx vitest run tests/auth-*.test.ts`.
- [ ] **Step 3: Cài đặt theo Interfaces.** `ConsoleMailer` in liên kết ra log chỉ khi `NODE_ENV !== 'production'`; ở production thiếu cấu hình SMTP thì `forgot`/`signup` báo lỗi cấu hình khi khởi động (không im lặng nuốt thư).
- [ ] **Step 4: Chạy toàn bộ test hai lần, `typecheck`. Thử thật bằng `curl`:** tạo user bằng CLI, đăng nhập, gọi `/api/auth/me`, đăng xuất.
- [ ] **Step 5: Commit** `P1: tài khoản, phiên, đăng nhập, đặt lại mật khẩu`.

### Task P2: Đưa toàn bộ `/api/*` về tenant của phiên đăng nhập

**Files:**
- Create: `backend/src/api/scope.ts`
- Modify: `backend/src/api/routes.ts`, `backend/src/api/read-models.ts`, `backend/src/demo/{seed,actions,clock}.ts`, `backend/src/server.ts`, `web/src/api/client.ts` (xóa `x-demo-role`)
- Test: `backend/tests/api.test.ts` (sửa), `backend/tests/api-isolation.test.ts` (mới)

**Interfaces:**
- `requireAuth` (hook `onRequest` cho mọi `/api/*` trừ `/api/auth/{login,signup,forgot,reset,verify-email}`) đặt `req.auth: { userId; tenantId; role: 'owner' | 'manager' | 'sale'; email; displayName }`. `requireRole(...roles: Role[])` trả `403 forbidden` nếu không đủ quyền. `needCtx`/`getDemoContext` bị xóa khỏi route; Page của tenant tìm theo `req.auth.tenantId`.
- `nowFor(db, tenantId): Promise<Date>`: tenant demo dùng đồng hồ demo, mọi tenant khác dùng `new Date()` thật. Route `clock/advance`, `demo/*` chỉ tồn tại khi `DEMO_MODE=true` và `403` với người ngoài tenant demo.
- Demo: `resetDemo` tạo hai người dùng `lan@demo.local` (`sale`) và `ha@demo.local` (`manager`) với mật khẩu ngẫu nhiên in ra màn hình lúc `demo:reset`; ở `DEMO_MODE` thêm `POST /api/auth/demo-login { as: 'lan' | 'ha' }` (cấp phiên không cần mật khẩu, chỉ khi `DEMO_MODE`). Quyền: `stop-followup`, `decide` cho `sale`/`manager`/`owner`; `Trang chủ` thẻ AI chỉ cho `manager`/`owner`.
- Người duyệt (`by`) lấy từ `req.auth.displayName`, không lấy từ client.

- [ ] **Step 1: Test đỏ `api-isolation.test.ts`:** dựng hai tenant, mỗi tenant một Page, hội thoại, đề xuất, việc. **Tự liệt kê mọi route** có tham số (`app.printRoutes` hoặc `onRoute`) và với mỗi route có `:id`, gọi bằng id của tenant kia bằng người dùng của tenant này: kỳ vọng `404`, và số dòng của mọi bảng không đổi (chụp trước và sau). Route mới thêm mà không nằm trong danh sách kiểm thì test **đỏ** (buộc người thêm route phải nghĩ tới cách ly). Kiểm: `sale` gọi route của `manager` → 403; `Inbox` và `Home` của tenant này không chứa khách của tenant kia; `now` của tenant thường không bị đồng hồ demo ảnh hưởng.
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt.** Sửa `api.test.ts` cho đăng nhập bằng `demo-login`; test chạy trọn cảnh 0–3 và 6 phải vẫn đạt.
- [ ] **Step 4: Chạy toàn bộ test hai lần, `typecheck`. Mutation:** bỏ điều kiện `tenantId` ở một truy vấn của `read-models.ts` thì `api-isolation` phải đỏ.
- [ ] **Step 5: Commit** `P2: API theo tenant của phiên, cách ly dữ liệu, vai trò`.

### Task P3: Giao diện đăng nhập và khung theo vai trò

**Files:**
- Create: `web/src/components/{LoginView,SignupView,ResetView}.tsx`
- Modify: `web/src/state/session.tsx`, `web/src/App.tsx`, `web/src/components/{TopBar,SideNav}.tsx`, `web/src/api/{client,hooks,types}.ts`
- Test: `web/src/App.test.tsx`, `web/src/components/LoginView.test.tsx`

**Interfaces:**
- `useMe()` gọi `GET /api/auth/me`; `401` thì hiện `LoginView`. `client.ts` tự gắn `x-requested-with: salesmind`, gặp `401` ở route khác thì xóa cache và về đăng nhập, **không** retry. TopBar: tên người dùng, vai trò, "Đăng xuất"; bỏ nút đổi vai Lan/chị Hà (chỉ còn ở `DEMO_MODE`, thành "Vào nhanh với tư cách Lan | chị Hà"). SideNav ẩn mục theo vai trò (`sale` không thấy Đội, Page).
- `LoginView`: email, mật khẩu, "Quên mật khẩu", liên kết "Đăng ký" chỉ khi server báo `signupOpen` trong `GET /api/auth/config`. Thông báo lỗi chung "Email hoặc mật khẩu không đúng", thông báo khóa tạm "Thử lại sau 15 phút".

- [ ] **Step 1: Test đỏ:** chưa đăng nhập → `LoginView`; sai mật khẩu hiện đúng một thông báo chung; đăng nhập xong chuyển vào Trang chủ; `401` giữa chừng quay về đăng nhập; `sale` không thấy mục Đội và Page; "Đăng xuất" xóa cache (không còn dữ liệu của người trước trên màn hình, kiểm bằng cách đăng nhập người thứ hai).
- [ ] **Step 2: Chạy `cd web && npx vitest run`, thấy đỏ.**
- [ ] **Step 3: Cài đặt; rà trợ năng (`autocomplete="username"`/`current-password`/`new-password`, focus vào lỗi, `aria-live`).**
- [ ] **Step 4: Chạy test, `typecheck`, `build`. Chạy Chrome qua đăng nhập demo rồi đi hết cảnh 0–3, 6; xem ảnh chụp.**
- [ ] **Step 5: Commit** `P3: màn đăng nhập, đăng xuất, giao diện theo vai trò`.

### Task P4: Đội: mời, nhận lời mời, đổi vai trò, gỡ thành viên

**Files:**
- Create: `backend/src/auth/invites.ts`, `backend/src/api/team.ts`, `web/src/components/TeamView.tsx`, `web/src/components/AcceptInviteView.tsx`
- Modify: `backend/src/db/schema.ts` (+ `invitations`), `web/src/state/session.tsx`
- Test: `backend/tests/team.test.ts`, `web/src/components/TeamView.test.tsx`

**Interfaces:**
- `invitations(id, tenant_id, email null, role, token_hash unique, invited_by, expires_at, accepted_at, accepted_by)`. `createInvite(db, { tenantId, invitedBy, role, email? }, now): Promise<{ token: string; expiresAt: Date }>` (7 ngày; `owner` chỉ được mời bởi `owner`); `acceptInvite(db, { token, displayName, password, email? }, now): Promise<{ userId: string }>` (một lần, kiểm email nếu lời mời gắn email; email đã thuộc tenant khác → `409`).
- Route (chỉ `manager`/`owner`): `POST /api/team/invites`, `GET /api/team`, `POST /api/team/invites/:id/revoke`, `PATCH /api/team/members/:userId { role }`, `DELETE /api/team/members/:userId`. `POST /api/auth/accept-invite` công khai. Luôn còn ít nhất một `owner`: hạ vai trò hoặc gỡ `owner` cuối cùng → `409 last_owner`. Gỡ thành viên hoặc đổi vai trò thu hồi mọi phiên của người đó. Mọi thay đổi ghi `audit_log` (không ghi mật khẩu hay token).

- [ ] **Step 1: Test đỏ:** lời mời dùng hai lần → lần hai lỗi; lời mời hết hạn tại biên 7 ngày; `sale` gọi mời → 403; `manager` mời `owner` → 403; hạ `owner` cuối → 409; gỡ thành viên rồi người đó gọi `/api/auth/me` bằng cookie cũ → 401; token mời không nằm trong DB; người nhận lời mời có email trùng tenant khác → 409 không tạo gì.
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt; liên kết mời có nút "Sao chép", gửi thư nếu có SMTP.**
- [ ] **Step 4: Chạy test hai bộ, `typecheck`; thử bằng Chrome: mời một người, mở liên kết ở cửa sổ ẩn danh, đặt mật khẩu, thấy Hộp thư.**
- [ ] **Step 5: Commit** `P4: mời thành viên, vai trò, gỡ thành viên`.

### Task P5: Kết nối nhiều Page trong giao diện

Thay thế Task K2 của `PLAN-demo-full.md` (cùng giao diện, nay có tài khoản). Đã có sẵn: OAuth, lưu token mã hóa, đăng ký webhook, nhiều Page cho một tenant (bảng `pages`, `UNIQUE fb_page_id`).

**Files:**
- Create: `backend/src/api/pages.ts`, `web/src/components/PagesView.tsx`
- Modify: `backend/src/auth/{oauth-routes,connect-pages,tenants}.ts` (state gắn `userId`; callback chuyển hướng về web), `backend/src/meta/graph-client.ts` (`unsubscribeApp`), `backend/src/db/schema.ts` (`pages.status` thêm `disconnected`, `pages.connected_by_user_id`), `backend/src/config/env.ts` (`WEB_BASE_URL`)
- Test: `backend/tests/api-pages.test.ts`, `backend/tests/oauth-routes.test.ts`, `web/src/components/PagesView.test.tsx`

**Interfaces:**
- `POST /api/pages/connect-url` (`manager`/`owner`, email đã xác minh) → `{ url, expiresAt }`: state một lần gắn `tenantId` **và** `userId` của phiên. `GET /api/pages` → `PageView[]` (`{ id; fbPageId; name; status: 'active' | 'token_invalid' | 'disconnected'; webhookSubscribed; conversations; lastMessageAt; connectedBy; aiEnabled }`, **không bao giờ** có token). `POST /api/pages/:id/disconnect` (gọi `DELETE /{page-id}/subscribed_apps`, xóa token cục bộ dù Meta lỗi, `status = disconnected`, giữ lịch sử tin). `POST /api/pages/:id/reconnect-url`. `POST /api/pages/:id/backfill`.
- Callback thành công: `302 WEB_BASE_URL/pages?connected=<n>&skipped=<m>`; Page đã thuộc tenant khác nằm trong `skipped` và giao diện giải thích "Page này đang được doanh nghiệp khác sử dụng"; lỗi → `?connect_error=<mã ngắn>` (không chứa thông báo thô của Meta).
- `PagesView`: danh sách thẻ Page (tên, đèn trạng thái, "Webhook: đã đăng ký" hoặc "Chưa nhận được tin", số hội thoại, tin gần nhất), nút "Kết nối Page Facebook", "Kết nối lại", "Lấy lại tin cũ", "Ngắt kết nối" (xác nhận hai bước). Đủ trạng thái trống ("Chưa kết nối Page nào") và hướng dẫn khi app Meta còn Development ("Chỉ tài khoản có vai trò trong app mới kết nối được").

- [ ] **Step 1: Test đỏ (Graph giả).** Một tenant kết nối hai Page trong một lần đăng nhập → cả hai hiện; tenant B thử kết nối Page đã thuộc A → vào `skipped`, Page vẫn của A, tin của Page đó vẫn vào A; `disconnect` gọi đúng một lần `subscribed_apps` DELETE, `token_enc` bị xóa dù Meta trả 400, tin đến sau đó từ Page đã ngắt bị bỏ có đếm (không lưu); kết nối lại đúng Page → tin cũ còn, `status` về `active`; state của người A dùng bởi người B (cookie khác) → 400; `sale` gọi `connect-url` → 403; người chưa xác minh email → 403; JSON `GET /api/pages` không chứa `EAA` hay `token`.
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt theo Interfaces.**
- [ ] **Step 4: Chạy test hai bộ, `typecheck`. Thử thật (cần K0):** hai tài khoản SalesMind khác nhau, mỗi người kết nối một Page riêng (tài khoản Facebook tester), kiểm hai bên không thấy dữ liệu của nhau; một người kết nối hai Page.
- [ ] **Step 5: Commit** `P5: kết nối, ngắt, kết nối lại nhiều Page trong giao diện`.

### Task P6: Hộp thư nhiều Page, phân trang, hiệu năng

**Files:**
- Create: `web/src/components/PageFilter.tsx`
- Modify: `backend/src/followup/overview.ts` (`loadConversationSummaries` thành truy vấn có con trỏ và `pageId`), `backend/src/api/{routes,read-models}.ts`, `backend/drizzle/0006_*.sql` (chỉ mục), `web/src/components/InboxList.tsx`, `web/src/api/{types,hooks}.ts`
- Test: `backend/tests/inbox-paging.test.ts`, `backend/tests/demo-core.test.ts`, `web/src/components/InboxList.test.tsx`

**Interfaces:**
- `GET /api/inbox?pageId=<uuid>&cursor=<opaque>&limit=<1..100>` → `{ now, conversations: ConversationSummary[], nextCursor: string | null }`, sắp xếp `last_message_at DESC, id DESC` (keyset, không `OFFSET`). `ConversationSummary` thêm `pageId` và `pageName`. `loadHome` tính P1, quá hạn, số liệu AI bằng truy vấn tổng hợp trong SQL (không nạp toàn bộ hội thoại); P1 chỉ xét hội thoại có tin trong 7 ngày gần nhất.
- Chỉ mục: `conversations(tenant_id, last_message_at DESC, id)`, `messages(conversation_id, sent_at DESC)` đã có; thêm cái còn thiếu theo `EXPLAIN` (ghi kết quả vào `PROGRESS.md`).
- Web: bộ lọc Page ("Tất cả Page" + từng Page), nhãn tên Page trên mỗi dòng khi tenant có hơn một Page, nút "Tải thêm", giữ vị trí cuộn khi polling làm mới.

- [ ] **Step 1: Test đỏ.** Dựng 2.500 hội thoại: trang thứ hai không trùng và không sót dòng nào dù có tin mới chen vào giữa lúc đang lật trang; lọc `pageId` của tenant khác → 404; `loadHome` trên 2.500 hội thoại chạy dưới 500 ms (đo bằng `performance.now`, ngưỡng nới 3 lần trên CI); P1 và quá hạn ra kết quả giống bản cũ trên dữ liệu demo (test hiện có phải vẫn xanh).
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt; chạy `EXPLAIN ANALYZE` cho `inbox` và `home` trên 2.500 hội thoại, không còn `Seq Scan` ở bảng lớn.**
- [ ] **Step 4: Chạy toàn bộ test hai lần, `typecheck`.**
- [ ] **Step 5: Commit** `P6: hộp thư nhiều Page, phân trang con trỏ, truy vấn tổng hợp`.

### Task P7: Tin nhắn thật hai chiều (K3 và K4)

Làm đúng Task K3 (tên khách, ảnh, tệp) và K4 (gửi qua Send API, cửa sổ 24 giờ, khử trùng echo) của [PLAN-demo-full.md](PLAN-demo-full.md), với hai thay đổi do có tài khoản: `messages.sent_by_user_id` ghi **ai** bấm gửi (từ `req.auth`), và `POST /api/conversations/:id/send` chỉ cho `sale`/`manager`/`owner` của đúng tenant, dùng token của **đúng Page** chứa hội thoại đó. Test thêm: người tenant khác gửi vào hội thoại này → 404 và **không có request nào tới Graph**; hội thoại của Page `disconnected` → 409.

### Task P8: Quản trị AI theo doanh nghiệp: đồng ý, hạn mức, đo lường

**Files:**
- Create: `backend/src/ai/budget.ts`, `web/src/components/AiSettings.tsx`
- Modify: `backend/src/db/schema.ts` (`tenants.ai_consent_at`, `ai_consent_by`, `ai_daily_cap`; bảng `ai_usage(tenant_id, day, calls, input_tokens, output_tokens)` khóa `(tenant_id, day)`), `backend/src/extraction/run.ts` (và `bills/read.ts` khi có), `backend/src/api/pages.ts`
- Test: `backend/tests/ai-budget.test.ts`

**Interfaces:**
- `POST /api/ai/enable { acknowledgeLegal: true }` (chỉ `owner`): ghi `ai_consent_at/by` và `ai_extraction_enabled = true`; thiếu `acknowledgeLegal` → 422; `POST /api/ai/disable`. `checkAndReserve(db, tenantId, now): Promise<{ allowed: boolean; remaining: number }>` gọi **trước** mỗi lời gọi mô hình, đếm theo ngày giờ Việt Nam, mặc định `AI_DAILY_CAP=500` lời gọi mỗi tenant (cấu hình được); `recordUsage(db, tenantId, usage, now)` sau mỗi lời gọi. Hết hạn mức thì run ghi `skipped` với lý do `budget_exhausted` (không retry, không vào dead-letter) và giao diện hiện "Đã dùng hết hạn mức AI hôm nay".
- Web: màn "AI" cho `owner`: công tắc, hộp xác nhận pháp lý (nội dung nêu rõ dữ liệu đi tới nhà cung cấp AI ở nước ngoài), số lời gọi và token hôm nay, hạn mức.

- [ ] **Step 1: Test đỏ:** `sale`/`manager` bật AI → 403; chưa đồng ý thì tin mới **không** tạo run; 500 lời gọi đồng thời (`Promise.all`) chỉ cho đúng 500 qua (đặt hạn mức nhỏ trong test); sang ngày mới (tua qua nửa đêm giờ Việt Nam) hạn mức làm mới; tenant A hết hạn mức không ảnh hưởng tenant B; tắt AI rồi tin vào vẫn lưu nhưng không trích xuất.
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt; `reserve` là một `INSERT … ON CONFLICT DO UPDATE … WHERE calls < cap RETURNING` (nguyên tử), không đọc rồi ghi.**
- [ ] **Step 4: Chạy toàn bộ test hai lần, `typecheck`.**
- [ ] **Step 5: Commit** `P8: đồng ý pháp lý, hạn mức và đo lường AI theo doanh nghiệp`.

### Task P9: Triển khai và vận hành

> **Chia hai phần.** **P9a (làm cùng P3, nửa ngày):** `backend/src/web-static.ts` phục vụ `web/dist` kèm SPA fallback và bộ test `web-static.test.ts` bên dưới; `HOST` cấu hình được (không ép `127.0.0.1` khi không `DEMO_MODE`); `README` hướng dẫn chạy `npm run build` rồi `node dist/server.js` sau tunnel. **P9b (hoãn tới khi có máy chủ):** Dockerfile, Caddy, sao lưu, `doc/VAN-HANH.md`, kiểm biến bắt buộc ở production.

**Files:**
- Create: `Dockerfile`, `docker-compose.prod.yml`, `Caddyfile`, `doc/VAN-HANH.md`, `backend/src/web-static.ts`
- Modify: `backend/src/app.ts` (phục vụ `web/dist` kèm SPA fallback, bỏ `/api` và `/webhook` khỏi fallback), `backend/src/server.ts` (`host` theo `HOST`, mặc định `0.0.0.0`; bỏ ép `127.0.0.1` khi không `DEMO_MODE`), `README.md`
- Test: `backend/tests/web-static.test.ts`, `backend/tests/readiness.test.ts`

**Interfaces:**
- Dockerfile nhiều tầng: build `web/`, build `backend/`, ảnh chạy chỉ có `dist`, `web/dist`, `drizzle`; chạy bằng `node` là PID 1 (đã ghi ở README: để tắt nhẹ nhàng). Lệnh `migrate` chạy trước khi nhận request (`npm run db:migrate:prod`). Caddy lo HTTPS và `TRUST_PROXY=true`. Biến bắt buộc ở production kiểm khi khởi động: `PUBLIC_BASE_URL` (https), `WEB_BASE_URL`, `TOKEN_ENC_KEY`, `APP_SECRET`, `SESSION` cookie `Secure`, `SMTP_*` nếu `SIGNUP_MODE=open`.
- Sao lưu: `pg_dump` hằng ngày giữ 14 ngày, **kèm một lần khôi phục thử** vào DB tạm để chứng minh bản sao lưu dùng được; ghi cách làm và kết quả trong `doc/VAN-HANH.md`. Cảnh báo (log mức `error`) khi hàng đợi dead-letter có job, khi Page chuyển `token_invalid`.
- `GET /healthz` và `/readyz` giữ như cũ, công khai nhưng không lộ chi tiết.

- [ ] **Step 1: Test đỏ:** `GET /` trả `index.html`, `GET /pages` (đường dẫn của SPA) cũng trả `index.html`, `GET /api/không-tồn-tại` trả JSON 404 chứ không phải `index.html`, `GET /webhook` vẫn là handler xác minh của Meta; tệp tĩnh có `Cache-Control` đúng (băm tên → `immutable`, `index.html` → `no-cache`); production không khởi động nếu thiếu biến bắt buộc hoặc `DEMO_MODE=true`.
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Cài đặt; dựng thử bằng `docker compose -f docker-compose.prod.yml up --build` trên máy này, đăng ký, đăng nhập, `healthz` xanh.** Triển khai thật lên máy chủ thật nằm ngoài kiểm chứng của tôi: ghi vào `PROGRESS.md` là "chưa làm" cho tới khi bạn có máy chủ và tên miền.
- [ ] **Step 4: Chạy toàn bộ test hai lần, `typecheck`, `build` hai package.**
- [ ] **Step 5: Commit** `P9: đóng gói, phục vụ web từ backend, sao lưu, vận hành`.

### Task P10: Meta Live và các điều khoản (K6 mở rộng)

Làm Task K6 của [PLAN-demo-full.md](PLAN-demo-full.md) (trang `/privacy`, callback xóa dữ liệu, `deauthorize`, tài liệu App Review) và thêm: trang `/terms`; xóa dữ liệu theo **doanh nghiệp** (owner yêu cầu xóa: `DELETE /api/tenant` kèm nhập lại tên và mật khẩu, xóa mềm 7 ngày rồi xóa thật bằng job, thu hồi Page token và `subscribed_apps` trước khi xóa); `GET /api/tenant/export` xuất JSON dữ liệu của doanh nghiệp. Test: xóa tenant A không đụng một dòng nào của tenant B (đếm trước/sau theo bảng); callback xóa theo PSID chạy hai lần không lỗi. Việc nộp App Review và Business Verification là thủ tục của bạn.

---

## Thứ tự, phụ thuộc, ước lượng

| Giai đoạn | Mốc | Ngày | Kết quả người dùng thấy |
|---|---|---|---|
| 1. Tài khoản | **P1 → P2 → P3** | 6 | Đăng nhập, mỗi doanh nghiệp một dữ liệu riêng, demo chạy tiếp bằng tài khoản Lan và chị Hà |
| 2. Đội và Page | **P4, K0, P5** | 4,5 (K0 cần bạn) | Mời đội, kết nối nhiều Page Facebook thật |
| 3. Tin thật | **P6, P7** | 5,5 | Hộp thư nhiều Page, trả lời tới Messenger thật |
| 4. Vận hành | **P8**, P9b (hoãn) | 1,5 (+2 khi có máy chủ) | AI có hạn mức; P9b đưa lên máy chủ thật |
| 5. Công khai | **P10** | 1,5 + chờ Meta | Khách bất kỳ (không chỉ tester) dùng được |

Khoảng **21 ngày làm việc** cho phần nền tảng, cộng 11 ngày của phần G (đơn, bill, các cảnh 4–5) đã có trong `PLAN-demo-full.md`: tổng khoảng 32 ngày, tức 6–7 tuần làm một mình. **Khuyến nghị:** làm giai đoạn 1 và 2 trước (đủ để một doanh nghiệp tự đăng nhập, mời đội, kết nối Page và nhận tin thật), vì cảnh 0–3 và 6 của kịch bản đã chạy được trên nền này. Các mốc G4–G8 (đơn nháp, bill) đặt sau giai đoạn 3.

Nếu phải cắt: bỏ "Đăng ký tự do" (giữ `SIGNUP_MODE=closed`, tạo tài khoản bằng CLI hoặc lời mời) thì P1 bớt xác minh email; bỏ P10 nếu chỉ dùng với tester; hoãn P8 nếu chưa bật AI cho khách thật.

## Tự rà soát (đã chạy)

- **Phủ yêu cầu:** đăng nhập (P1, P3) · nhiều doanh nghiệp, dữ liệu tách biệt (P2) · cả đội dùng chung (P4) · kết nối Page của họ (P5) · nhiều Page (P5, P6) · nhận và trả lời tin (P7) · chạy được cho người dùng thật, không chỉ localhost (P9) · khách bất kỳ (P10).
- **Nhất quán:** `req.auth`, `requireAuth`, `requireRole`, `nowFor`, `normalizeEmail`, `checkAndReserve` dùng cùng tên ở mọi mốc; `MessageSender` (G5) là điểm nối giữa gửi giả lập và gửi thật (P7).
- **Phụ thuộc:** P2 cần P1; P3 cần P2; P4 cần P1–P3; P5 cần P2 và K0; P6 cần P2; P7 cần P5; P8 cần P2; P9 độc lập nhưng nên làm sau P3.
- **Rủi ro lớn nhất:** P2 (đổi toàn bộ `/api/*`, dễ sót một truy vấn thiếu `tenantId`): đã có test tự liệt kê route và mutation bắt buộc. Rủi ro thứ hai: Meta Development Mode làm người dùng ngoài app không kết nối được Page; không sửa được bằng code, chỉ bằng P10.
