import type {
  ConversationDetail,
  DecideBody,
  DecideResult,
  HistoryEntry,
  OverdueTask,
  OrderRow,
  HomeData,
  ConversationSummary,
  CustomerStatus,
  Persona,
  AuthConfig,
  AiStatus,
  InviteInfo,
  PagesData,
  TeamData,
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

async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  // x-requested-with: header chống CSRF mà backend bắt buộc cho mọi POST (cookie phiên đi kèm tự động).
  const headers: Record<string, string> = { 'x-requested-with': 'salesmind', ...extra };
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
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);

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
  inviteInfo: (token: string) => post<InviteInfo>('/api/auth/invite-info', { token }),
  acceptInvite: (b: { token: string; displayName: string; password: string; email?: string }) => post<{ ok: true }>('/api/auth/accept-invite', b),
  pages: () => get<PagesData>('/api/pages'),
  connectUrl: () => post<{ url: string; expiresInSeconds: number }>('/api/pages/connect-url'),
  disconnectPage: (id: string) => post<{ ok: true; metaUnsubscribed: boolean }>(`/api/pages/${encodeURIComponent(id)}/disconnect`),
  backfillPage: (id: string) => post<{ queued: boolean }>(`/api/pages/${encodeURIComponent(id)}/backfill`),
  deleteTenant: (confirmName: string, password: string) => post<{ ok: true }>('/api/tenant/delete', { confirmName, password }),
  ai: () => get<AiStatus>('/api/ai'),
  enableAi: () => post<{ enabled: true }>('/api/ai/enable', { acknowledgeLegal: true }),
  disableAi: () => post<{ enabled: false }>('/api/ai/disable'),
  team: () => get<TeamData>('/api/team'),
  createInvite: (b: { role: string; email?: string }) => post<{ id: string; link: string; expiresAt: string; emailed: boolean }>('/api/team/invites', b),
  revokeInvite: (id: string) => post<{ ok: true }>(`/api/team/invites/${encodeURIComponent(id)}/revoke`),
  setRole: (userId: string, role: string) => patch<{ ok: true }>(`/api/team/members/${encodeURIComponent(userId)}`, { role }),
  removeMember: (userId: string) => del<{ ok: true }>(`/api/team/members/${encodeURIComponent(userId)}`),
  verifyEmail: (token: string) => post<{ ok: true }>('/api/auth/verify-email', { token }),

  now: () => get<{ now: string; role: Role; roleName: string }>('/api/now'),
  personas: () => get<{ personas: Persona[] }>('/api/personas'),
  inbox: (q: { pageId?: string; cursor?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.pageId) p.set('pageId', q.pageId);
    if (q.cursor) p.set('cursor', q.cursor);
    p.set('limit', String(q.limit ?? 100));
    return get<{ now: string; conversations: ConversationSummary[]; nextCursor: string | null }>(`/api/inbox?${p.toString()}`);
  },
  home: () => get<HomeData>('/api/home'),
  overdue: () => get<{ now: string; overdue: OverdueTask[] }>('/api/overdue'),
  conversation: (id: string) => get<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}`),
  history: (id: string) => get<{ history: HistoryEntry[] }>(`/api/conversations/${encodeURIComponent(id)}/history`),

  advanceMinutes: (minutes: number) => post<{ now: string }>('/api/clock/advance', { minutes }),
  advanceTo: (to: string) => post<{ now: string }>('/api/clock/advance', { to }),
  resetDemo: () => post<{ now: string }>('/api/demo/reset'),

  decide: (proposalId: string, body: DecideBody) => post<DecideResult>(`/api/proposals/${encodeURIComponent(proposalId)}/decide`, body),
  setCustomerStatus: (conversationId: string, status: CustomerStatus) =>
    post<{ status: CustomerStatus; by: string | null; at: string | null; changed: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}/status`, { status }),
  stopFollowup: (conversationId: string) => post<{ stopped: true }>(`/api/conversations/${encodeURIComponent(conversationId)}/stop-followup`),

  customerMessage: (target: { persona: string } | { conversationId: string }, text: string) =>
    post<{ accepted: true; conversationId: string }>('/api/demo/customer-message', { ...target, text }),
  send: (conversationId: string, text: string, idempotencyKey: string) =>
    request<{ ok: true; messageId: string }>('POST', `/api/conversations/${encodeURIComponent(conversationId)}/send`, { text }, { 'idempotency-key': idempotencyKey }),
  orders: () => get<{ orders: OrderRow[] }>('/api/orders'),
  updateOrder: (id: string, patch: { address?: string; quantity?: number; customerName?: string; phone?: string }) => post<{ ok: true }>(`/api/orders/${encodeURIComponent(id)}/update`, patch),
  sendReplyDraft: (id: string, text?: string) => post<{ ok: true; orderStatus: string | null }>(`/api/reply-drafts/${encodeURIComponent(id)}/send`, text === undefined ? {} : { text }),
  confirmPayment: (id: string, amountVnd?: number) => post<{ ok: true; depositPaidVnd: number; depositReached: boolean }>(`/api/payments/${encodeURIComponent(id)}/confirm`, amountVnd === undefined ? {} : { amountVnd }),
  rejectPayment: (id: string) => post<{ ok: true }>(`/api/payments/${encodeURIComponent(id)}/reject`),
  confirmOrder: (id: string, address: string) => post<{ ok: true; code: string }>(`/api/orders/${encodeURIComponent(id)}/confirm`, { address }),
  customerImage: (target: { persona: string } | { conversationId: string }, file: string) => post<{ accepted: true; conversationId: string }>('/api/demo/customer-image', { ...target, file }),
  pageMessage: (conversationId: string, text: string) => post<{ accepted: true }>('/api/demo/page-message', { conversationId, text }),
};
