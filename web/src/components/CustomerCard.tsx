import { useState } from 'react';
import { formatTime } from '../api/format';
import { useDecide, useSetCustomerStatus } from '../api/hooks';
import type { ConversationDetail, ConversationSummary } from '../api/types';
import { buildCardRows, type CardRow } from '../lib/card';
import { CUSTOMER_STATUS_LABEL, CUSTOMER_STATUS_ORDER } from '../lib/customerStatus';
import { EvidenceToggle } from './EvidenceToggle';
import { ErrorBanner } from './ErrorBanner';
import { StatusChip } from './StatusChip';

/**
 * Trạng thái khách: Sale bấm chọn, không có gì tự đổi (AI không đề xuất hay đổi trạng thái).
 * Hiện người đổi và lúc đổi gần nhất để cả đội biết ai đã cập nhật.
 */
function CustomerStatusPicker({ summary }: { summary: ConversationSummary }) {
  const set = useSetCustomerStatus();
  // Hiện ngay lựa chọn vừa bấm trong lúc chờ máy chủ; lỗi thì quay về giá trị thật.
  const current = set.isPending && set.variables ? set.variables.status : summary.customerStatus;
  return (
    <div>
      <div id={`status-label-${summary.id}`} className="text-xs text-ink-3">Trạng thái khách</div>
      <div role="group" aria-labelledby={`status-label-${summary.id}`} className="mt-1 flex flex-wrap gap-1.5">
        {CUSTOMER_STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={current === s}
            disabled={set.isPending}
            onClick={() => current !== s && set.mutate({ conversationId: summary.id, status: s })}
            className={`h-8 rounded-full border px-3 text-xs font-semibold disabled:opacity-60 ${current === s ? 'border-brand bg-brand text-white' : 'border-line-strong bg-white text-ink-2'}`}
          >
            {CUSTOMER_STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {summary.customerStatusBy && summary.customerStatusAt ? (
        <div className="mt-1 text-xs text-ink-3">
          Cập nhật bởi {summary.customerStatusBy}, {formatTime(summary.customerStatusAt)}
        </div>
      ) : (
        <div className="mt-1 text-xs text-ink-3">Chưa ai cập nhật trạng thái.</div>
      )}
      {set.error ? <div className="mt-2"><ErrorBanner error={set.error} /></div> : null}
    </div>
  );
}

const EDITABLE = new Set(['customer_name', 'product_interest', 'budget', 'quantity', 'phone', 'address']);

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
      className="mt-1 flex w-full flex-wrap items-center gap-1.5"
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

/** Một nút duyệt chung cho mọi dòng AI điền đang chờ. Sale vẫn là người bấm; Sửa từng dòng trước khi duyệt nếu cần. */
function ApproveAllAi({ rows }: { rows: CardRow[] }) {
  const decide = useDecide();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pending = rows.filter((r) => r.state === 'ai' && r.proposalId);
  if (pending.length === 0) return null;
  const approve = async () => {
    setError(null);
    setBusy(true);
    try {
      for (const r of pending) await decide.mutateAsync({ proposalId: r.proposalId!, body: { action: 'accept' } });
    } catch (e) {
      setError(e); // dừng ở dòng đầu tiên thất bại
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <button type="button" disabled={busy} onClick={() => void approve()} className="h-9 w-full rounded-md border-0 bg-brand px-3 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? 'Đang duyệt…' : `Duyệt thông tin AI điền (${pending.length})`}
      </button>
      {error ? <div className="mt-2"><ErrorBanner error={error} /></div> : null}
    </div>
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
      <CustomerStatusPicker summary={detail.summary} />
      <ApproveAllAi rows={rows} />
      {rows.map((r) => (
        <div key={r.field}>
          <div className="text-xs text-ink-3">{r.label}</div>
          <div className="flex items-center justify-between gap-2">
            {r.text ? <span className="font-semibold">{r.text}</span> : <span className="text-[#5b6472]">{EMPTY_TEXT[r.state]}</span>}
            <StateChip row={r} />
          </div>
          {r.state === 'ai' ? (
            <div className="flex flex-wrap items-center gap-2">
              {EDITABLE.has(r.field) ? <EditAiValue row={r} /> : null}
              <EvidenceToggle id={`evidence-${r.field}`} label={r.label} evidence={r.evidence} messages={detail.messages} onJump={onJump} />
            </div>
          ) : null}
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
