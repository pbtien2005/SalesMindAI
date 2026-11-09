import { createHmac } from 'node:crypto';
import { z } from 'zod';

/** Quyền xin khi đăng nhập Facebook (xem PROGRESS.md điểm 2: `business_management` chưa xác minh). */
export const LOGIN_SCOPES = [
  'pages_show_list',
  'pages_manage_metadata',
  'pages_messaging',
  'pages_read_engagement',
] as const;

/** Field webhook đăng ký cho Page. Không đăng ký `message_echoes`: module này không cần tin của Page. */
export const SUBSCRIBED_FIELDS = ['messages'] as const;

/** Lỗi gọi Graph API. Thông báo đã loại mọi token và secret đã dùng trong request. */
export class GraphApiError extends Error {
  override readonly name = 'GraphApiError';
  constructor(
    message: string,
    /** Mã HTTP, null nếu không tới được máy chủ (mạng, timeout). */
    readonly httpStatus: number | null,
    /** `error.code` của Meta. */
    readonly code: number | null,
    readonly subcode: number | null,
    readonly type: string | null,
  ) {
    super(message);
  }

  /** Mã 190: token không hợp lệ hoặc đã hết hiệu lực (đổi mật khẩu, thu hồi quyền...). */
  get isTokenInvalid(): boolean {
    return this.code === 190;
  }

  /**
   * Chạm giới hạn tốc độ: nên chờ rồi thử lại, không phải lỗi vĩnh viễn.
   * 80001 do tài liệu `subscribed_apps` nêu ("Too many calls to this Page account"); 4, 17, 32, 613
   * là các mã giới hạn tốc độ thường gặp của Graph API theo hiểu biết chung, CHƯA đối chiếu tài liệu.
   */
  get isRateLimited(): boolean {
    return this.code !== null && RATE_LIMIT_CODES.has(this.code);
  }
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001]);

export interface GraphClientOptions {
  /** Ví dụ `v26.0`. */
  apiVersion: string;
  appId: string;
  appSecret: string;
  /**
   * ID cấu hình Facebook Login for Business (App Dashboard). Có thì hộp thoại dùng `config_id` thay cho
   * `scope` (Meta khuyên dùng với app loại Business). Bỏ trống: dùng `scope` như Facebook Login thường.
   */
  loginConfigId?: string;
  /** Cho test thay bằng fetch giả. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface FacebookPage {
  id: string;
  name: string;
  /** Page access token. Bí mật: không log, mã hóa trước khi lưu. */
  accessToken: string;
}

const GRAPH_HOST = 'https://graph.facebook.com';
const MAX_ACCOUNT_PAGES = 20; // 20 trang kết quả, đủ cho hàng nghìn Page

const tokenResponse = z.object({ access_token: z.string().min(1), expires_in: z.number().optional() });

const accountsResponse = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string(), access_token: z.string().optional() })),
  paging: z
    .object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() })
    .optional(),
});

const conversationsResponse = z.object({
  data: z.array(z.object({ id: z.string().min(1), updated_time: z.string().optional() })),
  paging: z
    .object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() })
    .optional(),
});

// `GET /{conversation-id}?fields=messages`: tài liệu nói danh sách chỉ có `id` và `created_time`.
const conversationMessagesResponse = z.object({
  messages: z
    .object({
      data: z.array(z.object({ id: z.string().min(1), created_time: z.string() })),
      paging: z.object({ next: z.string().optional() }).optional(),
    })
    .optional(),
});

const messageResponse = z.object({
  id: z.string().min(1),
  created_time: z.string(),
  from: z.object({ id: z.string().min(1) }).optional(),
  message: z.string().optional(),
});

export interface ConversationRef {
  id: string;
  updatedTime: string | null;
}

/** Chi tiết một tin nhắn lấy từ Conversations API. */
export interface GraphMessage {
  id: string;
  createdAt: Date;
  /** ID người gửi (PSID của khách, hoặc ID Page nếu là tin do Page gửi). */
  fromId: string | null;
  text: string | null;
}

/**
 * `created_time` của Graph có dạng `2026-11-09T07:12:30+0000` (độ lệch múi giờ không có dấu hai chấm),
 * V8 vẫn đọc được nhưng chuẩn ISO thì cần `+00:00`; chuẩn hóa để không phụ thuộc hành vi riêng của V8.
 */
export function parseGraphTime(value: string): Date | null {
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

const errorBody = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
  }),
});

/** Parse phản hồi của Meta. Lỗi không kèm nội dung phản hồi (có thể chứa token). */
function parseBody<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new GraphApiError(`Phản hồi của Meta không đúng dạng (${what}).`, 200, null, null, null);
  return r.data;
}

export class GraphClient {
  readonly #opts: Required<Omit<GraphClientOptions, 'fetch' | 'loginConfigId'>> & {
    fetch: typeof fetch;
    loginConfigId?: string;
  };

  constructor(opts: GraphClientOptions) {
    this.#opts = { timeoutMs: 10_000, fetch: globalThis.fetch, ...opts };
  }

  /** `appsecret_proof` = HMAC-SHA256(access_token, app_secret) dạng hex (Meta: "Secure requests"). */
  #proof(accessToken: string): string {
    return createHmac('sha256', this.#opts.appSecret).update(accessToken).digest('hex');
  }

  /** URL hộp thoại Facebook Login. `state` được Meta trả về nguyên vẹn ở callback. */
  loginUrl(args: { redirectUri: string; state: string; scopes?: readonly string[] }): string {
    const url = new URL(`https://www.facebook.com/${this.#opts.apiVersion}/dialog/oauth`);
    url.searchParams.set('client_id', this.#opts.appId);
    url.searchParams.set('redirect_uri', args.redirectUri);
    url.searchParams.set('state', args.state);
    url.searchParams.set('response_type', 'code');
    if (this.#opts.loginConfigId) {
      // Facebook Login for Business: quyền nằm trong cấu hình; Meta khuyên không gửi kèm scope.
      // override_default_response_type để nhận `code` (đổi token ở server) thay vì token ở trình duyệt.
      url.searchParams.set('config_id', this.#opts.loginConfigId);
      url.searchParams.set('override_default_response_type', 'true');
    } else {
      url.searchParams.set('scope', (args.scopes ?? LOGIN_SCOPES).join(','));
    }
    return url.toString();
  }

  /** Đổi `code` lấy user token ngắn hạn. `redirectUri` phải đúng bằng URI lúc bắt đầu đăng nhập. */
  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const body = await this.#request('GET', 'oauth/access_token', {
      params: {
        client_id: this.#opts.appId,
        client_secret: this.#opts.appSecret,
        redirect_uri: redirectUri,
        code,
      },
      secrets: [code],
    });
    return parseBody(tokenResponse, body, 'oauth/access_token').access_token;
  }

  /** Đổi user token ngắn hạn sang dài hạn (khoảng 60 ngày). Phải gọi từ server vì có app secret. */
  async exchangeLongLived(shortLivedToken: string): Promise<string> {
    const body = await this.#request('GET', 'oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: this.#opts.appId,
        client_secret: this.#opts.appSecret,
        fb_exchange_token: shortLivedToken,
      },
      secrets: [shortLivedToken],
    });
    return parseBody(tokenResponse, body, 'oauth/access_token').access_token;
  }

  /**
   * Các Page người dùng quản lý, kèm Page token. Page nào không trả token (người dùng thiếu quyền
   * trên Page đó) thì bỏ qua. Phân trang bằng cursor, không đi theo URL `paging.next` do server trả.
   */
  async listPages(userToken: string): Promise<FacebookPage[]> {
    const result: FacebookPage[] = [];
    let after: string | undefined;
    for (let i = 0; i < MAX_ACCOUNT_PAGES; i++) {
      const raw = await this.#request('GET', 'me/accounts', {
        params: { fields: 'id,name,access_token', limit: '100', ...(after ? { after } : {}) },
        accessToken: userToken,
      });
      const page = parseBody(accountsResponse, raw, 'me/accounts');
      for (const p of page.data) {
        if (p.access_token) result.push({ id: p.id, name: p.name, accessToken: p.access_token });
      }
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
      if (!after) return result;
    }
    // Còn trang chưa đọc: báo lỗi thay vì lặng lẽ trả danh sách thiếu Page.
    throw new GraphApiError(`Tài khoản có quá nhiều Page (hơn ${MAX_ACCOUNT_PAGES * 100}).`, 200, null, null, null);
  }

  /**
   * MỘT trang hội thoại của Page (Messenger). Trả thêm `after` nếu còn trang sau; người gọi tự lưu
   * con trỏ để chạy lại được. Tài liệu Meta không nói về phân trang và kích thước trang của endpoint
   * này (dùng cursor kiểu Graph thông thường), cần kiểm chứng bằng Page thật.
   */
  async listConversations(
    pageToken: string,
    fbPageId: string,
    opts: { after?: string; limit?: number } = {},
  ): Promise<{ conversations: ConversationRef[]; after?: string }> {
    const raw = await this.#request('GET', `${encodeURIComponent(fbPageId)}/conversations`, {
      params: {
        platform: 'messenger',
        fields: 'id,updated_time',
        limit: String(opts.limit ?? 25),
        ...(opts.after ? { after: opts.after } : {}),
      },
      accessToken: pageToken,
    });
    const page = parseBody(conversationsResponse, raw, 'conversations');
    const after = page.paging?.next ? page.paging.cursors?.after : undefined;
    return {
      conversations: page.data.map((c) => ({ id: c.id, updatedTime: c.updated_time ?? null })),
      ...(after ? { after } : {}),
    };
  }

  /**
   * ID và thời điểm các tin trong một hội thoại (KHÔNG đảm bảo thứ tự: người gọi tự sắp theo
   * `createdAt`). `hasMore`: Meta báo còn trang sau, tức danh sách này chưa phải toàn bộ. Tài liệu chỉ
   * mô tả `?fields=messages`, không mô tả cách phân trang danh sách tin, nên ta không tự đi tiếp mà
   * báo cho người gọi biết để ghi nhận.
   */
  async listConversationMessages(
    pageToken: string,
    conversationId: string,
  ): Promise<{ messages: Array<{ id: string; createdAt: Date }>; hasMore: boolean }> {
    const raw = await this.#request('GET', encodeURIComponent(conversationId), {
      params: { fields: 'messages' },
      accessToken: pageToken,
    });
    const body = parseBody(conversationMessagesResponse, raw, 'conversation.messages');
    const out: Array<{ id: string; createdAt: Date }> = [];
    for (const m of body.messages?.data ?? []) {
      const createdAt = parseGraphTime(m.created_time);
      if (createdAt) out.push({ id: m.id, createdAt });
    }
    return { messages: out, hasMore: Boolean(body.messages?.paging?.next) };
  }

  /**
   * Chi tiết một tin. Theo tài liệu chỉ có với 20 tin gần nhất của hội thoại; tin cũ hơn trả lỗi
   * "đã xóa" (người gọi coi là không còn lấy được). Không lấy attachment vì tài liệu không nêu field đó.
   */
  async getMessage(pageToken: string, messageId: string): Promise<GraphMessage> {
    const raw = await this.#request('GET', encodeURIComponent(messageId), {
      params: { fields: 'id,created_time,from,message' },
      accessToken: pageToken,
    });
    const m = parseBody(messageResponse, raw, 'message');
    const createdAt = parseGraphTime(m.created_time);
    if (!createdAt) throw new GraphApiError('Phản hồi của Meta không đúng dạng (message.created_time).', 200, null, null, null);
    return { id: m.id, createdAt, fromId: m.from?.id ?? null, text: m.message ?? null };
  }

  /** Đăng ký app nhận webhook của Page. Cần Page token và quyền `pages_manage_metadata`. */
  async subscribePage(
    fbPageId: string,
    pageToken: string,
    fields: readonly string[] = SUBSCRIBED_FIELDS,
  ): Promise<void> {
    const body = await this.#request('POST', `${encodeURIComponent(fbPageId)}/subscribed_apps`, {
      params: { subscribed_fields: fields.join(',') },
      accessToken: pageToken,
    });
    if (!z.object({ success: z.literal(true) }).safeParse(body).success) {
      throw new GraphApiError('Meta không xác nhận việc đăng ký webhook cho Page.', 200, null, null, null);
    }
  }

  async #request(
    method: 'GET' | 'POST',
    path: string,
    req: { params: Record<string, string>; accessToken?: string; secrets?: string[] },
  ): Promise<unknown> {
    const params = new URLSearchParams(req.params);
    if (req.accessToken) {
      params.set('access_token', req.accessToken);
      params.set('appsecret_proof', this.#proof(req.accessToken));
    }
    const url = new URL(`${GRAPH_HOST}/${this.#opts.apiVersion}/${path}`);
    const init: RequestInit = { method, signal: AbortSignal.timeout(this.#opts.timeoutMs) };
    if (method === 'GET') {
      url.search = params.toString();
    } else {
      init.body = params;
      init.headers = { 'content-type': 'application/x-www-form-urlencoded' };
    }
    // Mọi chuỗi bí mật có thể lọt vào thông báo lỗi của Meta hoặc của fetch.
    const secrets = [this.#opts.appSecret, req.accessToken, ...(req.secrets ?? [])].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    const scrub = (s: string) => secrets.reduce((acc, secret) => acc.replaceAll(secret, '[đã ẩn]'), s);

    let res: Response;
    try {
      res = await this.#opts.fetch(url, init);
    } catch (err) {
      // Chỉ dùng tên lỗi (TimeoutError, TypeError...), không dùng message vì có thể chứa URL.
      const name = err instanceof Error ? err.name : 'Error';
      throw new GraphApiError(`Không gọi được Graph API (${name}).`, null, null, null, null);
    }

    // Timeout bao cả việc đọc body: server gửi header rồi treo thì res.text() cũng bị ngắt.
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      throw new GraphApiError(`Không đọc được phản hồi từ Graph API (${name}).`, res.status, null, null, null);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }

    const failure = errorBody.safeParse(json);
    if (!res.ok || failure.success) {
      const e = failure.success ? failure.data.error : undefined;
      throw new GraphApiError(
        scrub(e?.message ?? `Graph API trả HTTP ${res.status}.`),
        res.status,
        e?.code ?? null,
        e?.error_subcode ?? null,
        e?.type ?? null,
      );
    }
    return json;
  }
}
