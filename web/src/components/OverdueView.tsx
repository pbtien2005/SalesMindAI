import { daysOverdue, formatDateTime } from '../api/format';
import { useOverdue } from '../api/hooks';
import { useSession } from '../state/session';
import { ErrorBanner } from './ErrorBanner';
import { Main } from './Main';

/** Danh sách việc quá hạn (mở từ thẻ "Việc quá hạn" ở Trang chủ). */
export function OverdueView() {
  const q = useOverdue();
  const { openConversation, setView } = useSession();
  const items = q.data?.overdue ?? [];
  return (
    <Main title="Việc quá hạn" className="overflow-auto bg-canvas">
      <div className="mx-auto flex max-w-[760px] flex-col gap-4 p-6">
        <div className="flex items-center gap-3">
          <h1 className="m-0 grow text-[22px] font-bold">Việc quá hạn</h1>
          <button type="button" onClick={() => setView('home')} className="h-9 rounded-lg border border-line-strong bg-white px-3 text-sm">
            Về Trang chủ
          </button>
        </div>
        {q.error ? <ErrorBanner error={q.error} /> : null}
        {q.data && items.length === 0 ? <p className="text-ink-3">Không có việc quá hạn.</p> : null}
        <ul className="m-0 flex list-none flex-col rounded-xl border border-line bg-white p-0">
          {items.map((t) => (
            <li key={t.taskId} className="border-b border-[#eef1f5] last:border-b-0">
              <button type="button" onClick={() => openConversation(t.conversationId)} className="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 text-left hover:bg-[#f7f9fb]">
                <span className="grow">
                  <span className="block font-semibold">{t.displayName}</span>
                  <span className="block text-sm text-ink-2">{t.title}</span>
                  <span className="block text-xs text-ink-3">Hạn {formatDateTime(t.dueAt)}</span>
                </span>
                <span className="rounded-full bg-p1-soft px-2 py-[3px] text-xs font-semibold text-[#7a1b12]">{label(t.dueAt, q.data?.now)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Main>
  );
}

function label(dueAt: string, now: string | undefined): string {
  if (!now) return 'Quá hạn';
  const d = daysOverdue(dueAt, now);
  return d >= 1 ? `Quá hạn ${d} ngày` : 'Quá hạn hôm nay';
}
