import { ChatView } from './components/ChatView';
import { HomeView } from './components/HomeView';
import { PagesView } from './components/PagesView';
import { TeamView } from './components/TeamView';
import { SideNav } from './components/SideNav';
import { SimulatorPanel } from './components/SimulatorPanel';
import { TopBar } from './components/TopBar';
import { useSession } from './state/session';

export function App() {
  const { view } = useSession();
  return (
    <div className="flex h-full min-w-[1280px] flex-col">
      <a href="#main" className="skip-link">
        Bỏ qua tới nội dung chính
      </a>
      <TopBar />
      <div className="relative flex min-h-0 grow">
        <SideNav />
        {view === 'chat' ? <ChatView /> : view === 'team' ? <TeamView /> : view === 'pages' ? <PagesView /> : <HomeView />}
        <SimulatorPanel />
      </div>
    </div>
  );
}
