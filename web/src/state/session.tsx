import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { getApiRole, setApiRole } from '../api/client';
import type { Role } from '../api/types';

export type View = 'chat' | 'home';

interface Session {
  role: Role;
  setRole: (r: Role) => void;
  view: View;
  setView: (v: View) => void;
  /** Hội thoại đang mở ở màn Hội thoại. */
  conversationId: string | null;
  selectConversation: (id: string | null) => void;
  /** Mở hội thoại từ nơi khác (ví dụ thẻ P1 ở Trang chủ): chuyển sang màn Hội thoại. */
  openConversation: (id: string) => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(getApiRole());
  const [view, setView] = useState<View>('home');
  const [conversationId, selectConversation] = useState<string | null>(null);

  // Đặt vai trò cho lớp API NGAY khi đổi, trước lần render kế tiếp, để request tiếp theo mang đúng header.
  const setRole = useCallback((r: Role) => {
    setApiRole(r);
    setRoleState(r);
  }, []);

  const openConversation = useCallback((id: string) => {
    selectConversation(id);
    setView('chat');
  }, []);

  const value = useMemo<Session>(
    () => ({ role, setRole, view, setView, conversationId, selectConversation, openConversation }),
    [role, setRole, view, conversationId, openConversation],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession phải nằm trong <SessionProvider>.');
  return s;
}
