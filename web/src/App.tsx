import { useHome, useInbox } from './api/hooks';
import { ErrorBanner } from './components/ErrorBanner';
import { SideNav } from './components/SideNav';
import { TopBar } from './components/TopBar';
import { useSession } from './state/session';

/** Khung F2: màn Hội thoại (F3) và Trang chủ (F4) sẽ thay thế phần giữ chỗ dưới đây. */
function Main() {
  const { view } = useSession();
  const inbox = useInbox();
  const home = useHome();
  const error = inbox.error ?? home.error;

  return (
    <main className="min-w-0 grow overflow-auto p-6">
      <ErrorBanner error={error} />
      {!error ? (
        <p className="text-ink-3">
          {view === 'chat' ? 'Màn Hội thoại: làm ở mốc F3.' : 'Trang chủ: làm ở mốc F4.'}
          {inbox.data ? ` Đã tải ${inbox.data.conversations.length} hội thoại.` : ' Đang tải…'}
        </p>
      ) : null}
    </main>
  );
}

export function App() {
  return (
    <div className="flex h-full min-w-[1280px] flex-col">
      <TopBar />
      <div className="flex min-h-0 grow">
        <SideNav />
        <Main />
      </div>
    </div>
  );
}
