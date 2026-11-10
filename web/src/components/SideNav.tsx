import type { ReactNode } from 'react';
import type { Role } from '../api/types';
import { useSession, type View } from '../state/session';

const icon = (path: ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

const ITEMS: Array<{ view: View; label: string; icon: ReactNode; roles?: Role[] }> = [
  { view: 'chat', label: 'Hội thoại', icon: icon(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />) },
  {
    view: 'home',
    label: 'Trang chủ',
    icon: icon(
      <>
        <path d="M3 11l9-8 9 8" />
        <path d="M5 10v10h14V10" />
      </>,
    ),
  },
  {
    view: 'pages',
    label: 'Page Facebook',
    roles: ['owner', 'manager'],
    icon: icon(<path d="M4 4h16v12H8l-4 4V4z" />),
  },
  {
    view: 'ai',
    label: 'AI',
    roles: ['owner', 'manager'],
    icon: icon(<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />),
  },
  {
    view: 'team',
    label: 'Đội',
    roles: ['owner', 'manager'],
    icon: icon(
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
        <path d="M16 5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
      </>,
    ),
  },
];

export function SideNav() {
  const { view, setView, role } = useSession();
  return (
    <nav aria-label="Điều hướng" className="flex w-16 flex-none flex-col items-center gap-1.5 border-r border-line bg-white pt-3">
      {ITEMS.filter((it) => !it.roles || it.roles.includes(role)).map((it) => {
        const active = view === it.view;
        return (
          <button
            key={it.view}
            type="button"
            aria-label={it.label}
            aria-current={active ? 'page' : undefined}
            title={it.label}
            onClick={() => setView(it.view)}
            className={`flex h-11 w-11 items-center justify-center rounded-[10px] border-0 ${active ? 'bg-brand-soft text-brand' : 'bg-transparent text-ink-3 hover:bg-canvas'}`}
          >
            {it.icon}
          </button>
        );
      })}
    </nav>
  );
}
