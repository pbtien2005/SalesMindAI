import { useHome } from './api/hooks';
import { ChatView } from './components/ChatView';
import { ErrorBanner } from './components/ErrorBanner';
import { SideNav } from './components/SideNav';
import { TopBar } from './components/TopBar';
import { useSession } from './state/session';

/** Giữ chỗ cho Trang chủ (mốc F4). */
function HomePlaceholder() {
  const home = useHome();
  return (
    <main className="min-w-0 grow overflow-auto p-6">
      <ErrorBanner error={home.error} />
      {!home.error ? <p className="text-ink-3">Trang chủ: làm ở mốc F4.</p> : null}
    </main>
  );
}

export function App() {
  const { view } = useSession();
  return (
    <div className="flex h-full min-w-[1280px] flex-col">
      <TopBar />
      <div className="flex min-h-0 grow">
        <SideNav />
        {view === 'chat' ? <ChatView /> : <HomePlaceholder />}
      </div>
    </div>
  );
}
