import type { ReactNode } from 'react';
import { daysOverdue, formatDateTime, formatWait } from '../api/format';
import { useHome } from '../api/hooks';
import type { HomeData, Reminder } from '../api/types';
import { useSession } from '../state/session';
import { ErrorBanner } from './ErrorBanner';
import { Main } from './Main';

type Accent = 'red' | 'amber' | 'blue';
const ACCENT: Record<Accent, { border: string; value: string }> = {
  red: { border: 'border-[#f1b7b0] border-t-p1', value: 'text-p1' },
  amber: { border: 'border-line border-t-amber', value: 'text-[#9a4a00]' },
  blue: { border: 'border-line border-t-brand', value: 'text-brand' },
};

function StatCard({ accent, label, value, detail, action, onOpen }: { accent: Accent; label: string; value: number; detail: string; action?: ReactNode; onOpen?: () => void }) {
  const a = ACCENT[accent];
  const body = (
    <>
      <div className="text-[13px] text-ink-3">{label}</div>
      <div className={`text-[34px] font-bold leading-[1.2] tabular-nums ${a.value}`}>{value}</div>
      <div className="text-[13px] text-ink-2">{detail}</div>
    </>
  );
  return (
    <div className={`rounded-xl border border-t-4 bg-white p-4 ${a.border}`}>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label={`${label}: ${value}, bấm để xem danh sách`} className="block w-full border-0 bg-transparent p-0 text-left">
          {body}
        </button>
      ) : (
        body
      )}
      {action}
    </div>
  );
}

/** Tiền cọc nằm ngoài phạm vi demo này (cần đọc bill và đơn hàng). */
function DepositPlaceholder() {
  return (
    <div className="rounded-xl border border-dashed border-[#aeb8c6] bg-white p-4">
      <div className="text-[13px] text-ink-3">Tiền cọc hôm nay</div>
      <div className="text-xl font-bold leading-[1.8] text-[#5b6472]">Sắp có</div>
      <div className="text-[13px] text-ink-3">Cần đọc bill và đơn hàng, chưa nằm trong bản demo này</div>
    </div>
  );
}

const DOT = { overdue: 'bg-p1', followup: 'bg-amber', upcoming: 'bg-brand' } as const;
const BADGE = {
  overdue: 'bg-p1-soft text-[#7a1b12]',
  followup: 'bg-amber-soft text-amber-ink',
  upcoming: 'bg-brand-soft text-[#1e3a8a]',
} as const;

function ReminderRow({ r, now, suggestStop, onOpen }: { r: Reminder; now: string; suggestStop: boolean; onOpen: (id: string) => void }) {
  let sub = '';
  let badge = '';
  if (r.kind === 'overdue' && r.dueAt) {
    const d = daysOverdue(r.dueAt, now);
    sub = `Hạn ${formatDateTime(r.dueAt)}`;
    badge = d >= 1 ? `Quá hạn ${d} ngày` : 'Quá hạn hôm nay';
  } else if (r.kind === 'followup') {
    sub = suggestStop ? 'Đủ số lần bám, hệ thống đề xuất ngừng bám (Sale xác nhận)' : 'Khách chưa phản hồi, cần bám lại';
    badge = r.title;
  } else if (r.dueAt) {
    sub = formatDateTime(r.dueAt);
    badge = 'Sắp tới';
  }

  return (
    <li className="border-b border-[#eef1f5] last:border-b-0">
      <button type="button" onClick={() => onOpen(r.conversationId)} className="flex w-full items-center gap-3 border-0 bg-transparent px-0 py-2.5 text-left hover:bg-[#f7f9fb]">
        <span aria-hidden="true" className={`h-2.5 w-2.5 flex-none rounded-full ${DOT[r.kind]}`} />
        <span className="grow">
          <span className="block font-semibold">{r.kind === 'followup' ? `${r.displayName}: bám lại khách` : `${r.displayName}: ${r.title}`}</span>
          <span className="block text-xs text-ink-3">{sub}</span>
        </span>
        <span className={`rounded-full px-2 py-[3px] text-xs font-semibold ${BADGE[r.kind]}`}>{badge}</span>
      </button>
    </li>
  );
}

function AiStatsBlock({ ai }: { ai: HomeData['ai'] }) {
  const items = [
    { label: 'Trường AI tự điền', value: ai.autoFilled },
    { label: 'Lần Sale phải sửa', value: ai.saleEdited },
    { label: 'Mốc hẹn AI hỏi lại ngày', value: ai.askedDate },
    { label: 'Đề xuất đã được duyệt', value: ai.approved },
  ];
  return (
    <section aria-label="Số liệu AI" className="rounded-xl border border-line bg-white p-4">
      <h2 className="m-0 mb-2.5 text-[15px] font-bold">AI đã làm gì</h2>
      <dl className="m-0 grid grid-cols-4 gap-3.5">
        {items.map((it) => (
          <div key={it.label}>
            <dd className="m-0 text-2xl font-bold tabular-nums text-ink">{it.value}</dd>
            <dt className="text-xs text-ink-3">{it.label}</dt>
          </div>
        ))}
      </dl>
      <p className="m-0 mt-2.5 text-xs text-ink-3">AI chỉ đề xuất, mọi thông tin quan trọng do Sale quyết định. Số liệu tính trực tiếp từ dữ liệu hiện có.</p>
    </section>
  );
}

/** Trang chủ quản lý (cảnh 0 và 6). */
export function HomeView() {
  const home = useHome();
  const { me, role, openConversation, setView } = useSession();

  if (home.error) {
    return (
      <Main className="p-6">
        <ErrorBanner error={home.error} />
      </Main>
    );
  }
  const h = home.data;
  if (!h) return <Main className="p-6 text-ink-3">Đang tải trang chủ…</Main>;

  const overdueNames = [...new Set(h.overdue.map((t) => t.displayName))];
  const upcoming = h.reminders.filter((r) => r.kind === 'upcoming').length;
  const following = h.reminders.filter((r) => r.kind === 'followup').length;
  const stopIds = new Set(h.suggestStop.map((s) => s.id));
  const first = h.p1[0];

  return (
    <Main className="flex flex-col gap-[18px] overflow-auto px-7 py-6">
      <div className="flex items-baseline gap-3">
        <h1 className="m-0 text-[22px] font-bold">{role === 'sale' ? `Trang chủ của ${me.displayName}` : `Trang chủ, đội của ${me.displayName}`}</h1>
        <span className="text-ink-3">{formatDateTime(h.now)}</span>
      </div>

      <div className="grid grid-cols-4 gap-3.5">
        <StatCard
          accent="red"
          label="Khách ưu tiên P1"
          value={h.p1.length}
          detail={h.p1.length === 0 ? 'Không có khách nào chờ quá lâu' : h.p1.map((c) => `${c.displayName}${c.waitingMinutes !== null ? `, chờ ${formatWait(c.waitingMinutes)}` : ''}`).join('; ')}
          action={
            first ? (
              <button type="button" onClick={() => openConversation(first.id)} className="mt-2 border-0 bg-transparent p-0 text-[13px] font-semibold text-brand underline">
                Mở hội thoại
              </button>
            ) : null
          }
        />
        <StatCard accent="amber" label="Việc quá hạn" value={h.overdue.length} detail={h.overdue.length === 0 ? 'Không có việc quá hạn' : overdueNames.join(', ')} onOpen={() => setView('overdue')} />
        <StatCard
          accent="blue"
          label="Lịch nhắc sắp tới"
          value={upcoming + following}
          detail={upcoming + following === 0 ? 'Chưa có lịch nhắc' : `${upcoming} việc sắp đến hạn, ${following} khách đang được bám`}
        />
        <DepositPlaceholder />
      </div>

      <section aria-label="Việc quá hạn và lịch nhắc" className="rounded-xl border border-line bg-white p-4">
        <h2 className="m-0 mb-2.5 text-[15px] font-bold">Việc quá hạn và lịch nhắc</h2>
        {h.reminders.length === 0 ? (
          <p className="m-0 text-sm text-ink-3">Không có việc nào cần nhắc.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {h.reminders.map((r, i) => (
              <ReminderRow key={`${r.kind}-${r.conversationId}-${r.dueAt ?? i}-${i}`} r={r} now={h.now} suggestStop={stopIds.has(r.conversationId)} onOpen={openConversation} />
            ))}
          </ul>
        )}
      </section>

      <AiStatsBlock ai={h.ai} />
    </Main>
  );
}
