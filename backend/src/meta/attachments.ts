/**
 * Rút tệp đính kèm của tin Messenger thành dạng an toàn để hiển thị. URL do Meta/khách cung cấp nên chỉ chấp nhận
 * https tới máy chủ của Facebook (CDN); URL khác bị bỏ để giao diện không tải tài nguyên từ nơi tùy ý.
 */
export interface AttachmentView {
  type: 'image' | 'video' | 'audio' | 'file' | 'other';
  url: string | null;
}

const KNOWN = new Set(['image', 'video', 'audio', 'file']);
const HOSTS = ['fbcdn.net', 'facebook.com', 'fbsbx.com'];

const DEMO_ASSET = /^\/api\/demo\/assets\/[a-z0-9-]+\.png$/;

export function isAllowedMediaUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 4000) return false;
  // Ảnh mẫu của demo (do chính server phục vụ, chỉ tồn tại khi DEMO_MODE); không phải URL ngoài.
  if (DEMO_ASSET.test(raw)) return true;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  return HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

export function toAttachmentViews(raw: unknown): AttachmentView[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).map((a): AttachmentView => {
    const o = (a && typeof a === 'object' ? a : {}) as { type?: unknown; payload?: { url?: unknown } };
    const type = typeof o.type === 'string' && KNOWN.has(o.type) ? (o.type as AttachmentView['type']) : 'other';
    const url = isAllowedMediaUrl(o.payload?.url) ? o.payload.url : null;
    return { type, url };
  });
}
