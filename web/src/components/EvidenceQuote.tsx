import { formatTime } from '../api/format';
import type { Evidence, MessageView } from '../api/types';
import { quoteContext } from '../lib/evidence';

/**
 * Câu gốc làm căn cứ cho một giá trị AI trích: chữ trong tin của khách, đoạn khớp tô vàng.
 * Chữ lấy từ tin đã lưu theo offset (không dùng chuỗi do mô hình viết); lệch thì chỉ hiện chữ đã kiểm chứng của backend.
 */
export function EvidenceQuote({ evidence, messages, onJump }: { evidence: Evidence; messages: MessageView[]; onJump?: (messageId: string) => void }) {
  const msg = messages.find((m) => m.id === evidence.messageId);
  const ctx = msg?.text ? quoteContext(msg.text, evidence) : null;

  return (
    <div className="mt-1.5 rounded-md bg-[#f4f6f8] px-2 py-1.5 text-xs text-ink-2">
      <span>Câu gốc: “</span>
      {ctx ? (
        <>
          {ctx.cutBefore ? '…' : ''}
          {ctx.before}
          <mark className="bg-[#ffe58a] px-0.5 text-ink">{ctx.match}</mark>
          {ctx.after}
          {ctx.cutAfter ? '…' : ''}
        </>
      ) : (
        <mark className="bg-[#ffe58a] px-0.5 text-ink">{evidence.text}</mark>
      )}
      <span>”</span>
      {msg ? <span className="text-ink-3">, tin của khách lúc {formatTime(msg.sentAt)}</span> : null}
      {msg && onJump ? (
        <>
          {' '}
          <button type="button" onClick={() => onJump(msg.id)} className="border-0 bg-transparent p-0 font-semibold text-brand underline">
            xem trong chat
          </button>
        </>
      ) : null}
    </div>
  );
}
