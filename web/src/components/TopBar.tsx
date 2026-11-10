import { useState } from 'react';
import { formatDateTime } from '../api/format';
import { useAdvanceClock, useNow, useResetDemo } from '../api/hooks';
import type { Role } from '../api/types';
import { useSession } from '../state/session';

const ROLES: Array<{ key: Role; label: string }> = [
  { key: 'lan', label: 'Lan (Sale)' },
  { key: 'ha', label: 'Chị Hà (Quản lý)' },
];

const clockBtn =
  'h-8 rounded-lg border border-navy-line bg-transparent px-3 text-white hover:bg-navy-2 disabled:opacity-50';

export function TopBar() {
  const { role, setRole, simulatorOpen, toggleSimulator } = useSession();
  const now = useNow();
  const advance = useAdvanceClock();
  const reset = useResetDemo();
  const [confirmReset, setConfirmReset] = useState(false);

  const busy = advance.isPending || reset.isPending;
  const failure = advance.error ?? reset.error;

  return (
    <header className="flex h-[52px] flex-none items-center gap-4 bg-navy px-5 text-white">
      <div className="text-base font-bold tracking-tight">SalesMind AI</div>
      <div className="rounded-full bg-navy-2 px-2.5 py-1 text-xs text-navy-text">Chế độ demo, không có đăng nhập</div>

      <div className="grow" />

      {failure ? (
        <span role="alert" className="max-w-xs truncate text-xs text-amber-soft" title={failure.message}>
          {failure.message}
        </span>
      ) : null}

      <div className="flex items-center gap-2">
        <span className="text-xs text-navy-text" id="clock-label">
          Đồng hồ demo
        </span>
        <span aria-labelledby="clock-label" className="min-w-[10.5rem] rounded-lg bg-navy-2 px-3 py-1.5 text-center font-semibold tabular-nums">
          {now.data ? formatDateTime(now.data.now) : '…'}
        </span>
        <button type="button" className={clockBtn} disabled={busy} onClick={() => advance.mutate(60)}>
          +1 giờ
        </button>
        <button type="button" className={clockBtn} disabled={busy} onClick={() => advance.mutate(24 * 60)}>
          +24 giờ
        </button>

        {confirmReset ? (
          <span className="flex items-center gap-1.5">
            <span className="text-xs text-navy-text">Xóa dữ liệu demo?</span>
            <button
              type="button"
              className="h-8 rounded-lg bg-amber px-3 font-semibold text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => reset.mutate(undefined, { onSettled: () => setConfirmReset(false) })}
            >
              Đặt lại
            </button>
            <button type="button" className={clockBtn} onClick={() => setConfirmReset(false)}>
              Hủy
            </button>
          </span>
        ) : (
          <button type="button" className={clockBtn} disabled={busy} onClick={() => setConfirmReset(true)}>
            Đặt lại demo
          </button>
        )}
      </div>

      <div className="h-6 w-px bg-navy-line" aria-hidden="true" />

      <button
        type="button"
        aria-expanded={simulatorOpen}
        aria-controls="simulator-panel"
        onClick={toggleSimulator}
        className={`h-8 rounded-lg border px-3 ${simulatorOpen ? 'border-white bg-white font-semibold text-navy' : 'border-navy-line bg-transparent text-white hover:bg-navy-2'}`}
      >
        Giả lập
      </button>

      <div role="group" aria-label="Vai trò" className="flex rounded-lg bg-navy-2 p-[3px]">
        {ROLES.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-pressed={role === r.key}
            onClick={() => setRole(r.key)}
            className={
              role === r.key
                ? 'h-[30px] rounded-md border-0 bg-white px-3.5 font-semibold text-navy'
                : 'h-[30px] rounded-md border-0 bg-transparent px-3.5 text-[#dce4f0] hover:bg-navy-line/40'
            }
          >
            {r.label}
          </button>
        ))}
      </div>
    </header>
  );
}
