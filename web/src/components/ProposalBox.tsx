import { useState, type ReactNode } from 'react';
import { formatDateTime, nextWeekendPicks, toIsoWithOffset } from '../api/format';
import { useDecide, useStopFollowup } from '../api/hooks';
import { NEEDS_CLARIFICATION, type BoxItem, type DecideBody, type MessageView, type ProposalView } from '../api/types';
import { fieldLabel } from '../lib/fields';
import { ErrorBanner } from './ErrorBanner';
import { EvidenceQuote } from './EvidenceQuote';

const primary = 'h-[34px] flex-1 rounded-lg border-0 bg-brand font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2';
const secondary = 'h-[34px] rounded-lg border border-line-strong bg-white px-3 disabled:opacity-50';

type ProposalItem = Extract<BoxItem, { kind: 'proposal' }>;

function Card({ title, tone = 'plain', children }: { title: string; tone?: 'plain' | 'warn'; children: ReactNode }) {
  return (
    <section aria-label={title} className={`mb-2.5 rounded-[10px] border p-3 ${tone === 'warn' ? 'border-[#e0a33a] bg-[#fffaee]' : 'border-line-strong bg-white'}`}>
      {children}
    </section>
  );
}

function Evidences({ p, messages, onJump }: { p: ProposalView; messages: MessageView[]; onJump: (id: string) => void }) {
  return (
    <>
      {p.evidence.map((e, i) => (
        <EvidenceQuote key={`${e.messageId}-${e.start}-${i}`} evidence={e} messages={messages} onJump={onJump} />
      ))}
    </>
  );
}

/** Duyệt / Sửa / Bỏ qua cho SĐT và địa chỉ. */
function TextProposal({ p, messages, onJump }: { p: ProposalItem; messages: MessageView[]; onJump: (id: string) => void }) {
  const decide = useDecide();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.value.text);
  const send = (body: DecideBody) => decide.mutate({ proposalId: p.id, body });
  const label = fieldLabel(p.field);

  return (
    <Card title={`Đề xuất: ${label}`}>
      <div className="text-xs text-ink-3">{label}</div>
      {editing ? (
        <div className="my-1">
          <label htmlFor={`edit-${p.id}`} className="sr-only">
            Giá trị đã sửa của {label}
          </label>
          <input id={`edit-${p.id}`} value={text} onChange={(e) => setText(e.target.value)} className="h-9 w-full rounded-lg border border-line-strong px-2 text-sm" />
        </div>
      ) : (
        <div className="my-0.5 text-[17px] font-bold">{p.value.text}</div>
      )}
      <Evidences p={p} messages={messages} onJump={onJump} />
      {p.field === 'phone' ? <div className="mt-1.5 text-xs font-semibold text-ok">Hệ thống đã kiểm tra định dạng số di động Việt Nam</div> : null}
      <div className="mt-2.5 flex gap-1.5">
        {editing ? (
          <>
            <button type="button" className={primary} disabled={decide.isPending || text.trim() === ''} onClick={() => send({ action: 'edit', editedText: text.trim() })}>
              Lưu và duyệt
            </button>
            <button type="button" className={secondary} onClick={() => setEditing(false)}>
              Hủy
            </button>
          </>
        ) : (
          <>
            <button type="button" className={primary} disabled={decide.isPending} onClick={() => send({ action: 'accept' })}>
              Duyệt
            </button>
            <button type="button" className={secondary} disabled={decide.isPending} onClick={() => setEditing(true)}>
              Sửa
            </button>
            <button type="button" className={secondary} disabled={decide.isPending} onClick={() => send({ action: 'dismiss' })}>
              Bỏ qua
            </button>
          </>
        )}
      </div>
      {decide.error ? <div className="mt-2"><ErrorBanner error={decide.error} /></div> : null}
    </Card>
  );
}

/**
 * Mốc hẹn. Nếu có cờ `needs_clarification` (cụm mơ hồ như "cuối tuần này") thì Sale BẮT BUỘC chọn ngày:
 * ô chọn để trống, nút Duyệt khóa cho tới khi chọn, và không có đường nào tự điền ngày.
 */
function TimelineProposal({ p, messages, onJump }: { p: ProposalItem; messages: MessageView[]; onJump: (id: string) => void }) {
  const decide = useDecide();
  const needsDate = p.flags.includes(NEEDS_CLARIFICATION);
  const [local, setLocal] = useState(''); // luôn bắt đầu rỗng
  const chosenAt = toIsoWithOffset(local);
  const canAccept = !decide.isPending && (!needsDate || chosenAt !== null);
  const picks = p.value.sentAt ? nextWeekendPicks(p.value.sentAt) : [];

  const accept = () => {
    if (!canAccept) return;
    decide.mutate({ proposalId: p.id, body: needsDate && chosenAt ? { action: 'accept', chosenAt } : { action: 'accept' } });
  };

  return (
    <Card title="Đề xuất: Mốc hẹn" tone={needsDate ? 'warn' : 'plain'}>
      <div className={`text-xs font-semibold ${needsDate ? 'text-amber-ink' : 'text-ink-3'}`}>{needsDate ? 'Mốc hẹn: cần xác nhận ngày' : 'Mốc hẹn'}</div>
      <div className="my-0.5 text-[17px] font-bold">“{p.value.text}”</div>
      <Evidences p={p} messages={messages} onJump={onJump} />
      {needsDate ? (
        <>
          <div className="mt-1.5 rounded-md border border-[#f0ddb5] bg-white px-2 py-1.5 text-xs text-ink-2">
            {p.value.sentAt ? `Khách nhắn ${formatDateTime(p.value.sentAt)}. ` : ''}AI không tự suy ra ngày. Hãy chọn ngày giờ khách hẹn:
          </div>
          <label htmlFor={`dt-${p.id}`} className="mt-2 block text-xs text-ink-3">
            Ngày giờ hẹn
          </label>
          <input
            id={`dt-${p.id}`}
            type="datetime-local"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            className="mt-0.5 box-border h-9 w-full rounded-lg border border-line-strong px-2 text-sm"
          />
          {picks.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-ink-3">Chọn nhanh:</span>
              {picks.map((d) => (
                <button key={d.local} type="button" onClick={() => setLocal(d.local)} className="h-7 rounded-full border border-line-strong bg-white px-2.5 text-xs">
                  {d.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      <div className="mt-2.5 flex gap-1.5">
        <button type="button" className={primary} disabled={!canAccept} onClick={accept}>
          {needsDate && chosenAt === null ? 'Duyệt (chọn ngày trước)' : 'Duyệt'}
        </button>
        <button type="button" className={secondary} disabled={decide.isPending} onClick={() => decide.mutate({ proposalId: p.id, body: { action: 'dismiss' } })}>
          Bỏ qua
        </button>
      </div>
      {decide.error ? <div className="mt-2"><ErrorBanner error={decide.error} /></div> : null}
    </Card>
  );
}

function StopFollowupProposal({ conversationId, item }: { conversationId: string; item: Extract<BoxItem, { kind: 'stop_followup' }> }) {
  const stop = useStopFollowup();
  return (
    <Card title="Đề xuất: Ngừng bám" tone="warn">
      <div className="text-xs font-semibold text-amber-ink">AI đề xuất: Ngừng bám</div>
      <div className="my-0.5 text-sm font-semibold">
        Đã bám {item.count}/{item.max} lần
      </div>
      <div className="text-xs text-ink-2">{item.reason}</div>
      <div className="mt-1 text-xs text-ink-3">Hệ thống chỉ đề xuất, việc bỏ bám do Sale xác nhận.</div>
      <div className="mt-2.5 flex gap-1.5">
        <button type="button" className={primary} disabled={stop.isPending} onClick={() => stop.mutate(conversationId)}>
          Xác nhận ngừng bám
        </button>
      </div>
      {stop.error ? <div className="mt-2"><ErrorBanner error={stop.error} /></div> : null}
    </Card>
  );
}

export function ProposalBox({ conversationId, items, messages, onJump }: { conversationId: string; items: BoxItem[]; messages: MessageView[]; onJump: (messageId: string) => void }) {
  return (
    <div className="border-b border-[#eef1f5] px-[18px] py-4">
      <div className="mb-2.5 flex items-center text-[15px] font-bold">
        Hộp đề xuất
        {items.length > 0 ? <span className="ml-1.5 rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber-ink">{items.length} chờ duyệt</span> : null}
      </div>
      {items.length === 0 ? <p className="m-0 text-sm text-ink-3">Chưa có đề xuất nào cần duyệt.</p> : null}
      {items.map((it) => {
        if (it.kind === 'stop_followup') return <StopFollowupProposal key="stop" conversationId={conversationId} item={it} />;
        return it.field === 'timeline' ? (
          <TimelineProposal key={it.id} p={it} messages={messages} onJump={onJump} />
        ) : (
          <TextProposal key={it.id} p={it} messages={messages} onJump={onJump} />
        );
      })}
    </div>
  );
}
