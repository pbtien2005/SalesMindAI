import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { api, ApiError } from './client';
import type { ConversationSummary, DecideBody } from './types';

/** Giao diện đọc lại dữ liệu mỗi 2 giây (không dùng SSE/WebSocket, xem doc/PLAN-demo-mvp.md). */
export const POLL_MS = 2000;

/** Lỗi 4xx từ server là lỗi nghiệp vụ, thử lại cũng vậy; chỉ thử lại khi mất mạng tạm thời. */
export const shouldRetry = (count: number, err: unknown): boolean => !(err instanceof ApiError && err.status !== 0) && count < 2;

// Đổi người dùng thì cache bị xóa sạch (xem AuthGate), nên khóa không cần kèm người dùng.
const key = (...parts: unknown[]) => parts;

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: api.me, retry: shouldRetry, refetchOnWindowFocus: true });
export const useAuthConfig = () => useQuery({ queryKey: ['authConfig'], queryFn: api.authConfig, staleTime: Infinity, retry: shouldRetry });

/** Sau đăng nhập hoặc đăng xuất: bỏ mọi dữ liệu của người trước (không để lọt sang người sau), rồi đọc lại `me`. */
function useSwitchUser() {
  const qc = useQueryClient();
  return async () => {
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'authConfig' && q.queryKey[0] !== 'me' });
    await qc.invalidateQueries({ queryKey: ['me'] });
  };
}

export function useLogin() {
  const switchUser = useSwitchUser();
  return useMutation({ mutationFn: (v: { email: string; password: string }) => api.login(v.email, v.password), onSuccess: switchUser });
}

export function useDemoLogin() {
  const switchUser = useSwitchUser();
  return useMutation({ mutationFn: (as: 'lan' | 'ha') => api.demoLogin(as), onSuccess: switchUser });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSettled: () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'authConfig' && q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], null);
    },
  });
}

export const useNow = () => useQuery({ queryKey: key('now'), queryFn: api.now, refetchInterval: POLL_MS, retry: shouldRetry });
export const usePersonas = () => useQuery({ queryKey: ['personas'], queryFn: api.personas, staleTime: Infinity, retry: shouldRetry });
/** Số hội thoại tải mỗi lần bấm "Tải thêm". */
export const INBOX_STEP = 50;

/**
 * Hộp thư theo trang con trỏ: đọc nối tiếp các trang (tối đa 100 dòng mỗi trang) cho tới khi đủ `target` dòng.
 * `hasMore` báo còn hội thoại cũ hơn chưa tải.
 */
export const useInbox = (pageId?: string, target: number = INBOX_STEP) =>
  useQuery({
    queryKey: key('inbox', pageId ?? null, target),
    queryFn: async () => {
      const out: ConversationSummary[] = [];
      let cursor: string | undefined;
      let now = '';
      let more = false;
      do {
        const r = await api.inbox({ ...(pageId ? { pageId } : {}), ...(cursor ? { cursor } : {}), limit: Math.min(100, target - out.length) });
        now = r.now;
        out.push(...r.conversations);
        cursor = r.nextCursor ?? undefined;
        more = cursor !== undefined;
      } while (cursor && out.length < target);
      return { now, conversations: out, hasMore: more };
    },
    refetchInterval: POLL_MS,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  });
export const useHome = () => useQuery({ queryKey: key('home'), queryFn: api.home, refetchInterval: POLL_MS, retry: shouldRetry });
export const useConversation = (id: string | null) =>
  useQuery({
    queryKey: key('conversation', id),
    queryFn: () => api.conversation(id as string),
    enabled: id !== null,
    refetchInterval: POLL_MS,
    retry: shouldRetry,
  });
export const useHistory = (id: string | null) =>
  useQuery({ queryKey: key('history', id), queryFn: () => api.history(id as string), enabled: id !== null, retry: shouldRetry });

/** Sau mọi thao tác ghi, làm mới toàn bộ dữ liệu đọc (đồng hồ, hộp thư, Trang chủ, hội thoại). */
function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'personas' && q.queryKey[0] !== 'team' && q.queryKey[0] !== 'ai' && q.queryKey[0] !== 'pages' && q.queryKey[0] !== 'me' && q.queryKey[0] !== 'authConfig' });
}

export function useAdvanceClock() {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: (minutes: number) => api.advanceMinutes(minutes), onSuccess: refresh });
}

export function useAdvanceClockTo() {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: (to: string) => api.advanceTo(to), onSuccess: refresh });
}

export function useResetDemo() {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: () => api.resetDemo(), onSuccess: refresh });
}

export function useDecide() {
  const refresh = useRefreshAll();
  // Lỗi 409 not_pending nghĩa là đề xuất đã được xử lý nơi khác: làm mới để hộp đề xuất cập nhật.
  return useMutation({
    mutationFn: (v: { proposalId: string; body: DecideBody }) => api.decide(v.proposalId, v.body),
    onSuccess: refresh,
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'not_pending') void refresh();
    },
  });
}

export function useStopFollowup() {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: (conversationId: string) => api.stopFollowup(conversationId), onSuccess: refresh });
}

export function useCustomerMessage() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (v: { target: { persona: string } | { conversationId: string }; text: string }) => api.customerMessage(v.target, v.text),
    onSuccess: refresh,
  });
}

export function usePageMessage() {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: (v: { conversationId: string; text: string }) => api.pageMessage(v.conversationId, v.text), onSuccess: refresh });
}

export const useTeam = () => useQuery({ queryKey: ['team'], queryFn: api.team, retry: shouldRetry });

function useTeamMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }) });
}
export const useCreateInvite = () => useTeamMutation((v: { role: string; email?: string }) => api.createInvite(v));
export const useRevokeInvite = () => useTeamMutation((id: string) => api.revokeInvite(id));
export const useSetRole = () => useTeamMutation((v: { userId: string; role: string }) => api.setRole(v.userId, v.role));
export const useRemoveMember = () => useTeamMutation((userId: string) => api.removeMember(userId));

export const usePages = () => useQuery({ queryKey: ['pages'], queryFn: api.pages, retry: shouldRetry, refetchInterval: POLL_MS });
export const useConnectUrl = () => useMutation({ mutationFn: () => api.connectUrl() });
function usePagesMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['pages'] }) });
}
export const useDisconnectPage = () => usePagesMutation((id: string) => api.disconnectPage(id));
export const useBackfillPage = () => usePagesMutation((id: string) => api.backfillPage(id));

/** Gửi tin thật cho khách. Mỗi lần bấm một khóa chống gửi trùng (giữ nguyên khi tự thử lại, đổi sau khi thành công). */
export function useSendMessage() {
  const refresh = useRefreshAll();
  const keyRef = useRef<string | null>(null);
  return useMutation({
    mutationFn: (v: { conversationId: string; text: string }) => {
      keyRef.current ??= crypto.randomUUID().replaceAll('-', '');
      return api.send(v.conversationId, v.text, keyRef.current);
    },
    onSuccess: () => {
      keyRef.current = null;
      return refresh();
    },
  });
}

export const useAi = () => useQuery({ queryKey: ['ai'], queryFn: api.ai, retry: shouldRetry, refetchInterval: 10_000 });
function useAiMutation(fn: () => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['ai'] }) });
}
export const useEnableAi = () => useAiMutation(() => api.enableAi());
export const useDisableAi = () => useAiMutation(() => api.disableAi());

/** Xóa toàn bộ dữ liệu doanh nghiệp. Thành công thì phiên không còn nên về màn đăng nhập. */
export function useDeleteTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { confirmName: string; password: string }) => api.deleteTenant(v.confirmName, v.password),
    onSuccess: () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'authConfig' && q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], null);
    },
  });
}
