import { formatDateTime } from '../api/format';
import { useHistory } from '../api/hooks';
import type { HistoryEntry, MessageView } from '../api/types';
import { fieldLabel } from '../lib/fields';
import { ErrorBanner } from './ErrorBanner';
import { EvidenceToggle } from './EvidenceToggle';

const STATUS: Record<string, string> = { accepted: 'đã duyệt', edited: 'đã sửa và duyệt', dismissed: 'đã bỏ qua', superseded: 'đã bị thay thế', pending: 'đang chờ duyệt' };

function line(h: HistoryEntry): string {
  if (h.kind === 'stop_followup') return `Ngừng bám · ${STATUS[h.status] ?? h.status}`;
  const v = h.proposedValue?.text ?? '';
  return `AI đề xuất ${fieldLabel(h.field ?? '')}: ${v} · ${STATUS[h.status] ?? h.status}`;
}

/** Lịch sử đề xuất và quyết định của một hội thoại (ai duyệt, lúc nào). Câu gốc thu gọn sau nút "Căn cứ" cho đỡ lặp. */
export function HistoryPanel({ conversationId, messages, onJump }: { conversationId: string; messages: MessageView[]; onJump: (id: string) => void }) {
  const q = useHistory(conversationId);
  const items = q.data?.history ?? [];
  return (
    <section aria-label="Lịch sử duyệt" className="border-t border-[#eef1f5] px-[18px] py-4">
      <h2 className="m-0 mb-2 text-[15px] font-bold">Lịch sử duyệt</h2>
      {q.error ? <ErrorBanner error={q.error} /> : null}
      {q.data && items.length === 0 ? <p className="m-0 text-sm text-ink-3">Chưa có đề xuất nào.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {items.map((h, i) => (
          <li key={`${h.at}-${i}`} className="text-sm">
            <div className="font-semibold">{line(h)}</div>
            <div className="text-xs text-ink-3">
              {h.decidedBy ? `bởi ${h.decidedBy}` : 'chưa có người quyết định'} · {formatDateTime(h.at)}
            </div>
            <EvidenceToggle id={`history-evidence-${i}`} label={h.kind === 'stop_followup' ? 'Ngừng bám' : fieldLabel(h.field ?? '')} evidence={h.evidence} messages={messages} onJump={onJump} />
          </li>
        ))}
      </ul>
    </section>
  );
}
