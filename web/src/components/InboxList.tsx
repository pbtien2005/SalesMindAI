import { useMemo, useState } from 'react';
import { formatInboxTime, formatWait } from '../api/format';
import type { ConversationSummary } from '../api/types';
import { initial } from '../lib/fields';
import { StatusChip } from './StatusChip';

type Filter = 'all' | 'unanswered' | 'p1';

/** Bỏ dấu và hạ chữ thường để tìm "duc" ra "Anh Đức". */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

function Item({ c, now, selected, onSelect }: { c: ConversationSummary; now: string; selected: boolean; onSelect: (id: string) => void }) {
  const waitingForPage = c.waitingOn === 'page';
  const f = c.followup;
  const base = selected ? 'bg-[#eaf0ff] border-l-brand' : c.isP1 ? 'bg-p1-bg border-l-p1' : 'bg-white border-l-transparent hover:bg-[#f7f9fb]';

  return (
    <button
      type="button"
      onClick={() => onSelect(c.id)}
      aria-current={selected ? 'true' : undefined}
      className={`flex w-full gap-2.5 border-0 border-b border-l-[3px] border-b-[#eef1f5] px-3.5 py-3 text-left ${base}`}
    >
      <span
        aria-hidden="true"
        className={`flex h-10 w-10 flex-none items-center justify-center rounded-full font-bold ${c.isP1 ? 'bg-[#f3b6b0] text-[#7a1b12]' : selected ? 'bg-[#b9ccf7] text-[#1e3a8a]' : 'bg-[#d9dee6] text-[#2b3544]'}`}
      >
        {initial(c.displayName)}
      </span>
      <span className="min-w-0 grow">
        <span className="flex justify-between gap-2">
          <span className="truncate font-semibold">{c.displayName}</span>
          {waitingForPage && c.waitingMinutes !== null ? (
            <span className={`flex-none text-xs ${c.isP1 ? 'font-semibold text-p1' : 'text-ink-3'}`}>chờ {formatWait(c.waitingMinutes)}</span>
          ) : c.lastMessageAt ? (
            <span className="flex-none text-xs text-ink-3">{formatInboxTime(c.lastMessageAt, now)}</span>
          ) : null}
        </span>
        <span className="block truncate text-[13px] text-ink-2">{c.lastMessageText ?? 'Chưa có tin nhắn'}</span>
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {c.isP1 ? <StatusChip tone="p1">P1</StatusChip> : null}
          {c.isNew ? <StatusChip tone="blue">Mới</StatusChip> : null}
          {f.suggestStop ? (
            <StatusChip tone="amber">
              Bám {f.count}/{f.max}, đề xuất ngừng
            </StatusChip>
          ) : f.stopped ? (
            <StatusChip tone="gray">Đã ngừng bám</StatusChip>
          ) : f.count > 0 ? (
            <StatusChip tone="gray">
              Bám {f.count}/{f.max}
            </StatusChip>
          ) : null}
        </span>
      </span>
    </button>
  );
}

export function InboxList({
  conversations,
  now,
  selectedId,
  onSelect,
}: {
  conversations: ConversationSummary[];
  now: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(
    () => ({
      all: conversations.length,
      unanswered: conversations.filter((c) => c.waitingOn === 'page').length,
      p1: conversations.filter((c) => c.isP1).length,
    }),
    [conversations],
  );

  const shown = useMemo(() => {
    const q = norm(query.trim());
    return conversations.filter((c) => {
      if (filter === 'unanswered' && c.waitingOn !== 'page') return false;
      if (filter === 'p1' && !c.isP1) return false;
      return q === '' || norm(c.displayName).includes(q);
    });
  }, [conversations, filter, query]);

  const tab = (key: Filter, label: string, n: number, danger = false) => {
    const active = filter === key;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={active}
        onClick={() => setFilter(key)}
        className={`h-[30px] rounded-full border px-3 text-[13px] ${active ? 'border-brand bg-brand font-medium text-white' : `border-line-strong bg-white ${danger ? 'font-semibold text-p1' : 'text-ink'}`}`}
      >
        {label} {n}
      </button>
    );
  };

  return (
    <section aria-label="Danh sách hội thoại" className="flex w-[340px] flex-none flex-col border-r border-line bg-white">
      <div className="flex flex-col gap-2.5 px-3.5 pb-2 pt-3.5">
        <label className="flex h-[38px] items-center gap-2 rounded-lg border border-line-strong px-2.5 text-ink-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <span className="sr-only">Tìm khách</span>
          <input
            type="search"
            name="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo tên khách…"
            className="grow border-0 bg-transparent text-sm text-ink outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {tab('all', 'Tất cả', counts.all)}
          {tab('unanswered', 'Chưa trả lời', counts.unanswered)}
          {tab('p1', 'Ưu tiên P1', counts.p1, true)}
        </div>
      </div>
      <div className="grow overflow-auto">
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-3">{conversations.length === 0 ? 'Chưa có hội thoại nào.' : 'Không có hội thoại khớp.'}</p>
        ) : (
          shown.map((c) => <Item key={c.id} c={c} now={now} selected={c.id === selectedId} onSelect={onSelect} />)
        )}
      </div>
    </section>
  );
}
