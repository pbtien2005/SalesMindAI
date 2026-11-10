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
  /** PSID của khách (người gửi với tin đến, người nhận với echo). */
  psid?: string;
  pageId?: string;
  isEcho?: boolean;
  /** `message.app_id` của echo (Meta có thể gửi số hoặc chuỗi). */
  appId?: string | number;
  attachments?: unknown[];
}

/** Một sự kiện tin nhắn: tin đến từ khách, hoặc echo của Page nếu isEcho. */
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
      ...(o.appId !== undefined ? { app_id: o.appId } : {}),
      ...(o.attachments ? { attachments: o.attachments } : {}),
    },
  };
}

/** Khách thả cảm xúc (theo tài liệu Meta: `reaction: { reaction, emoji, action, mid }`). */
export function reactionEvent(o: { psid?: string; pageId?: string; timestamp?: number; action?: 'react' | 'unreact' | null; senderIsPage?: boolean }) {
  const pageId = o.pageId ?? PAGE_ID;
  const psid = o.psid ?? PSID;
  return {
    sender: { id: o.senderIsPage ? pageId : psid },
    recipient: { id: o.senderIsPage ? psid : pageId },
    timestamp: o.timestamp ?? 1_700_000_000_000,
    reaction: {
      reaction: 'love',
      emoji: '❤️',
      ...(o.action === null ? {} : { action: o.action ?? 'react' }),
      mid: 'mid.reacted.to',
    },
  };
}

/** Khách bấm nút. Cấu trúc bên trong chưa lấy được từ tài liệu; mã chỉ cần khóa `postback`. */
export function postbackEvent(o: { psid?: string; pageId?: string; timestamp?: number } = {}) {
  return {
    sender: { id: o.psid ?? PSID },
    recipient: { id: o.pageId ?? PAGE_ID },
    timestamp: o.timestamp ?? 1_700_000_000_000,
    postback: { title: 'Get Started', payload: 'GET_STARTED' },
  };
}

/** Khách vào qua link m.me có ref trên thread sẵn có. Mã chỉ cần khóa `referral`. */
export function referralEvent(o: { psid?: string; pageId?: string; timestamp?: number } = {}) {
  return {
    sender: { id: o.psid ?? PSID },
    recipient: { id: o.pageId ?? PAGE_ID },
    timestamp: o.timestamp ?? 1_700_000_000_000,
    referral: { ref: 'bao-gia', source: 'SHORTLINK', type: 'OPEN_THREAD' },
  };
}

/** Meta cảnh báo hoặc khóa Page. Theo tài liệu: khóa `policy_enforcement`, `recipient.id` là Page, không có `sender`. */
export function policyEvent(o: { action?: string; reason?: string; pageId?: string; timestamp?: number | null } = {}) {
  return {
    recipient: { id: o.pageId ?? PAGE_ID },
    ...(o.timestamp === null ? {} : { timestamp: o.timestamp ?? 1_700_000_000_000 }),
    policy_enforcement: {
      action: o.action ?? 'warning',
      ...(o.action === 'unblock' ? {} : { reason: o.reason ?? 'Gửi tin bị coi là làm phiền' }),
    },
  };
}

/** Payload webhook đầy đủ cho một Page; `standby` đặt sự kiện vào mảng `standby` thay vì `messaging`. */
export function webhookPayload(events: unknown[], pageId = PAGE_ID, opts: { standby?: boolean; entryTime?: number } = {}) {
  return {
    object: 'page',
    entry: [
      {
        id: pageId,
        time: opts.entryTime ?? 1_700_000_000_500,
        [opts.standby ? 'standby' : 'messaging']: events,
      },
    ],
  };
}
