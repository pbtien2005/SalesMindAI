import { useEffect, useRef, useState } from 'react';
import { usePages } from '../api/hooks';
import type { PageView } from '../api/types';
import { useSession } from '../state/session';
import { ConnectPageDialog, useConnectBlock } from './ConnectPageDialog';

const DOT: Record<PageView['status'], string> = {
  active: 'bg-ok',
  token_invalid: 'bg-amber',
  disconnected: 'bg-line-strong',
};

const item = 'flex h-9 w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-sm text-ink hover:bg-canvas disabled:opacity-50 disabled:hover:bg-transparent';

/** Bộ chuyển Page ở đầu thanh bên: nơi thêm Page mới và lối vào màn quản lý Page. Chỉ owner và manager thấy. */
export function PageSwitcher() {
  const { role, setView } = useSession();
  const canConnect = role === 'owner' || role === 'manager';
  const pages = usePages(canConnect);
  const blockReason = useConnectBlock();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!canConnect) return null;

  const list = (pages.data?.pages ?? []).filter((p) => p.status !== 'disconnected');
  const needsAttention = list.some((p) => p.status === 'token_invalid');
  const empty = pages.data !== undefined && list.length === 0;
  const first = list[0];

  const add = () => {
    setOpen(false);
    setDialog(true);
  };

  return (
    <div ref={box} className="relative mb-1">
      <button
        type="button"
        aria-label={empty ? 'Thêm Page Facebook' : 'Page Facebook'}
        title={empty ? 'Kết nối Page đầu tiên' : 'Page Facebook'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`relative flex h-11 w-11 items-center justify-center rounded-[10px] text-sm font-bold ${empty ? 'border-2 border-dashed border-brand bg-brand-soft text-brand' : 'border-0 bg-brand text-white'}`}
      >
        {empty || !first ? '+' : first.name.trim().charAt(0).toUpperCase() || 'P'}
        {needsAttention ? <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-amber" /> : null}
      </button>

      {open ? (
        <div role="menu" aria-label="Page Facebook" className="absolute left-14 top-0 z-30 w-64 rounded-xl border border-line bg-white p-1.5 shadow-lg">
          {list.length > 0 ? (
            <>
              <div className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Page đã kết nối</div>
              <ul className="m-0 list-none p-0">
                {list.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                    <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${DOT[p.status]}`} />
                    <span className="min-w-0 grow truncate">{p.name}</span>
                    {p.status === 'token_invalid' ? <span className="flex-none text-xs text-amber">Cần kết nối lại</span> : null}
                  </li>
                ))}
              </ul>
              <div className="my-1 border-t border-line" />
            </>
          ) : null}
          <button type="button" role="menuitem" className={`${item} font-semibold text-brand`} disabled={blockReason !== null} onClick={add}>
            <span aria-hidden="true">+</span> {list.length > 0 ? 'Thêm Page' : 'Kết nối Page đầu tiên'}
          </button>
          {blockReason ? <p role="status" className="m-0 px-2.5 pb-1.5 text-xs text-ink-3">{blockReason}</p> : null}
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              setView('pages');
            }}
          >
            <span aria-hidden="true">⚙</span> Quản lý Page…
          </button>
        </div>
      ) : null}
      <ConnectPageDialog open={dialog} onClose={() => setDialog(false)} />
    </div>
  );
}
