# PROGRESS — Module 1: Tiếp nhận tin nhắn từ Facebook Page

Cập nhật file này sau mỗi mốc, trước khi commit. Trạng thái: `chưa làm` | `đang làm` | `xong`.
Cột "Bằng chứng" ghi kết quả test, mã commit hoặc liên kết cụ thể; chưa có thì không ghi "xong".
Kế hoạch chi tiết: [doc/PLAN-module1.md](doc/PLAN-module1.md).

## Tình trạng Module 1 (cập nhật 2026-11-09)

**Mã nguồn và test tự động đã hoàn tất cho cả 7 mốc.** Chưa có bằng chứng với Meta thật cho hai mốc:
- **Mốc 4** (kết nối Page qua OAuth, nhận webhook thật) và **mốc 5** (backfill) ở trạng thái "đang làm" cho tới khi bạn kiểm tra bằng Meta App và Page thật theo [doc/KET-NOI-PAGE.md](doc/KET-NOI-PAGE.md).
- Mọi bằng chứng hiện có dựa trên payload giả lập theo tài liệu Meta, test với Postgres và pg-boss thật, và một số lời gọi tới Graph API thật bằng thông tin giả (để xem định dạng lỗi thật).
- Các điểm chưa xác minh quan trọng nhất: đơn vị `timestamp` của webhook, `id` tin của Conversations API có trùng `mid` webhook không, và app của bạn cần `scope` hay `config_id` khi đăng nhập.

| Mốc | Nội dung | Trạng thái | Ngày | Bằng chứng |
|---|---|---|---|---|
| 0 | Môi trường: Node 26, TypeScript, docker-compose Postgres 18, Vitest, khung Fastify | xong | 2026-11-09 | Node v26.13.0 LTS (MSI đã đối chiếu SHA256; commit mốc 0 làm trên v24.22.2, sau đó chuyển lên 26 theo yêu cầu, typecheck, test, healthz đạt lại). `docker compose up -d`: container healthy, PostgreSQL 18.6, có DB `salesmind` và `salesmind_test`. `npm run typecheck` đạt. `npm test` 5/5 đạt. Chạy thật server, `GET /healthz` trả 200 `{"status":"ok"}`. |
| 1 | Kế hoạch: chia việc, quyết định kỹ thuật, điểm Meta API cần xác minh | xong | 2026-11-09 | Kế hoạch lưu ở `doc/PLAN-module1.md`. Đã đối chiếu 8 điểm Meta API với tài liệu chính thức (bảng dưới): 4 điểm xác minh được, 4 điểm tài liệu không nói rõ và cần thử bằng Page thật ở mốc 4–5. `GRAPH_API_VERSION` mẫu đổi sang v26.0. `npm run typecheck` và `npm test` (5/5) vẫn đạt. |
| 2 | DB (Drizzle) và mã hóa Page token (AES-256-GCM) | xong | 2026-11-09 | `npm run typecheck` sạch; `npm test` 36/36 đạt (token-crypto 16, db 15, env 4, healthz 1) trên Postgres 18.6 của Docker. `db:migrate` chạy được 2 lần liên tiếp (idempotent) và từ thư mục khác. `code-review` (medium) 9 phát hiện: đã sửa 8 (khóa ngoại ghép tenant/page/conversation, handler lỗi pool, đường dẫn migration, bỏ credentials hard-code khỏi `drizzle.config.ts`, `global-setup` tự tạo DB test, kiểm tra khóa base64 chặt, `truncateAll` động, index FK), hoãn 1 sang mốc 3 (`last_message_at` chỉ có đường ghi khi có worker). Đổi cổng Postgres Docker sang 5433 vì PostgreSQL cài sẵn trên máy chiếm 5432. |
| 3 | Webhook, kiểm tra chữ ký, khử trùng theo message.mid | xong | 2026-11-09 | `npm run typecheck` sạch; `npm test` 105/105 đạt (chạy 3 lần liên tiếp, không flaky), gồm signature 15, parse 18, route 19, toàn tuyến Postgres + pg-boss thật 17. Smoke test với server thật (tiến trình riêng, DB dev): GET xác minh 200/403; POST chữ ký đúng 200 trong 17–54 ms; gửi lại cùng payload vẫn 1 dòng; chữ ký sai, toàn số 0, thiếu đều 403; echo bị bỏ; tiếng Việt qua body `\u`-escape đúng; log không chứa nội dung tin, PSID, secret, chữ ký. Cổng bị chiếm thì thoát sạch với mã 1. Mutation: phá `ON CONFLICT` thì test khử trùng đỏ. `code-review` (medium) 7 phát hiện: sửa 6, giữ 1 (xem dưới). |
| 4 | Kết nối Page thật | đang làm (code xong, chờ bạn kiểm tra với Page thật) | 2026-11-09 | **Đã có bằng chứng:** `npm run typecheck` sạch; `npm test` 187/187 đạt, chạy 2 lần liên tiếp (graph-client 22, oauth-routes 36, oauth-state 16, env 12 và các file cũ). Mutation: bỏ ràng buộc nonce của cookie thì 4 test đỏ; bỏ `setWhere` (ghi đè Page tenant khác) thì 1 test đỏ; bỏ `subscribedAt: null` khi kết nối lại thì 1 test đỏ. Server thật + CLI: `tenant:create` in liên kết; `/auth/facebook/start` 302 sang Facebook đúng `client_id`, `redirect_uri`, `state`, `scope`; callback không cookie 400; trình duyệt khác mở cùng state 400; phát lại 400; **gọi Meta thật với code và App ID giả: Meta trả HTTP 400, mã 101, `OAuthException`, client parse đúng và trả trang 502**; log không chứa state, code, secret. `code-review` 2 lượt: 18 phát hiện, sửa 14, giữ 4 có chủ ý. **Chưa có bằng chứng:** đăng nhập Facebook, lưu Page, đăng ký webhook, nhận tin bằng Page thật. Làm theo [doc/KET-NOI-PAGE.md](doc/KET-NOI-PAGE.md) rồi báo kết quả. |
| 5 | Backfill tin cũ | đang làm (code xong, chờ thử với Page thật) | 2026-11-09 | **Đã có bằng chứng:** `npm run typecheck` sạch; `npm test` 236/236 đạt, chạy 2 lần liên tiếp (backfill 32, backfill chạy thật với pg-boss 7, graph-client 32). 8 mutation đều làm test đỏ (mất phần đã lấy khi bị giới hạn tốc độ, lưu cả tin của Page, bỏ giới hạn 20 tin, tắt khử trùng dự phòng, bỏ tự sắp xếp, nuốt lỗi 5xx, khử trùng tin không có text, lưu tin không có text). CLI thật: `backfill` xếp việc, lần hai báo "đã có việc chờ"; `backfill:status` đúng. **Server thật + Meta thật với token giả:** Graph API trả mã 190, Page bị đánh dấu `token_invalid`, trạng thái `failed`, không retry. `code-review`: 10 phát hiện, sửa 9, giữ 1. **Chưa có bằng chứng:** lấy tin thật từ một Page thật (cần bạn). |
| 6 | Quan sát (log, metric), README, review | xong | 2026-11-09 | `npm run typecheck` sạch; `npm test` **302/302 đạt, chạy 3 lần liên tiếp** (16 file). Đã làm: redact log, `x-request-id`, `/readyz` (DB và hàng đợi, 503 không lộ chi tiết), monitor độ sâu hàng đợi mỗi phút, giới hạn tốc độ `/auth/facebook/*` (30 yêu cầu mỗi phút mỗi IP, cấu hình `TRUST_PROXY`), CLI `queue:status` và `queue:redrive`, [README.md](README.md). 6 mutation cho các kiểm soát mới đều làm test đỏ. **Tắt nhẹ nhàng đã kiểm tra thật trên Linux** (container `node:26-slim`): `SIGTERM` thoát mã 0 sau 474 ms, không có log lỗi; thêm test job đang chạy dở hoàn tất trước khi dừng (mutation `graceful: false` làm test đỏ). Bản production: `npm run build` rồi `node dist/server.js` khởi động, `/readyz` ready, `db:migrate:prod` chạy được. Chạy lại dead-letter bằng pg-boss thật: payload còn nguyên, tin được lưu đúng một lần. `code-review` toàn module (`src`): 9 phát hiện, sửa 8, giữ 1 có chủ ý. |

## Điểm Meta API (đối chiếu tài liệu chính thức ngày 2026-11-09)

Trạng thái: **đã xác minh** = có trong tài liệu; **chưa xác minh** = tài liệu không nói, phải thử bằng Page thật (ghi rõ mốc làm).

| # | Điểm | Trạng thái | Kết luận và nguồn |
|---|---|---|---|
| 1 | `id` tin trong Conversations API có trùng `message.mid` của webhook không | **chưa xác minh** (mốc 5) | Tài liệu không nói. Kế hoạch: thử bằng Page thật đầu mốc 5; nếu không trùng thì dùng khóa phụ (page, PSID, `sent_at`, băm nội dung) cho tin backfill. [Conversations API](https://developers.facebook.com/docs/messenger-platform/conversations/) |
| 2 | Quyền cần để nhận tin và đăng ký webhook | **đã xác minh một phần** | Subscribe field `messages` cần `pages_messaging` và `pages_manage_metadata`, Page token của người có tác vụ `MODERATE`. `pages_show_list` để lấy danh sách Page. Backfill cần thêm `pages_read_engagement`. Standard Access chỉ nhận tin từ người có vai trò trong app; nhận tin khách thật cần Advanced Access (App Review). Chưa xác minh: `business_management` có bắt buộc không; hành vi chính xác ở chế độ Development (thử bằng tài khoản Tester ở mốc 4). [Webhooks](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks), [Overview](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview) |
| 3 | Page token có hết hạn không | **đã xác minh** | Đổi user token ngắn hạn sang dài hạn (khoảng 60 ngày) qua `oauth/access_token` với `grant_type=fb_exchange_token`, gọi từ server. Page token lấy từ token dài hạn "không có ngày hết hạn", chỉ hết hiệu lực trong một số điều kiện (nên xử lý `token_invalid`). Lấy Page qua `{user-id}/accounts`. [Long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/) |
| 4 | Giới hạn Conversations API | **đã xác minh một phần** | Chi tiết tin chỉ có cho 20 tin gần nhất mỗi hội thoại; hội thoại ở thư mục Requests không hoạt động 30 ngày không được trả về; danh sách tin chỉ trả `id`, `created_time`, chi tiết lấy qua `/{message-id}`. Chưa xác minh: phân trang, giới hạn tốc độ, và việc mở rộng `messages{...}` trong một lời gọi (kiểm tra mốc 5). |
| 5 | Phiên bản Graph API | **đã xác minh** | v26.0 ra mắt 29/07/2026 (hết hạn chưa xác định); v25.0 hết hạn 29/07/2028; v23.0 hết hạn 08/10/2027. Changelog nhắc tới v27.0 là mới nhất nhưng không nêu ngày. Dùng `v26.0`. [Changelog](https://developers.facebook.com/docs/graph-api/changelog/) |
| 6 | Payload tin có attachment, hạn URL attachment | **đã xác minh một phần** | Cấu trúc: `attachments[].type` (`image`, `audio`, `video`, `file`, `sticker`, `reel`...) và `payload.url`. Hạn của URL không có trong tài liệu: chỉ lưu metadata, không coi URL là vĩnh viễn. Sau 30/08/2026 sticker chỉ gửi type `sticker`. [Messages event](https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages) |
| 7 | Meta thử lại webhook thế nào | **đã xác minh** | Không nhận 200 thì thử lại ngay, rồi giảm dần tần suất trong 36 giờ, sau đó bỏ. Gộp tối đa 1000 sự kiện mỗi request (không đảm bảo gộp). Chữ ký `X-Hub-Signature-256` có tiền tố `sha256=`, tính trên payload bằng App Secret. GET xác minh gồm `hub.mode`, `hub.challenge`, `hub.verify_token`. Tài liệu không nêu thời gian chờ; 5 giây là yêu cầu của dự án. [Webhooks getting started](https://developers.facebook.com/docs/graph-api/webhooks/getting-started) |
| 8 | Echo và tin do Page gửi | **đã xác minh** | `message.is_echo` là boolean; trong echo, `sender.id` là Page, `recipient.id` là PSID. Echo đến qua field `message_echoes`; tài liệu không nói field `messages` có kèm echo không. Quyết định: chỉ subscribe `messages`, vẫn bỏ `is_echo`; có cần lưu tin Page gửi để AI có ngữ cảnh hay không sẽ quyết khi làm AI. [Message echoes](https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/message-echoes) |

## Lỗi phát hiện khi làm mốc 3 (đã sửa)

- **`verify_token` bị ghi vào log:** Fastify ghi nguyên URL, mà Meta gửi token trong query của GET `/webhook`. Giờ log chỉ ghi đường dẫn (bỏ query), cũng bảo vệ `code` và `state` của OAuth ở mốc 4. Chỉ áp dụng khi truyền `logger` dạng cấu hình; nếu dùng `loggerInstance` phải tự dùng `safeRequestSerializer`.
- **Ký tự NUL (`\u0000`) làm hỏng cả batch:** Postgres và jsonb của pg-boss không nhận NUL. Trước khi sửa, route trả 503 (Meta thử lại 36 giờ rồi bỏ, mất tin). Route bỏ NUL khỏi payload trước khi vào hàng đợi; worker phòng thủ thêm.
- **Tin gửi tới Page chưa kết nối bị bỏ im lặng:** Meta đã nhận 200 nên không gửi lại, tức là mất tin. Giờ job lưu phần của Page đã biết rồi ném `UnknownPageError`, retry (backoff, khoảng 20 phút), hết retry thì vào dead-letter với payload nguyên vẹn.
- **Mỗi tin tốn 2 truy vấn:** đã gộp thành truy vấn hàng loạt; batch 1000 tin chỉ cần khoảng 5 câu lệnh (có test).
- **Cấu hình queue không cập nhật khi đã tồn tại:** `createBoss` giờ gọi `updateQueue` cho queue có sẵn. `retryDelayMax` không sửa được qua `updateQueue` (giới hạn của pg-boss).

Giữ nguyên có chủ ý: `stripNul` chạy ở cả route và worker. Lần ở route bắt buộc (pg-boss lưu jsonb); lần ở worker là phòng thủ, chỉ chạy trên trường đã rút ra nên rẻ.

## Quyết định và lỗi phát hiện khi làm mốc 6

- **Lỗi thật mà `code-review` toàn module tìm ra:**
  - `queue:redrive --limit 50 webhook` đọc nhầm "50" thành đích (phụ thuộc thứ tự tham số). Đã chuyển sang `parseArgs` của Node: thứ tự không quan trọng, cờ lạ bị từ chối.
  - Kiểm tra readiness của hàng đợi luôn báo OK vì `getQueue` trả null (không ném lỗi) khi queue thiếu. Đã sửa bằng `assertQueueExists`.
  - Cảnh báo "job lỗi" ở queue nguồn không bao giờ tự hết (pg-boss giữ job hết retry ở trạng thái failed dù đã vào dead-letter) và trùng với cảnh báo dead-letter. Đã bỏ; số `failed` vẫn có trong log.
  - `queue:redrive` thật không báo số job không có queue nguồn, nên cảnh báo dead-letter còn mãi mà không rõ lý do. Giờ có báo.
  - Monitor không chờ lượt đọc đang chạy khi tắt; giờ `stop()` trả Promise và server `await` nó trước khi đóng pg-boss.
- **Test chập chờn, nguyên nhân nằm ở test:** test tắt nhẹ nhàng đếm job `completed` của cả hàng đợi dùng chung, nên cộng cả job còn sót từ file test khác (thứ tự file đổi giữa các lần chạy). Đã dọn hàng đợi ở đầu test; các lần chạy liên tiếp sau đó đều đạt.
- **Khi thử tắt nhẹ nhàng trong container, lần đầu không thoát được:** do cách tôi dựng thử nghiệm (`sh -c "... && node ..."` làm `sh` thành PID 1 và không chuyển `SIGTERM`), không phải lỗi ứng dụng. Đã ghi vào README: trong container phải để `node` là PID 1.
- **Giữ nguyên có chủ ý:** redact theo tên trường (`text`, `token`...) có thể che nhầm log vô hại và không bắt được nội dung lồng sâu hơn một cấp. Đây là lưới an toàn bổ sung cho quy tắc "không đưa nội dung vào log", không thay thế nó (đã ghi rõ trong mã).
- **`TRUST_PROXY` mặc định `false`** (an toàn: không tin header do client gửi). Sau tunnel hoặc proxy mà quên bật thì mọi client chung một giới hạn tốc độ; server ghi một dòng gợi ý lúc khởi động khi `PUBLIC_BASE_URL` không phải localhost.

## Quyết định và lỗi phát hiện khi làm mốc 5

- **Cách chạy:** `npm run cli -- backfill [<fbPageId>] [--force]` xếp việc; **server** (`npm run dev`) mới xử lý. Job liệt kê một trang hội thoại, lưu con trỏ vào `pages.backfill_state`, rồi xếp job trang kế tiếp và mỗi hội thoại một job. Chạy lại được, không tạo trùng.
- **Chỉ phục hồi tối đa 20 tin gần nhất mỗi hội thoại** (giới hạn của Meta, đã nêu ở điểm 4). Tin cũ hơn không lấy lại được.
- **Tin không có text (chỉ có ảnh) KHÔNG được backfill:** Conversations API không cho lấy attachment theo tài liệu, dòng lưu ra sẽ rỗng và không phân biệt được với tin trống. Ảnh của khách vẫn vào qua webhook.
- **Khử trùng dự phòng:** chưa biết `id` của Conversations API có trùng `mid` của webhook không (điểm 1). Nếu trùng, mọi thứ dùng `ON CONFLICT (mid)`. Nếu không, tin backfill khớp một tin webhook (cùng hội thoại, cách tối đa 2 giây, cùng text khác rỗng) bị bỏ qua và có cảnh báo trong log. Đánh đổi: hai tin giống hệt nhau trong 2 giây mà webhook bỏ lỡ cái thứ hai sẽ bị coi là trùng.
- **Không tin vào thứ tự Meta trả:** tự sắp theo `created_time` rồi mới lấy 20 tin mới nhất (nếu Meta trả cũ nhất trước thì cắt theo thứ tự đó sẽ giữ đúng những tin Meta báo đã xóa).
- **Lỗi phân loại thế nào:** 190 thì đánh dấu `token_invalid` và dừng (không retry); giới hạn tốc độ, mạng, 5xx, phản hồi sai dạng thì ném lỗi để pg-boss retry có backoff (phần đã lấy được vẫn được lưu); chỉ lỗi 4xx trên MỘT tin mới coi là "tin không lấy được".
- **Lỗi ghi DB lúc giữ phần đã lấy không được che lỗi Meta gốc** (đặc biệt 190: nếu che thì Page không bao giờ bị đánh dấu và mọi job sau vẫn gọi Meta bằng token hỏng). `code-review` chỉ ra.
- **Hàng đợi backfill dùng chính sách `short` + `singletonKey`:** mỗi Page hoặc hội thoại chỉ có một job đang chờ, nên chạy backfill hai lần không nhân đôi việc. CLI không chạy chồng lên backfill đang chạy (cập nhật trong 30 phút) trừ khi dùng `--force`.
- **Số liệu hàng đợi của pg-boss có thể trễ tới ~1 phút** ngay cả với `force: true` (nó tái dùng kết quả tính trong phút gần nhất). Phát hiện khi smoke test, job đã `completed` mà thống kê vẫn báo chờ 1.
- **Lỗi thật tìm ra:** `backfill:status` ban đầu dùng truy vấn con tương quan của Drizzle (cùng lỗi như `tenant:list`: bỏ tên bảng, luôn ra 0); đã viết lại bằng truy vấn nhóm và có test.

Giữ nguyên có chủ ý: hạn `expireInSeconds: 300` cho job hội thoại (20 lời gọi, mỗi lời gọi timeout 10 giây, tối đa khoảng 200 giây).

### Điểm Meta chưa xác minh, thêm ở mốc 5 (cần Page thật)

- `id` tin của Conversations API có trùng `mid` của webhook không (điểm 1). Cách kiểm: sau khi có tin qua webhook, chạy backfill rồi xem log có cảnh báo "khác mid" không, hoặc `select count(*)` so với số tin thật.
- Thứ tự tin trong `?fields=messages`, và cách phân trang danh sách tin (tài liệu không nói). Client không tự đi tiếp mà ghi cờ `truncated` cùng cảnh báo khi Meta báo còn trang sau.
- Kích thước trang và cách phân trang của `GET /{page-id}/conversations`, mã lỗi giới hạn tốc độ thực tế (ta coi 4, 17, 32, 613, 80001 là giới hạn tốc độ; chỉ 80001 có trong tài liệu).
- Mã lỗi Meta trả cho tin quá cũ ("đã xóa"): ta coi mọi lỗi 4xx trên một tin là "không lấy được".

## Quyết định và lỗi phát hiện khi làm mốc 4

- **State gắn với trình duyệt bằng cookie:** state nằm trong URL (lịch sử, Referer, log proxy) nên chỉ state thôi chưa đủ để chống chiếm luồng. Trình duyệt đầu tiên mở liên kết "nhận" state bằng nonce trong cookie (HttpOnly, SameSite=Lax, Secure khi HTTPS); callback phải khớp cả hai. DB chỉ lưu băm SHA-256 của state và nonce. Do `code-review` chỉ ra.
- **Không ghi đè Page của tenant khác:** `ON CONFLICT ... DO UPDATE ... WHERE tenant_id = ?`. Page đã thuộc tenant khác thì báo rõ, không đăng ký webhook.
- **Lưu trước, đăng ký sau:** worker cần thấy Page trong DB khi tin đầu tiên tới.
- **Lỗi từng Page độc lập:** Meta, DB hay mã hóa lỗi ở một Page không làm mất các Page còn lại.
- **`status` là sức khỏe của token, `subscribed_at` là trạng thái đăng ký webhook.** Kết nối lại luôn xóa `subscribed_at` cũ để không nói dối.
- **Lỗi thật tìm ra:** `tenant:list` luôn báo 0 Page (truy vấn con của Drizzle bỏ tên bảng); đã viết lại bằng LEFT JOIN. Danh sách Page bị cắt cụt im lặng ở 2000 Page; giờ báo lỗi.
- **Hỗ trợ `FB_LOGIN_CONFIG_ID` (tùy chọn):** tài liệu Meta nói app loại Business nên dùng `config_id` thay `scope` và không nói `scope` còn được chấp nhận không. Có giá trị thì dùng `config_id`, bỏ trống thì dùng `scope`.
- **Đã bỏ biến `OAUTH_REDIRECT_URI`** khỏi kế hoạch: redirect URI luôn là `PUBLIC_BASE_URL/auth/facebook/callback`, ít nguy cơ cấu hình lệch.

Giữ nguyên có chủ ý:
- State bị tiêu thụ trước khi gọi Meta (chống phát lại), nên lỗi tạm thời phía sau buộc phải tạo liên kết mới.
- Các Page xử lý tuần tự trong một request callback; doanh nghiệp thường chỉ có vài Page. Nếu một tài khoản có hàng chục Page và Meta chậm, request có thể bị proxy cắt.
- `client_secret` đi trong query của GET `oauth/access_token`, đúng như tài liệu Meta mô tả; code không bao giờ ghi URL ra log.

Việc cần làm ở mốc 6: giới hạn tốc độ cho `/auth/facebook/*` (hiện ai cũng có thể gọi và mỗi lần gọi có một truy vấn DB).

## Điểm cần xác minh bằng Page thật (mốc 4)

Xem danh sách đầy đủ cuối [doc/KET-NOI-PAGE.md](doc/KET-NOI-PAGE.md): đơn vị `timestamp`, payload tin có ảnh, `me/accounts` so với `{user-id}/accounts`, `business_management` và `config_id`, `code` OAuth dùng một lần không, hành vi ở chế độ Development.

## Việc còn lại / rủi ro của mốc 3

- **Dead-letter chưa có người xử lý:** giữ payload (gồm nội dung tin) 14 ngày, chưa có worker hay cảnh báo. Mốc 6 thêm log độ sâu hàng đợi và số job lỗi. Hết 14 ngày mà chưa chạy lại (`boss.redrive`) thì tin mất.
- **Chưa kiểm thử tắt nhẹ nhàng (SIGTERM/SIGINT) trên Windows:** Windows không gửi tín hiệu POSIX thật cho tiến trình Node, nên chỉ kiểm được đường lỗi khởi động. Cần thử trên Linux hoặc container.
- **Chưa thử với Meta thật:** mọi kiểm tra dùng payload giả lập theo tài liệu. Đơn vị `timestamp` (giả định mili giây) và cấu trúc payload thật sẽ xác minh ở mốc 4.

Điểm bổ sung (chưa xác minh, từ tài liệu):
- Đơn vị của `timestamp` trong webhook không được ghi; ví dụ có 13 chữ số nên giả định mili giây, xác minh bằng webhook thật ở mốc 4.
- Tin có thể nằm trong mảng `standby` thay vì `messaging` nếu Page dùng Handover Protocol; giả định Page không dùng.
