import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatDay, formatTime, formatWait } from '../api/format';
import { usePageMessage, useSendMessage, useStopFollowup } from '../api/hooks';
import type { ConversationDetail, MessageView } from '../api/types';
import { useSession } from '../state/session';
import { allEvidence } from '../lib/card';
import { segmentText } from '../lib/evidence';
import { initial, senderLabel } from '../lib/fields';
import { ErrorBanner } from './ErrorBanner';
import { StatusChip } from './StatusChip';

const KIND_LABEL: Record<string, string> = { image: 'Ảnh', video: 'Video', audio: 'Âm thanh', file: 'Tệp', other: 'Tệp đính kèm' };

/** Ảnh hiện trực tiếp (URL đã được server lọc theo máy chủ của Facebook); loại khác hiện liên kết mở tab mới. */
function Attachments({ items, hasText }: { items: NonNullable<MessageView['attachments']>; hasText: boolean }) {
  if (items.length === 0) return <span className={hasText ? 'ml-1 opacity-80' : ''}>[Tệp đính kèm]</span>;
  return (
    <div className={`flex flex-col gap-1.5 ${hasText ? 'mt-2' : ''}`}>
      {items.map((a, i) =>
        a.type === 'image' && a.url ? (
          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer">
            <img src={a.url} alt="Ảnh khách gửi" loading="lazy" referrerPolicy="no-referrer" className="max-h-64 max-w-full rounded-lg" />
          </a>
        ) : a.url ? (
          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="underline">
            [{KIND_LABEL[a.type]}]
          </a>
        ) : (
          <span key={i} className="opacity-80">[{KIND_LABEL[a.type]}]</span>
        ),
      )}
    </div>
  );
}

function Bubble({ m, ranges, flash }: { m: MessageView; ranges: ReturnType<typeof allEvidence>; flash: boolean }) {
  const inbound = m.direction === 'inbound';
  // Chỉ tô câu gốc trong tin của khách: tin của Page không bao giờ là căn cứ.
  const parts = inbound && m.text ? segmentText(m.text, ranges.filter((e) => e.messageId === m.id)) : null;
  const label = inbound ? '' : senderLabel(m.senderKind);

  return (
    <div id={`msg-${m.id}`} className={`max-w-[68%] ${inbound ? 'self-start' : 'self-end text-right'}`}>
      <div
        className={`rounded-[14px] px-3.5 py-2.5 text-left leading-[1.45] ${inbound ? 'rounded-bl-[4px] border border-line bg-white' : 'rounded-br-[4px] bg-brand text-white'} ${flash ? 'outline outline-2 outline-offset-2 outline-amber' : ''}`}
      >
        {parts
          ? parts.map((p, i) =>
              p.mark ? (
                <mark key={i} className="rounded-[3px] bg-[#ffe58a] px-0.5 text-ink">
                  {p.text}
                </mark>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )
          : (m.text ?? '')}
        {m.hasAttachment ? <Attachments items={m.attachments ?? []} hasText={Boolean(m.text)} /> : null}
      </div>
      <div className="mt-[3px] text-[11px] text-ink-3">
        {label ? <span className="mr-1 rounded bg-chip px-1.5 py-px font-semibold text-ink-2">{label}</span> : null}
        {inbound ? 'Khách' : 'Page'}, {formatTime(m.sentAt)}
      </div>
    </div>
  );
}

export function ChatPane({ detail, flashId }: { detail: ConversationDetail; flashId: string | null }) {
  const demo = useSession().me.demoTenant;
  const { summary, messages } = detail;
  const stop = useStopFollowup();
  const send = usePageMessage();
  const realSend = useSendMessage();
  const [draft, setDraft] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const ranges = useMemo(() => allEvidence(detail), [detail]);

  // Cuộn xuống tin mới nhất khi đổi hội thoại hoặc có tin mới.
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [summary.id, lastId]);

  // Cuộn tới tin được trỏ từ thẻ khách.
  useEffect(() => {
    if (flashId) document.getElementById(`msg-${flashId}`)?.scrollIntoView?.({ block: 'center' });
  }, [flashId]);

  const f = summary.followup;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text === '' || send.isPending || realSend.isPending) return;
    if (demo) send.mutate({ conversationId: summary.id, text }, { onSuccess: () => setDraft('') });
    else realSend.mutate({ conversationId: summary.id, text }, { onSuccess: () => setDraft('') });
  };

  let subtitle = 'Chưa có tin nhắn';
  if (summary.waitingOn === 'page') subtitle = `Khách nhắn${summary.lastMessageAt ? ` lúc ${formatTime(summary.lastMessageAt)}` : ''}, chưa được trả lời`;
  else if (summary.waitingOn === 'customer') subtitle = 'Page đã trả lời, đang chờ khách phản hồi';

  const rows: Array<{ kind: 'day'; key: string; label: string } | { kind: 'msg'; m: MessageView }> = [];
  let lastDay = '';
  for (const m of messages) {
    const d = formatDay(m.sentAt);
    if (d !== lastDay) {
      rows.push({ kind: 'day', key: `${d}-${m.id}`, label: d });
      lastDay = d;
    }
    rows.push({ kind: 'msg', m });
  }

  return (
    <section aria-label="Cuộc trò chuyện" className="flex min-w-[420px] flex-1 basis-0 flex-col bg-[#f7f9fb]">
      <div className="flex h-[60px] flex-none items-center gap-3 border-b border-line bg-white px-[18px]">
        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#b9ccf7] font-bold text-[#1e3a8a]">
          {initial(summary.displayName)}
        </span>
        <div>
          <h2 className="m-0 text-sm font-semibold">{summary.displayName}</h2>
          <div className="text-xs text-ink-3">{subtitle}</div>
        </div>
        <div className="grow" />
        {f.stopped ? (
          <StatusChip tone="gray">Đã ngừng bám</StatusChip>
        ) : f.due ? (
          <span className="rounded-full bg-amber-soft px-2.5 py-1 text-xs font-semibold text-amber-ink">
            Đến hạn bám lần {f.count + 1}/{f.max}
          </span>
        ) : f.count > 0 ? (
          <span className="rounded-full bg-chip px-2.5 py-1 text-xs text-ink-2">
            Bám {f.count}/{f.max}
          </span>
        ) : null}
        {(f.count > 0 || f.due) && !f.stopped ? (
          confirmStop ? (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-ink-3">Ngừng bám khách này?</span>
              <button
                type="button"
                disabled={stop.isPending}
                onClick={() => stop.mutate(summary.id, { onSettled: () => setConfirmStop(false) })}
                className="h-[34px] rounded-lg border-0 bg-brand px-3 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                Xác nhận ngừng bám
              </button>
              <button type="button" onClick={() => setConfirmStop(false)} className="h-[34px] rounded-lg border border-line-strong bg-white px-3 text-[13px]">
                Hủy
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmStop(true)} className="h-[34px] rounded-lg border border-line-strong bg-white px-3 text-[13px]">
              Ngừng bám
            </button>
          )
        ) : null}
      </div>
      {stop.error ? (
        <div className="px-4 pt-3">
          <ErrorBanner error={stop.error} />
        </div>
      ) : null}

      <div ref={scroller} className="flex grow flex-col gap-3.5 overflow-auto px-6 py-5">
        {messages.length === 0 ? <p className="m-auto text-ink-3">Hội thoại chưa có tin nhắn.</p> : null}
        {rows.map((r) =>
          r.kind === 'day' ? (
            <div key={r.key} className="self-center text-xs text-ink-3">
              {r.label}
            </div>
          ) : (
            <Bubble key={r.m.id} m={r.m} ranges={ranges} flash={r.m.id === flashId} />
          ),
        )}
        {summary.waitingOn === 'page' && summary.waitingMinutes !== null ? (
          <div role="status" className="self-center rounded-full bg-chip px-2.5 py-[3px] text-xs text-ink-2">
            Chưa ai trả lời {formatWait(summary.waitingMinutes)}
          </div>
        ) : null}
      </div>

      <form onSubmit={submit} className="flex flex-none flex-col gap-2 border-t border-line bg-white px-[18px] py-3">
        {demo ? (
          <>
            <div className="text-xs text-ink-3">
              Demo: tin gõ ở đây được giả lập như Lan trả lời ở Page Inbox. SalesMind AI không gửi tin thật cho khách.
            </div>
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="page-msg">
                Tin trả lời của Lan (giả lập Page Inbox)
              </label>
              <input
                id="page-msg"
                name="page-message"
                autoComplete="off"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Gõ tin trả lời như ở Page Inbox…"
                className="h-[42px] grow rounded-lg border border-line-strong px-3 text-sm"
              />
              <button type="submit" disabled={draft.trim() === '' || send.isPending} className="h-[42px] rounded-lg border-0 bg-brand px-[18px] font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2">
                Gửi (giả lập)
              </button>
            </div>
            {send.error ? <ErrorBanner error={send.error} /> : null}
          </>
        ) : !detail.reply.pageActive ? (
          <div role="alert" className="text-sm text-amber">Page này cần được kết nối lại (nút Page ở đầu thanh bên, mục Quản lý Page) trước khi gửi tin.</div>
        ) : !detail.reply.open ? (
          <div role="status" className="text-sm text-ink-2">
            Đã quá 24 giờ kể từ tin cuối của khách, Facebook không cho gửi tin chủ động. Hãy chờ khách nhắn lại, hoặc trả lời bằng công cụ khác của Page.
          </div>
        ) : (
          <>
            {detail.reply.closesAt ? (
              <div className="text-xs text-ink-3">Còn đến {formatTime(detail.reply.closesAt)} {formatDay(detail.reply.closesAt)} để trả lời khách này. Tin gửi đi là tin thật tới Messenger của khách.</div>
            ) : null}
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="real-msg">
                Tin trả lời cho khách
              </label>
              <input
                id="real-msg"
                name="reply"
                autoComplete="off"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={1000}
                placeholder="Gõ tin trả lời cho khách…"
                className="h-[42px] grow rounded-lg border border-line-strong px-3 text-sm"
              />
              <button type="submit" disabled={draft.trim() === '' || realSend.isPending} className="h-[42px] rounded-lg border-0 bg-brand px-[18px] font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2">
                Gửi
              </button>
            </div>
            {realSend.error ? <ErrorBanner error={realSend.error} /> : null}
          </>
        )}
      </form>
    </section>
  );
}
