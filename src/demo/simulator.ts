/**
 * Giả lập tin nhắn Facebook cho demo: dựng payload đúng dạng Meta, KÝ bằng APP_SECRET rồi gửi vào đúng
 * `POST /webhook` (qua `WebhookPoster`). Nhờ đó demo chạy cả kiểm tra chữ ký, hàng đợi, khử trùng và worker.
 * Giờ gửi (`timestamp`) do người gọi đặt, thường là giờ của đồng hồ demo.
 */
import { createHmac, randomUUID } from 'node:crypto';

/** Nơi nhận request đã ký. Server dùng `app.inject`, CLI dùng `fetch`. */
export interface WebhookPoster {
  post(rawBody: string, signature: string): Promise<{ status: number }>;
}

/** Chữ ký giống Meta: `sha256=` + HMAC-SHA256(body, secret) dạng hex. */
export function signBody(rawBody: string, appSecret: string): string {
  return 'sha256=' + createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
}

export interface Persona {
  key: string;
  psid: string;
  displayName: string;
}

/** Khách demo cố định. PSID là chuỗi giả, không có thật trên Facebook. */
export const PERSONAS: Record<string, Persona> = {
  minh: { key: 'minh', psid: 'demo-psid-minh', displayName: 'Facebook: anh Minh' },
  thu: { key: 'thu', psid: 'demo-psid-thu', displayName: 'Chị Thu' },
  duc: { key: 'duc', psid: 'demo-psid-duc', displayName: 'Anh Đức' },
  ngoc: { key: 'ngoc', psid: 'demo-psid-ngoc', displayName: 'Chị Ngọc' },
  mai: { key: 'mai', psid: 'demo-psid-mai', displayName: 'Cô Mai' },
};

interface CommonArgs {
  fbPageId: string;
  psid: string;
  text: string;
  at: Date;
  mid?: string;
}

const newMid = () => `demo.${randomUUID()}`;

function wrap(fbPageId: string, at: Date, event: unknown) {
  return { object: 'page', entry: [{ id: fbPageId, time: at.getTime(), messaging: [event] }] };
}

/** Tin do khách gửi tới Page. */
export function customerPayload(a: CommonArgs) {
  return wrap(a.fbPageId, a.at, {
    sender: { id: a.psid },
    recipient: { id: a.fbPageId },
    timestamp: a.at.getTime(),
    message: { mid: a.mid ?? newMid(), text: a.text },
  });
}

/** Tin do nhân viên gõ ở Page Inbox: Meta gửi dưới dạng echo, `app_id` là của Page Inbox. */
export function pageEchoPayload(a: CommonArgs & { appId: string }) {
  return wrap(a.fbPageId, a.at, {
    sender: { id: a.fbPageId },
    recipient: { id: a.psid },
    timestamp: a.at.getTime(),
    message: { mid: a.mid ?? newMid(), text: a.text, is_echo: true, app_id: a.appId },
  });
}

/** Ký và gửi một payload. Ném lỗi nếu webhook không trả 200. */
export async function sendSigned(poster: WebhookPoster, appSecret: string, payload: unknown): Promise<void> {
  const raw = JSON.stringify(payload);
  const res = await poster.post(raw, signBody(raw, appSecret));
  if (res.status !== 200) throw new Error(`Webhook trả HTTP ${res.status} (kiểm tra APP_SECRET và server).`);
}
