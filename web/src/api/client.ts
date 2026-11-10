import type {
  ConversationDetail,
  DecideBody,
  DecideResult,
  HistoryEntry,
  HomeData,
  ConversationSummary,
  Persona,
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

// Vai trò hiện tại, chỉ để backend ghi "ai duyệt" (không phải bảo mật). Đặt đồng bộ khi người dùng đổi vai.
let currentRole: Role = 'lan';
export const setApiRole = (role: Role): void => {
  currentRole = role;
};
export const getApiRole = (): Role => currentRole;

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-demo-role': currentRole };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('network', 'Không kết nối được tới máy chủ demo (127.0.0.1:3000). Kiểm tra đã chạy `npm run dev` trong backend/ chưa.', 0);
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
    throw new ApiError(e?.code ?? 'http_error', e?.message ?? `Máy chủ trả lỗi ${res.status}.`, res.status);
  }
  return json as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});

export const api = {
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
