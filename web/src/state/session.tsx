import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Me, Role } from '../api/types';

export type View = 'chat' | 'home' | 'overdue' | 'orders' | 'team' | 'pages' | 'ai';

interface Session {
  /** Người đang đăng nhập (từ `GET /api/auth/me`). */
  me: Me;
  role: Role;
  view: View;
  setView: (v: View) => void;
  /** Hội thoại đang mở ở màn Hội thoại. */
  conversationId: string | null;
  selectConversation: (id: string | null) => void;
  /** Mở hội thoại từ nơi khác (ví dụ thẻ P1 ở Trang chủ): chuyển sang màn Hội thoại. */
  openConversation: (id: string) => void;
  /** Bộ lọc hộp thư khi mở màn Hội thoại từ nơi khác (ví dụ "Xem tất cả" ở thẻ P1). */
  inboxFilter: 'all' | 'p1';
  openInbox: (filter: 'all' | 'p1') => void;
  /** Bảng Giả lập (chỉ dành cho demo). */
  simulatorOpen: boolean;
  toggleSimulator: () => void;
  closeSimulator: () => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  // Quay về từ Facebook (/?connected=… hoặc /?connect_error=…) thì mở thẳng màn Page.
  const [view, setView] = useState<View>(() => (/[?&](connected|connect_error)=/.test(window.location.search) ? 'pages' : 'home'));
  const [conversationId, selectConversation] = useState<string | null>(null);

  const openConversation = useCallback((id: string) => {
    selectConversation(id);
    setView('chat');
  }, []);

  const [inboxFilter, setInboxFilter] = useState<'all' | 'p1'>('all');
  const openInbox = useCallback((filter: 'all' | 'p1') => {
    setInboxFilter(filter);
    setView('chat');
  }, []);

  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const toggleSimulator = useCallback(() => setSimulatorOpen((o) => !o), []);
  const closeSimulator = useCallback(() => setSimulatorOpen(false), []);

  const value = useMemo<Session>(
    () => ({ me, role: me.role, view, setView, conversationId, selectConversation, openConversation, inboxFilter, openInbox, simulatorOpen, toggleSimulator, closeSimulator }),
    [me, view, conversationId, openConversation, inboxFilter, openInbox, simulatorOpen, toggleSimulator, closeSimulator],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession phải nằm trong <SessionProvider>.');
  return s;
}
