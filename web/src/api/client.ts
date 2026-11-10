import type {
  ConversationDetail,
  DecideBody,
  DecideResult,
  HistoryEntry,
  HomeData,
  ConversationSummary,
  Persona,
  AuthConfig,
  Me,
  Role,
} from './types';

/** Lỗi từ API: `{error:{code,message}}`. `status` là mã HTTP (0 nếu không kết nối được). */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Gọi khi một route (không phải đăng nhập) trả 401: phiên đã hết hạn hoặc bị thu hồi. */
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null): void => {
  onUnauthorized = fn;
};

/** Các route `/api/auth/*` tự xử lý 401 (sai mật khẩu hay chưa đăng nhập không có nghĩa là "phiên hết hạn giữa chừng"). */
const isAuthAttempt = (path: string) => path.startsWith('/api/auth/');

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  // x-requested-with: header chống CSRF mà backend bắt buộc cho mọi POST (cookie phiên đi kèm tự động).
  const headers: Record<string, string> = { 'x-requested-with': 'salesmind' };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('network', 'Không kết nối được tới máy chủ. Kiểm tra mạng, hoặc backend đã chạy chưa.', 0);
  }

  const text = await res.text();
  let json: unknown = null;
  if (text !== '') {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string } } | null)?.error;
    if (res.status === 401 && !isAuthAttempt(path)) onUnauthorized?.();
    throw new ApiError(e?.code ?? 'http_error', e?.message ?? `Máy chủ trả lỗi ${res.status}.`, res.status);
  }
  return json as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});

export const api = {
  authConfig: () => get<AuthConfig>('/api/auth/config'),
  /** Chưa đăng nhập thì `null` (không ném). */
  me: async (): Promise<Me | null> => {
    try {
      return (await get<{ user: Me }>('/api/auth/me')).user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },
  login: (email: string, password: string) => post<{ ok: true }>('/api/auth/login', { email, password }),
  demoLogin: (as: 'lan' | 'ha') => post<{ ok: true }>('/api/auth/demo-login', { as }),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  signup: (b: { email: string; password: string; displayName: string; businessName: string }) => post<{ ok: true }>('/api/auth/signup', b),
  forgot: (email: string) => post<{ ok: true }>('/api/auth/forgot', { email }),
  reset: (token: string, password: string) => post<{ ok: true }>('/api/auth/reset', { token, password }),
  verifyEmail: (token: string) => post<{ ok: true }>('/api/auth/verify-email', { token }),

  now: () => get<{ now: string; role: Role; roleName: string }>('/api/now'),
  personas: () => get<{ personas: Persona[] }>('/api/personas'),
  inbox: () => get<{ now: string; conversations: ConversationSummary[] }>('/api/inbox'),
  home: () => get<HomeData>('/api/home'),
  conversation: (id: string) => get<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}`),
  history: (id: string) => get<{ history: HistoryEntry[] }>(`/api/conversations/${encodeURIComponent(id)}/history`),

  advanceMinutes: (minutes: number) => post<{ now: string }>('/api/clock/advance', { minutes }),
  advanceTo: (to: string) => post<{ now: string }>('/api/clock/advance', { to }),
  resetDemo: () => post<{ now: string }>('/api/demo/reset'),

  decide: (proposalId: string, body: DecideBody) => post<DecideResult>(`/api/proposals/${encodeURIComponent(proposalId)}/decide`, body),
  stopFollowup: (conversationId: string) => post<{ stopped: true }>(`/api/conversations/${encodeURIComponent(conversationId)}/stop-followup`),

  customerMessage: (target: { persona: string } | { conversationId: string }, text: string) =>
    post<{ accepted: true; conversationId: string }>('/api/demo/customer-message', { ...target, text }),
  pageMessage: (conversationId: string, text: string) => post<{ accepted: true }>('/api/demo/page-message', { conversationId, text }),
};
