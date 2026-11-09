import { createHmac } from 'node:crypto';

export const APP_SECRET = 'test-app-secret';
export const VERIFY_TOKEN = 'test-verify-token';
export const PAGE_ID = 'PAGE_1';
export const PSID = 'PSID_1';

/** Chữ ký giống Meta: `sha256=` + HMAC-SHA256(body, secret) dạng hex. */
export function sign(raw: Buffer | string, secret = APP_SECRET): string {
  const buf = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
  return 'sha256=' + createHmac('sha256', secret).update(buf).digest('hex');
}

export interface MsgOpts {
  mid: string;
  text?: string;
  timestamp?: number;
  psid?: string;
  pageId?: string;
  isEcho?: boolean;
  attachments?: unknown[];
}

/** Một sự kiện `messaging[]` dạng tin nhắn đến từ khách (hoặc echo nếu isEcho). */
export function messageEvent(o: MsgOpts) {
  const pageId = o.pageId ?? PAGE_ID;
  const psid = o.psid ?? PSID;
  return {
    sender: { id: o.isEcho ? pageId : psid },
    recipient: { id: o.isEcho ? psid : pageId },
    timestamp: o.timestamp ?? 1_700_000_000_000,
    message: {
      mid: o.mid,
      ...(o.text !== undefined ? { text: o.text } : {}),
      ...(o.isEcho ? { is_echo: true } : {}),
      ...(o.attachments ? { attachments: o.attachments } : {}),
    },
  };
}

/** Payload webhook đầy đủ cho một Page. */
export function webhookPayload(events: unknown[], pageId = PAGE_ID) {
  return {
    object: 'page',
    entry: [{ id: pageId, time: 1_700_000_000_500, messaging: events }],
  };
}
