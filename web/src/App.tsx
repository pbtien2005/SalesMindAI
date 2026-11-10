import { ChatView } from './components/ChatView';
import { HomeView } from './components/HomeView';
import { SideNav } from './components/SideNav';
import { SimulatorPanel } from './components/SimulatorPanel';
import { TopBar } from './components/TopBar';
import { useSession } from './state/session';

export function App() {
  const { view } = useSession();
  return (
    <div className="flex h-full min-w-[1280px] flex-col">
      <TopBar />
      <div className="relative flex min-h-0 grow">
        <SideNav />
        {view === 'chat' ? <ChatView /> : <HomeView />}
        <SimulatorPanel />
      </div>
    </div>
  );
}
