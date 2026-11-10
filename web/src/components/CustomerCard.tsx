import { formatTime } from '../api/format';
import type { ConversationDetail } from '../api/types';
import { buildCardRows, type CardRow } from '../lib/card';
import { EvidenceQuote } from './EvidenceQuote';
import { StatusChip } from './StatusChip';

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
      <h3 className="m-0 text-[15px] font-bold">Thẻ khách</h3>
      {rows.map((r) => (
        <div key={r.field}>
          <div className="text-xs text-ink-3">{r.label}</div>
          <div className="flex items-center justify-between gap-2">
            {r.text ? <span className="font-semibold">{r.text}</span> : <span className="text-[#5b6472]">{EMPTY_TEXT[r.state]}</span>}
            <StateChip row={r} />
          </div>
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
