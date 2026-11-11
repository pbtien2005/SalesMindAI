import { useState } from 'react';
import { formatTime } from '../api/format';
import { useDecide } from '../api/hooks';
import type { ConversationDetail } from '../api/types';
import { buildCardRows, type CardRow } from '../lib/card';
import { EvidenceQuote } from './EvidenceQuote';
import { ErrorBanner } from './ErrorBanner';
import { StatusChip } from './StatusChip';

const EDITABLE = new Set(['customer_name', 'product_interest', 'budget', 'quantity']);

/** Sale sửa giá trị AI điền sai: lưu là "Đã sửa và duyệt" (gọi decide với action edit). */
function EditAiValue({ row }: { row: CardRow }) {
  const decide = useDecide();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(row.text);
  if (!row.proposalId) return null;
  if (!open) {
    return (
      <button type="button" className="mt-1 h-7 rounded-md border border-line-strong bg-white px-2 text-xs" aria-label={`Sửa ${row.label}`} onClick={() => setOpen(true)}>
        Sửa
      </button>
    );
  }
  return (
    <form
      className="mt-1 flex flex-wrap items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() !== '') decide.mutate({ proposalId: row.proposalId!, body: { action: 'edit', editedText: text.trim() } }, { onSuccess: () => setOpen(false) });
      }}
    >
      <label htmlFor={`fix-${row.field}`} className="sr-only">Giá trị đã sửa của {row.label}</label>
      <input id={`fix-${row.field}`} name={`fix-${row.field}`} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-line-strong px-2 text-sm" />
      <button type="submit" disabled={decide.isPending || text.trim() === ''} className="h-8 rounded-md border-0 bg-brand px-2.5 text-xs font-semibold text-white disabled:opacity-50">Lưu và duyệt</button>
      <button type="button" className="h-8 rounded-md border border-line-strong bg-white px-2.5 text-xs" onClick={() => setOpen(false)}>Hủy</button>
      {decide.error ? <div className="w-full"><ErrorBanner error={decide.error} /></div> : null}
    </form>
  );
}

function StateChip({ row }: { row: CardRow }) {
  switch (row.state) {
    case 'approved':
      return (
        <StatusChip tone="green">
          {row.edited ? 'Đã sửa và duyệt' : 'Đã duyệt'} bởi {row.decidedBy ?? 'Sale'}
          {row.decidedAt ? `, ${formatTime(row.decidedAt)}` : ''}
        </StatusChip>
      );
    case 'ai':
      return <StatusChip tone="amber">AI điền, chưa duyệt</StatusChip>;
    case 'needs_date':
      return <StatusChip tone="red">Cần xác nhận</StatusChip>;
    case 'pending_review':
      return <StatusChip tone="amber">Chờ duyệt</StatusChip>;
    default:
      return <StatusChip tone="gray">Thiếu</StatusChip>;
  }
}

const EMPTY_TEXT: Record<CardRow['state'], string> = {
  approved: '',
  ai: '',
  pending_review: 'Chưa có, đang chờ duyệt đề xuất',
  needs_date: 'Chưa có ngày',
  missing: 'Chưa có',
};

export function CustomerCard({ detail, onJump }: { detail: ConversationDetail; onJump: (messageId: string) => void }) {
  const rows = buildCardRows(detail);
  return (
    <div className="flex flex-col gap-3 px-[18px] py-4">
      <h2 className="m-0 text-[15px] font-bold">Thẻ khách</h2>
      {rows.map((r) => (
        <div key={r.field}>
          <div className="text-xs text-ink-3">{r.label}</div>
          <div className="flex items-center justify-between gap-2">
            {r.text ? <span className="font-semibold">{r.text}</span> : <span className="text-[#5b6472]">{EMPTY_TEXT[r.state]}</span>}
            <StateChip row={r} />
          </div>
          {r.state === 'ai' && EDITABLE.has(r.field) ? <EditAiValue row={r} /> : null}
          {r.state === 'ai'
            ? r.evidence.map((e, i) => <EvidenceQuote key={`${e.messageId}-${e.start}-${i}`} evidence={e} messages={detail.messages} onJump={onJump} />)
            : null}
        </div>
      ))}
      {detail.tasks.length > 0 ? (
        <div>
          <div className="text-xs text-ink-3">Việc đang mở</div>
          <ul className="m-0 list-none p-0">
            {detail.tasks.map((t) => (
              <li key={t.id} className="text-sm font-semibold">
                {t.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-1 border-t border-dashed border-line-strong pt-2.5 text-xs text-ink-3">
        Mọi thông tin AI trích đều kèm câu gốc. Chỉ khi Sale duyệt, thông tin mới thành dữ liệu chính thức.
      </div>
    </div>
  );
}
