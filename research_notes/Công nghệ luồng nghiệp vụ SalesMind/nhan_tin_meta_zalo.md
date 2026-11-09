# Meta Messenger Platform messaging rules and Vietnam alternative channels (Zalo OA, ZNS, SMS brandname) for a sales follow-up workflow (state as of 2026-11-09)

Conventions: "VERIFIED" = text seen in an official page (Meta developers docs, oa.zalo.me, zalo.solutions) in this session. "THIRD-PARTY" = vendor/news page, not official. "INFERRED" = my reasoning. Meta's developer docs moved to `developers.facebook.com/documentation/business-messaging/...`; the old `/docs/messenger-platform/...` URLs still resolve for some pages. The changelog page says "The latest version is: v27.0" (so v26.0, used by the project, is not the latest but nothing found says it is retired).

## 1. Standard messaging window: exact rule, what opens it

### Takeaway
Official wording: the window is 24 hours "for most user actions"; for the first message after a Click-to-Messenger / Click-to-Direct ad it "may last up to 7 days from that message". Promotional content is allowed inside the window. Opening actions include messages, CTA/Get Started clicks, plugin starts, m.me ref links on an existing thread, and reacting to a message. Comments are NOT in the official list.

### Cited Findings
- "For most user actions, it lasts 24 hours." After a first message following a Click-to-Messenger or Click-to-Direct ad, "the window may last up to 7 days from that message." Messages sent inside the window may contain promotional content. — [Meta policy overview](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview), [Meta Policy & Usage Guidelines (new path)](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy.md)
- Official list of user actions that open the window: sending a message to the Page; clicking a call-to-action button such as Get Started; clicking a Click-to-Messenger/Click-to-Direct ad and then sending a first message; starting a conversation through a plugin (Send to Messenger, Checkbox); clicking an m.me / ig.me link with a `ref` parameter on an existing thread; reacting to a message. — [Meta policy overview](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview)
- Send API `messaging_type` semantics: `RESPONSE` = reply to a message the Page received, promotional or not, inside the 24h window; `UPDATE` = proactive (non-reply) message inside the 24h window; `MESSAGE_TAG` = non-promotional, outside the window, must match the tag's allowed use. — [Send API reference](https://developers.facebook.com/docs/messenger-platform/reference/send-api%23limits)
- A message can be sent to a person who messaged the Page within the last 24 hours, or who agreed to receive messages outside the window (opt-in mechanisms). — [Send API reference](https://developers.facebook.com/docs/messenger-platform/reference/send-api%23limits)
- The "up to 7 days" ad window text is already on the official policy page. A blog (Spur, 7 Oct 2026) claims it started on "28 September 2026" per a changelog entry; I fetched the official changelog and found no entry after 27 Apr 2026, so the 28 Sep 2026 date is NOT verified. — [Spur blog (third-party)](https://www.spurnow.com/en/blogs/instagram-messenger-ads-7-day-messaging-window); [Meta Messenger changelog](https://developers.facebook.com/documentation/business-messaging/messenger-platform/changelog)
- The Meta FAQ says: apps cannot send outside the 24h window under standard messaging; the window reopens after an opt-in follow-up only "if the user interacts with the opt-in message". — [Meta Messenger FAQ](https://developers.facebook.com/docs/messenger-platform/faq)
- Private reply to a comment: one private reply within 7 days of the comment; the 24h window opens only if the commenter replies (third-party summary; not seen in official text here). — [ChatDaddy (third-party)](https://chatdaddy.tech/blog/messenger-facebook-live-24-hour-rule)
- A "24+1" extra-message rule is mentioned by some vendors; no official source found. — [Meta Messenger FAQ (no mention)](https://developers.facebook.com/docs/messenger-platform/faq)

### Inferences
- The window is measured from the customer's last qualifying action and resets on each new one (VERIFIED for "a message opens it"; "reset on each action" is implied by multiple vendors, not official text). For SalesMind: track `last_user_interaction_at` from `messages`, `messaging_postbacks`, `message_reactions`, `messaging_referrals`. Currently subscribing only to `messages` misses reactions/postbacks that would extend the window.
- Reply from the Page does not extend the window (nothing in docs says it does).
- Salesperson "bám" (follow-up) messages sent more than 24h after the customer's last interaction cannot be sent as standard messages.

### Gaps
- Whether a comment (not private reply) counts as interaction: not in the official list; treat as no.
- Exact current clock rule for ad-started windows when the customer messages again within the 7 days: Meta text silent (Spur also says Meta does not say).

## 2. Message tags: current status, HUMAN_AGENT 7-day window, approval, promotional restriction

### Takeaway
CONFIRMED_EVENT_UPDATE, ACCOUNT_UPDATE and POST_PURCHASE_UPDATE are dead: from 27 Apr 2026 requests with them return error code 100 (Meta also published 12 Jan 2026 and 10 Feb 2026 as retirement dates in other places). HUMAN_AGENT (7 days, manual human replies only, no automated messages, no promotion, needs App Review "Human Agent" permission) and CUSTOMER_FEEDBACK (7 days, only the Customer Feedback template) remain documented. Message tags may never carry promotional content.

### Cited Findings
- Changelog entry 27 Mar 2026: from 27 Apr 2026 API requests using CONFIRMED_EVENT_UPDATE, ACCOUNT_UPDATE or POST_PURCHASE_UPDATE fail with error code 100; migrate to Utility Templates or Marketing Messages API. — [Meta Messenger changelog](https://developers.facebook.com/documentation/business-messaging/messenger-platform/changelog)
- The Marketing Messages FAQ gives 12 Jan 2026 as the deprecation date for the same three tags; the Send API reference earlier said "Effective February 10th, 2026". Three dates conflict inside Meta docs; the changelog's 27 Apr 2026 is the enforcement date for error 100. — [Meta Marketing Messages FAQ](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq.md); [Aman Singh blog summarising the two notices (third-party)](https://singhamandeep.com/message-tags-deprecated/)
- Send API tag enum and rules (as fetched): ACCOUNT_UPDATE (no promo, no recurring content), CONFIRMED_EVENT_UPDATE (events user registered for), POST_PURCHASE_UPDATE (transaction confirmations, shipping status; "Not for cross-selling or promotions"), CUSTOMER_FEEDBACK (only the Customer Feedback template, within 7 days of the customer's latest message), HUMAN_AGENT (human agent reply within 7 days for issues that can't be resolved in the standard window; needs Human Agent permission approved via App Review; automated messages not allowed). — [Send API reference](https://developers.facebook.com/docs/messenger-platform/reference/send-api%23limits)
- Policy page: "Message tags enable sending important and personally relevant updates to users outside the standard messaging window" only for approved use cases; Human Agent tag lets a business "manually respond to a person's messages within a separate 7-day period"; using tags outside approved use cases "may restrict your ability to send messages". — [Meta policy overview](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview)
- "Message tags may not be used to send promotional content." — [Meta Messenger Send Messages docs](https://developers.facebook.com/docs/messenger-platform/send-messages/)
- Human Agent permission "is not available in standard access or development mode" (needs App Review) — quoted by a blog from the Send API reference; the same blog says the Send API page lists HUMAN_AGENT as "required for the Instagram Messaging API" and does not state it as a general replacement for the removed tags. — [Aman Singh blog (third-party quoting Meta)](https://singhamandeep.com/message-tags-deprecated/)
- Changelog history: 2 Jun 2021 introduced Human Agent tag (7 days); 6 Aug 2021: Human Agent tag calls for Private Replies stopped working after 13 Sep 2021. No 2025-2026 changelog entry mentions HUMAN_AGENT (so no sign of deprecation). — [Meta Messenger changelog](https://developers.facebook.com/documentation/business-messaging/messenger-platform/changelog)
- Conflicting claim: a SleekFlow help page says Meta deprecated Messenger message tags including Human Agent; KeyCRM/ManyChat/Bitrix24 pages still describe the 7-day extension as active. Official changelog contradicts SleekFlow's claim for HUMAN_AGENT. — [Search result summary of SleekFlow/KeyCRM (third-party)](https://help.keycrm.app/en/communications-sms-email-instagram-telegram-viber-marketplace-chats-telephony/response-timeframes-on-facebook-and-instagram)
- Human Agent approval practice: reviewers reject when the use case does not show live human handoff; bots cannot use it. — [Saurabh Dhar guide (third-party)](https://www.saurabhdhar.com/blog/human-agent-permission-meta-app-review)
- News messages: NON_PROMOTIONAL_SUBSCRIPTION tag for News Page Index Pages only. — [Meta policy overview](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview)

### Inferences
- Sales "bám" messages beyond 24h are not covered by HUMAN_AGENT if they are promotional/chasing ("are you still interested?"): the tag is for "issues that can't be resolved in the standard window". Using it for sales chasing is a policy-risk (INFERRED from "not for promotional content" plus vendor warnings).
- A salesperson typing a reply inside the app UI and the app calling Send API with HUMAN_AGENT is, per wording, "manual response by a human representative", but SalesMind AI-drafted/auto-scheduled messages would violate "automated messages are not allowed". Design: human must click send per message; no scheduled auto-send under HUMAN_AGENT.

### Gaps
- I could not load the official message-tags page text (page returned navigation only / 404 on `.md`); tag list is from the Send API reference and third-party quotes.
- Whether HUMAN_AGENT is still fully available for Messenger (not only Instagram) in Nov 2026: policy page and changelog imply yes; no explicit 2026 confirmation found.

## 3. Other mechanisms outside the window: Marketing Messages, utility messages, recurring/one-time notifications, Sponsored Messages, CTM ads

### Takeaway
Vietnam is on Meta's list of supported locations for Marketing Messages (paid, per delivered message, opt-in required, max 1 per user per day). Utility messages (template, non-marketing order/account/appointment updates) replace the dead tags. Recurring notifications are discontinued (Feb 2026). One-time notification remains in Beta. Sponsored Messages and Click-to-Messenger ads exist but need ads infrastructure.

### Cited Findings
- Marketing messages: paid, can be sent outside the window; a user reply opens a new 24h window (replies not charged). Launched for all tech providers 1 Jul 2025. Billed by Meta per message delivered (on the Meta ads bill); daily or lifetime budget required. The page gives no per-message price (the $1 figure is a worked example). Locations for tech-provider-served businesses include "Vietnam (VN)", alongside AU, BR, CL, CO, HK, IN, ID, IL, MY, MX, NZ, PE, PH, SA, SG, TW, TH, AE, US. — [Meta Marketing Messages FAQ](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq.md)
- Marketing message opt-in: through Click-to-Messenger ads (click and respond), CRM list upload matched by email/phone (PSIDs can't be uploaded), or opt-in message templates; every message has an in-thread opt-out link; opt-out webhooks "aren't currently sent". Limit: one marketing message per unique user per day. Prereqs: Business-type app with Advanced access, FBL4B config and a system user token, ad account with payment method. — [Meta Marketing Messages FAQ](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq.md)
- Recurring notifications: no new integrations from 1 Sep 2025; discontinued globally 10 Feb 2026 except AU, EU, JP, KR, UK (page also states 12 Jan 2026; conflict inside the same page); before that limited to 1 per subscriber per 48h. — [Meta Marketing Messages FAQ](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq.md)
- Utility messages: template-based messages for "order or account status updates, and appointment or event reminders"; must not contain marketing; send with `messaging_type: UTILITY`; app needs `page_utility_messaging` permission; subscribe to `message_template_status_update`; Page-owned templates reviewed "within seconds"; rejections for marketing content, wrong parameters etc. Page says nothing about the 24h window, pricing, country availability or customer opt-in. — [Meta Utility Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/utility-messages.md)
- Utility templates support images (29 Sep 2025) and named parameters (6 Mar 2026). — [Meta Messenger changelog](https://developers.facebook.com/documentation/business-messaging/messenger-platform/changelog)
- Meta stated in 2025 that utility messages are designed to eventually replace the Post Purchase Update, Confirmed Event Update, Account Update tags. — [Meta blog 29 Jul 2025](https://developers.facebook.com/blog/post/2025/07/29/simplify-customer-updates-with-utility-messages-on-messenger/)
- One-time notification (Beta): user explicitly asks to be notified; Page receives a single-use token, valid up to 1 year; no message tag needed; if the user engages the window reopens; multiple requests allowed but 24-hour policy applies together; not on IG. — [Meta policy overview](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview), [Meta Messenger FAQ](https://developers.facebook.com/docs/messenger-platform/faq)
- Sponsored Messages: can be sent outside the window with promotional content; labelled "Sponsored"; must follow ad policies. — [Meta policy overview](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview)
- Click-to-Messenger ads: first message after the ad opens a window up to 7 days (see Q1) and can subscribe user to marketing messages. — [Meta policy overview](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview), [Marketing Messages FAQ](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq.md)

### Inferences
- "Re-contact 3 days after quotation" to a silent customer is only possible via: (a) Marketing Messages (needs opt-in and paid, promotional allowed), (b) a one-time notification the customer explicitly requested, (c) HUMAN_AGENT within 7 days only for an unresolved support-style issue, or (d) the 7-day CTM-ad window. Quote chasing is not utility content.
- "Order photos before delivery" and "deposit reminder" could fit Utility Messages only if framed as order/payment status without marketing; whether payment-reminder qualifies is not stated by Meta (INFERRED).
- "Satisfaction after delivery": CUSTOMER_FEEDBACK tag only with Meta's Customer Feedback template, within 7 days of customer's latest message (so not for post-delivery days after a long silence).
- Utility and marketing messages require template approval and the app to hold Advanced access; likely extra App Review work for SalesMind.

### Gaps
- Per-message price for marketing/utility messages in Vietnam: not found on fetched official pages.
- Whether Vietnam is also eligible for utility messages and Ads Manager marketing messages: only the tech-provider list for marketing messages was verified.
- Whether one-time notification is still available in Nov 2026: policy page text (still lists Beta) is the only evidence; page date unknown.

## 4. Penalties and error codes

### Takeaway
Out-of-window sends fail with error 10; abuse of tags triggers 613/2018338 and Page-level restrictions; Meta delivers `messaging_policy_enforcement` warnings/blocks to the app. No fixed durations are documented.

### Cited Findings
- Error 10 / subcode 2018278: "message was blocked for falling outside the allowed window under a newer messaging policy" (no solution listed; refers to policy page). Error 10 / 2534022: "This message is sent outside of allowed window" (Instagram-labelled by some vendors; send only while the standard window is open). — [Meta Common Error Codes](https://developers.facebook.com/documentation/business-messaging/messenger-platform/error-codes), [Meta send-api errors](https://developers.facebook.com/docs/messenger-platform/send-api-reference/errors)
- 551: "This person isn't receiving messages from you right now" (551/1545041 "isn't available right now"). 200: permission error (pages_messaging not approved; only admins/devs/testers can be messaged; subcodes 2018028, 2018027 pages_messaging_phone_number, 2018021 phone-matching fee). — [Meta Common Error Codes](https://developers.facebook.com/documentation/business-messaging/messenger-platform/error-codes)
- 613 / 2018338: your messaging via tags "is seen as bothersome or abusive" — reduce the rate of tagged messages to this person or face messaging restrictions; 613 / 2534040: API rate limit exceeded; 613 / 1893016: multiple opt-in requests on same topic. — [Meta Common Error Codes](https://developers.facebook.com/documentation/business-messaging/messenger-platform/error-codes)
- 100: bad parameter, includes use of the three removed tags after 27 Apr 2026 and invalid `notification_messages_token`. 100 / 2534037: app is not thread owner (another app, including Meta Business AI, controls the conversation) — wait for `messaging_handovers` with `pass_thread_control`. — [Meta Common Error Codes](https://developers.facebook.com/documentation/business-messaging/messenger-platform/error-codes), [Meta Messenger changelog](https://developers.facebook.com/documentation/business-messaging/messenger-platform/changelog)
- `messaging_policy_enforcement` webhook: `action` = warning | block | unblock, with `reason`; triggers include spam, inappropriate messages, abusing tags; no penalty durations documented. — [Meta messaging_policy_enforcement](https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messaging_policy_enforcement)
- Misuse of tags may restrict a Page's ability to send messages. Messenger integrity policies apply at Page level; a strike affects all of the Page's messages including marketing messages. — [Meta policy overview](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview), [Marketing Messages FAQ](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq.md)
- Bots must respond to all user input within 30 seconds (except Get Started); violations are reported to Page admins in the Page Support Inbox with 7 days to fix or switch the response setting to hybrid/human, else sending ability may be limited. — [Meta Policy & Usage Guidelines](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy.md)
- Rate limits: 300 calls/sec per Page for text/link/reaction/sticker, 10 calls/sec for audio/video; may be rate limited if too many messages to one thread; above 40 messages/sec a Page hits a high-volume limit and new messages stop appearing in Page Inbox. — [Meta Rate Limits](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview/rate-limiting.md)

### Inferences
- Because a failed Send API call returns an error rather than silently dropping, SalesMind should pre-check window state and surface "outside window" instead of retrying (retrying 10/2018278 is pointless). It should subscribe to `messaging_policy_enforcement`.

### Gaps
- Duration/escalation ladder of Page restrictions is not documented in the pages fetched.

## 5. `message_echoes`, `is_echo`, `app_id`, handover/standby

### Takeaway
For Messenger, echoes arrive through the separate `message_echoes` field, not `messages`; `messages` is documented only as "a message has been sent to your Page". Echo payload has `is_echo: true`, `app_id`, `mid`, optional `metadata`; messages sent from the Facebook Page Inbox carry a special Page Inbox `app_id` (since Graph v12.0), so human replies typed in the Page Inbox ARE echoed. Business Suite and mobile apps are not mentioned in the docs.

### Cited Findings
- `message_echoes` fires "when your page sends a message"; fields: `sender.id` (Page), `recipient.id` (PSID), `timestamp`, `message.is_echo` (true), `message.app_id` (app that sent it), `message.metadata` (only if the Send API call set `metadata`), `message.mid`. Types: text, image/audio/video/file/sticker, appointment, template, fallback, product, reply. Subscribe by selecting `message_echoes`. — [Meta message_echoes](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/message-echoes.md)
- From Graph API v12.0, messages sent via the Facebook Page inbox report `app_id` = the Page inbox app ID (docs text shows `26390203743090`; the widely used value is 263902037430900, a 15-digit ID, so the docs string may be a typo — verify on a live echo). — [Meta message_echoes](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/message-echoes.md), [changelog 14 Sep 2021 entry: Message Echo webhooks include the Page Inbox app ID when a business replies from Page Inbox](https://developers.facebook.com/documentation/business-messaging/messenger-platform/changelog)
- Webhooks reference: `message_echoes` is available only for Messenger conversations; "for Instagram Messaging, echo notifications are included in the `messages` field instead". The same page lists 19 fields including `message_echoes`, `message_reactions`, `message_reads`, `message_deliveries`, `messaging_postbacks`, `messaging_referrals`, `messaging_handovers`, `standby`, `messaging_policy_enforcement`, `messenger_template_status_update`. — [Meta Webhooks overview](https://developers.facebook.com/docs/messenger-platform/webhooks)
- Messages webhook page: `messages` triggers when a message is sent to the Page; `is_echo` and `app_id` do not appear in its payload table; it lists `reply_to`, `quick_reply`, `attachments`, `referral`, `commands`. — [Meta messages webhook](https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages)
- Echo `reply_to` with `is_self_reply` added 6 Oct 2025; appointment data in echoes 3 Mar 2026. — [Meta Messenger changelog](https://developers.facebook.com/documentation/business-messaging/messenger-platform/changelog)
- Permissions: subscribing a Page to webhook fields needs `pages_messaging` and `pages_manage_metadata`, with a Page token from a user who can perform MODERATE; receiving events from real customers (non-role users) needs Advanced Access via App Review. The echo page names only `catalog_management` (for product echoes). — [Meta Webhooks overview](https://developers.facebook.com/docs/messenger-platform/webhooks), [Meta message_echoes](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/message-echoes.md)
- `standby` channel: events delivered when a message reaches the Page but your app is NOT the current thread owner (handover protocol); contains reads, deliveries, messages, postbacks (postback payload omitted); does not give thread control; subscribe by selecting `standby`. When Meta Business AI owns the thread, wait for `messaging_handovers` with `pass_thread_control`. One doc example nests an echo inside `standby`. — [Meta standby](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/standby.md), [Meta message_echoes](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/message-echoes.md)
- Multiple apps on one Page: use the Handover Protocol to decide which bot owns the thread. — [Meta Messenger FAQ](https://developers.facebook.com/docs/messenger-platform/faq)

### Inferences
- SalesMind currently subscribes only to `messages` and discards `is_echo` rows. On Messenger, per the webhooks reference, echoes don't come through `messages` at all, so human replies typed in Page Inbox/Business Suite/mobile will be INVISIBLE in the DB unless `message_echoes` is added. This breaks "no reply for N days" logic and the 5-times follow-up counter. Add `message_echoes`; store `app_id`; classify `app_id == own app` as in-app send (dedupe against the message already stored by Send API response `message_id`), Page-inbox app ID as human-manual, other IDs as other bots.
- Business Suite and mobile Page app very likely use the same Page-inbox pipeline (INFERRED, not documented); verify empirically with a real Page.
- Because the project already gets in-app sends' echoes too, dedupe by `mid` is needed.
- If another app (e.g., Meta Business AI or a CRM) is primary receiver, SalesMind would receive events only on `standby` and could not send until handed control (error 100/2534037).

### Gaps
- No official statement that Business Suite / mobile Pages app replies produce echoes; only Page inbox app ID is documented.
- Handover-protocol overview page and the `messaging_handovers` page were not retrievable (404); Page Inbox as default primary/secondary receiver not verified here.

## 6. Does the 24h window apply to humans typing in Facebook Page Inbox / Business Suite?

### Takeaway
NOT verified in official sources. The official docs I could fetch govern the Send API and say nothing about native Page Inbox/Business Suite replies. Third-party sources suggest in-app/inbox vendor tools use the same API rules, and that replying in Meta's own inbox is a workaround.

### Cited Findings
- The Messenger Send Messages docs explicitly "don't address manual replies from the Page inbox". — [Meta Messenger Send Messages](https://developers.facebook.com/docs/messenger-platform/send-messages/)
- Official Human Agent definition: "manually respond to a person's messages within a separate 7-day period" and the changelog (2 Jun 2021) describes it as the tag letting businesses respond outside the 24h window up to 7 days. — [Meta policy overview](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview), [Meta Messenger changelog](https://developers.facebook.com/documentation/business-messaging/messenger-platform/changelog)
- Third-party troubleshooting pages for out-of-window errors advise replying inside the native Messenger/Page inbox instead of the integration (one help page: "use the link at the top of the conversation to access it from the Messenger inbox"). — [Search result summary of error 10/2018278 vendor pages (third-party)](https://support.qiscus.com/hc/en-us/articles/900005822863-Why-do-I-get-error-this-message-is-sent-outside-of-allowed-window-in-FB-Messenger-channel-room)
- I found no official Meta Business Help Center text on a Business Suite/Page Inbox reply limit (searches returned only vendor pages).

### Inferences
- Likely (INFERRED, plus my background recollection that is NOT verified in this session): native Page Inbox/Business Suite applies its own 7-day reply allowance rather than the API's 24h rule, which is why humans can still reply there after the API window has closed. Treat the exact limit as unknown until tested on a real Page; do not hard-code it.
- Product implication: when the API returns 10/2018278, SalesMind can show "open in Page Inbox" deep link as a fallback, and the echo (Q5) will bring that reply back into the system.

### Gaps
- Official statement on window/time limit for Page Inbox/Business Suite manual replies: not found. Needs test on a real Page or Meta Business Help Center check.

## 7. Zalo OA messaging rules (interaction window, quotas, follower requirement) and ZNS

### Takeaway
Zalo OA has three UID-based message types with different rules (consultation, transactional, communication/marketing) plus ZNS (template messages to phone numbers, no follower needed, but transactional-only and Zalo-approved templates). Official figures I could read are from a 2023/2024 policy page; 2026 package prices come from third-party pages.

### Cited Findings
- Official OA message policy (applies from 20 Jun 2023; page published 15 Jan 2024; does not mention 2026): OA may message users only after they interact with the OA or allow interaction (follow, message, call, menu, chatbot CTA click). — [Zalo OA message policy](https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099)
- Consultation message (Tin Tư vấn): to followers and non-followers, last user interaction must be within 7 days; the first 8 messages within 48h of the last interaction are free (window resets on each new interaction); beyond that 55 VND/message; some packages include extra consultation messages. Free-form content (text, image, GIF, sticker, forms, files). Via OA Manager and OA OpenAPI. — [Zalo OA message policy](https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099)
- Conflict: an unofficial SDK guide states the consultation message window as only 48h after last interaction, requires the user to follow and not block the OA, endpoint `https://openapi.zalo.me/v3.0/oa/message/cs`, quota error -223. Official page says 7 days with 8 free in 48h; SDK is not official. — [RedAI SDK doc (unofficial)](https://unpkg.com/@warriorteam/redai-zalo-sdk@1.11.1/docs/CONSULTATION_SERVICE.md)
- Transactional OA message (Tin Giao dịch): order/appointment/invoice status updates, to followers and non-followers after interaction, via OpenAPI, template format required, 165 VND/message (incl. 10% VAT). — [Zalo OA message policy](https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099)
- Communication/marketing message (Tin Truyền thông): FOLLOWERS ONLY; broadcast or personal; free but limited by package quota; Premium package limited each follower to 4 per month from 1 Feb 2024; Zalo monitors user abuse reports and may act. — [Zalo OA message policy](https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099)
- New OA packages from 1 Jun 2026 (THIRD-PARTY, published 16 Sep 2026 and "Cập nhật 06/2026"): Cơ bản free; Tiêu chuẩn 1,000,000 VND/year; Tăng trưởng 1,400,000 VND/6 months or 2,500,000/year (500 consultation messages/month outside 48h); Toàn diện 3,400,000/6 months or 6,000,000/year (2,000/month); prices include VAT; paid packages only for verified OAs; overage 55 VND/message; staff caps 5/15/100. Older Nâng cao ~99,000 VND/month (2,000 msgs) and Premium ~399,000 VND/month (9,000 msgs) were retired. — [Subiz](https://subiz.com.vn/blog/chi-phi-su-dung-zalo-oa.html), [Abenla OAZBS](https://oazbs.vn/zalo-zbs/zalo-oa-co-mat-phi-khong-bang-gia-va-chi-phi-van-hanh-can-biet/), [Moti (old structure)](https://moti.com.vn/zalo-oa-co-mat-phi-khong-cap-nhat-moi-nhat-2025)
- ZNS is a separate service for sending notifications to phone numbers using Zalo; official Zalo page says it is not covered by the UID message rules. Now branded "Zalo Business Solutions (ZBS) Template Message". — [Zalo OA message policy](https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099), [Zalo Solutions pricing](https://zalo.solutions/zns/pricing)

### Inferences
- Zalo gives a materially better path for sales follow-up than Messenger: consultation messages need only an interaction within 7 days and are free for the first 8 in 48h; beyond 48h costs 55 VND or package quota. Chasing a customer who stopped talking 3+ days ago on Zalo thus costs money but is technically allowed within 7 days; after 7 days only ZNS (transactional) or follower-only marketing messages remain.
- Zalo requires that the customer already be an OA contact; customers arriving from Facebook are not, so a channel switch needs the customer's phone number (via ZNS or a human call) or a Zalo OA QR/link.

### Gaps
- 2026-current official Zalo OA policy/price page was not retrievable (developers.zalo.me and zalo.cloud are SPAs/unreachable); 7-day vs 48h consultation rule not reconciled for 2026.
- Whether the new 2026 packages changed the free 8-in-48h rule: unknown.

## 8. ZNS: template types, approval, use cases, pricing, API

### Takeaway
ZNS = template messages by phone number to Zalo users, only for transaction/account events with no advertising; OA must be verified; templates approved by Zalo/VNG (about 2 working days); price 200-300 VND/message ex-VAT (official ZBS page) charged on successful delivery.

### Cited Findings
- Official ZBS pricing (ex-VAT, per successfully delivered message): authentication (OTP) 300 VND; payment-request (chuyển khoản) 300; voucher 300; bus ticket (beta) 300; journey/special industries from 200; all other types (including custom) 200; buttons: first per category free, from second 100 VND; response button 100; call-permission command 400; sending via UID gets a lower subsidised price than via phone number (price blank on page). Page states no effective date. — [Zalo Solutions pricing](https://zalo.solutions/zns/pricing)
- Rules summary (CNV, citing zalo.cloud/zns; blog, not official): content must not be advertising, must contain a specific parameter (customer name, order code, amount), must not mention products/services beyond the transaction; sending hours 7:00-22:00 (except OTP); one ZNS per transaction status change; initiate within 7 days before/after the event; phone number must belong to a Zalo account and the user must have transacted with the partner and agreed to provide the number (OTP for new accounts excepted); Zalo may spot-check recipients (not over 1% of last 7 days); complaints over 5% of 24h volume or more than 50 can suspend a template; template review "usually within 2 working days"; types 300/200/120 VND (type 3 only public-utility); Follower API (only after user interacted with OA; first 1,000 commands free then 50 VND). — [CNV Loyalty](https://cnvloyalty.com/blogs/tin-tuc/tin-nhan-zalo-zns)
- Template formats/stages (older Nhanh.vn page, may be out of date): ZNS stages (in-transaction, post-transaction, account update, product/service update, follow-up/aftersales); Review (satisfaction) format guided and reviewed by Zalo; Follow-up stage 5 required 50,000 prior ZNS messages and 5 stores and gave 500/day. That page also lists OTP 360 VND and regular 250 VND incl. VAT and CTA fees from 24 Mar 2025. — [Nhanh.vn](https://pos.manual.nhanh.vn/pos/cai-dat/gui-zalo-zns/cac-loai-tin-cua-oa)
- Other reseller reports: ~200 VND notice / 250 VND advertising per ZNS (unreliable; official page does not support). — [CellphoneS Sforum (third-party)](https://cellphones.com.vn/sforum/zalo-thu-phi-nguoi-dung)
- Node.js integration: no official Node SDK found. Third-party wrappers: RedAI Zalo SDK (`zalo.zns.sendMessage(accessToken, {phone, template_id, template_data})`, `is_hash_phone` option); ZNS gateways (eSMS, Adflex, Infobip, 8x8) expose REST send with `template_id`, `phone`, `template_data`. Official endpoint `business.openapi.zalo.me` could not be confirmed here. — [RedAI ZNS guide](https://unpkg.com/@warriorteam/redai-zalo-sdk@1.11.1/docs/ZNS_SERVICE.md), [Adflex ZNS docs](https://docs-zns.adflex.vn/guides/send.md), [Infobip ZNS](https://infobip.com/docs/api/channels/zalo/zalo-notification-service/send-zalo-message)

### Inferences
- Mapping to workflow: deposit/payment reminder = payment-request template (300 VND) - plausibly allowed as transactional if tied to an actual order/deposit; order photos before delivery = post-transaction template with image component (image price unlisted); satisfaction after delivery = rating/review template. "Bám khách im lặng" / quotation chasing = promotional, NOT allowed in ZNS.
- Requires a verified OA, template approval per use case, customer phone number and prior transaction/consent; usable by phone number even if the customer never followed the OA.
- SalesMind would need either per-tenant OA onboarding (OAuth per business) or reseller/aggregator.

### Gaps
- Official ZNS rules page, API reference and current approval SLA could not be fetched; official data on image-component price not available (page showed "NaN").
- Whether ZNS pricing changed after 1 Jun 2026 alongside OA packages: unverified.

## 9. SMS brandname cost (fallback)

### Takeaway
SMS brandname is the universal fallback: roughly 650-900 VND per message in 2026 per one trade article; legal advertising rules apply strictly.

### Cited Findings
- AMIS (updated 13 May 2026) says brandname SMS costs about 650-900 VND/message depending on carrier and CSKH vs advertising type. — [AMIS MISA via search summary (third-party)](https://amis.misa.vn/?p=72850)
- Plain consumer SMS about 200-350 VND (not brandname). Old bank-sector figures: 820 VND financial-transaction message and 500 VND CSKH advertising for VinaPhone/MobiFone, 785 VND Viettel (undated). — [FPTShop](https://fptshop.com.vn/tin-tuc/for-gamers/1-tin-nhan-sms-bao-nhieu-tien-205303), [VnBusiness](https://vnbusiness.vn/ngan-hang-va-ba-nha-mang-da-tim-duoc-tieng-noi-chung-ve-gia-dich-vu-sms.html)
- A VietGuys article reportedly cites "Nghị định 330/2026/NĐ-CP" allowing 1-3 month suspension of brandname for advertising violations; unverified, I did not see the decree. — [VietGuys via search result (third-party)](https://advertisingvietnam.com/article/vietguys-cong-bo-giay-phep-cung-cap-dich-vu-vien-thong-khong-co-ha-tang-mang)

### Inferences
- Cost ladder per contact (VND, ex-VAT where stated): ZNS 200-300, Zalo consultation in-quota ~0 / overage 55, Messenger marketing message price unknown, SMS brandname ~650-900.

### Gaps
- Official carrier price lists (Viettel/VinaPhone/MobiFone) not found; brandname registration requirements not researched.

## 10. Vietnam law on spam/advertising messages affecting follow-up

### Takeaway
Decree 91/2020/NĐ-CP (in force from 1 Oct 2020) governs spam SMS, email and calls (consent, opt-out, 7:00-22:00, DoNotCall); it appears not to address OTT apps today. The Ministry of Public Security published a draft replacement on 8 Sep 2026 that would extend to OTT messaging; not yet adopted per what I found. The Personal Data Protection Law (91/2025/QH15, effective 1 Jan 2026) adds a consent requirement.

### Cited Findings
- Decree 91/2020 (in force 1 Oct 2020; via a VOH article quoting an official, not the decree text): ads sent without recipient consent are spam; after a first registration SMS, if the user refuses or doesn't reply, no further messages; advertising SMS allowed 7:00-22:00; ad calls 8:00-17:00; max 3 SMS per number and 3 emails per address per 24h and 1 call, unless user agrees otherwise; DoNotCall list; fines 5-10 million VND for ad calls without consent, 80-100 million VND for ad messages/calls to DoNotCall numbers, 140-170 million VND for telecom/internet enterprises that violate. Article does not address OTT. — [VOH](https://voh.com.vn/cong-nghe/nhung-diem-moi-cua-nghi-dinh-91-ve-chong-thu-rac-tin-nhan-rac-379453.html)
- Circular 22/2021/TT-BTTTT guides Decree 91. — [Báo Pháp luật search result](https://doanhnhan.baophapluat.vn/nha-mang-noi-gi-khi-nghi-dinh-chong-tin-nhan-rac-cuoc-goi-rac-co-hieu-luc-33812.html)
- Draft decree replacing Decree 91 (MPS published the dossier 8 Sep 2026): centralised data-driven management, spam identification criteria, national portal and complaint system; expands scope to messaging and calls on OTT apps and VoIP/SIP trunk; businesses must register and use an identifying name (tên định danh) for ad/business messages; advertisers must send a copy of ad messages to the complaint system (per one summary); keeps the DoNotCall ban; under Ministry of Justice appraisal; effective 1 Jan 2027 if adopted (one source). Another article (10 Sep 2026) notes the draft's consent rules are not described. — [VnEconomy](https://vneconomy.vn/de-xuat-thay-nghi-dinh-91-siet-quan-ly-cuoc-goi-va-tin-nhan-rac.htm), [Doanh nghiệp hội nhập](https://doanhnghiephoinhap.vn/du-thao-nghi-dinh-chong-tin-nhan-rac-cuoc-goi-rac-nhung-diem-moi-doanh-nghiep-va-nguoi-dan-can-luu-y-149589.html), [MPS draft comparison table (document)](https://bocongan.gov.vn/media/bca-media/library-20260909084715-c3d4dec4-0f78-459d-96de-3293d10b69b5-4-ban-so-sanh-du-thao.docx)
- Personal Data Protection Law 91/2025/QH15 passed 26 Jun 2025, effective 1 Jan 2026; Decree 356/2025/NĐ-CP details it; using personal data for ads/remarketing requires data-subject consent (Art. 9(1) per a VOH article); consent can be withdrawn (Art. 4). — [VOH](https://voh.com.vn/phap-luat/co-duoc-su-dung-du-lieu-khach-hang-de-quang-cao-tiep-thi-lai-khong-645977.html), [VnEconomy](https://vneconomy.vn/nhung-diem-moi-trong-luat-bao-ve-du-lieu-ca-nhan-tu-112026.htm)

### Inferences
- A salesperson's one-to-one reply to a customer who initiated the chat is service communication, not an "advertisement" in the Decree 91 sense; an automated chase campaign with promotional content to people who did not opt in (e.g. SMS to a number obtained from chat) is risky. Keep: 7:00-22:00 sending window, max 3 ads per 24h, honour opt-out/"stop" replies, record consent source, check DoNotCall for SMS (INFERRED; get legal review).
- Meta/Zalo platform rules are stricter than the law for in-platform messaging; legal exposure mostly comes from using phone numbers extracted from chat for SMS/ZNS marketing.

### Gaps
- Primary text of Decree 91/2020 and 22/2021/TT-BTTTT could not be fetched (thuvienphapluat/luatminhkhue returned 403); provisions are from news summaries.
- Draft decree text not read; adoption status after Sep 2026 unknown; Decree 330/2026 claim unverified.
- Penalties under current Decree 15/2020 (as amended) for spam not researched.
