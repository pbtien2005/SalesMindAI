import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, getApiRole } from './client';
import type { DecideBody } from './types';

/** Giao diện đọc lại dữ liệu mỗi 2 giây (không dùng SSE/WebSocket, xem doc/PLAN-demo-mvp.md). */
export const POLL_MS = 2000;

/** Lỗi 4xx từ server là lỗi nghiệp vụ, thử lại cũng vậy; chỉ thử lại khi mất mạng tạm thời. */
export const shouldRetry = (count: number, err: unknown): boolean => !(err instanceof ApiError && err.status !== 0) && count < 2;

// Khóa truy vấn có kèm vai trò vì `/home` trả `role`.
const key = (...parts: unknown[]) => [getApiRole(), ...parts] as const;

export const useNow = () => useQuery({ queryKey: key('now'), queryFn: api.now, refetchInterval: POLL_MS, retry: shouldRetry });
export const usePersonas = () => useQuery({ queryKey: ['personas'], queryFn: api.personas, staleTime: Infinity, retry: shouldRetry });
export const useInbox = () => useQuery({ queryKey: key('inbox'), queryFn: api.inbox, refetchInterval: POLL_MS, retry: shouldRetry });
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
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'personas' });
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
