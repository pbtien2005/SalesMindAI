import { useState } from 'react';
import type { Evidence, MessageView } from '../api/types';
import { EvidenceQuote } from './EvidenceQuote';

/**
 * Căn cứ thu gọn: mặc định đóng cho gọn, bấm một lần để xem câu gốc (không phụ thuộc rê chuột nên dùng được trên cảm ứng).
 * Dùng ở Thẻ khách và Lịch sử duyệt để giá trị đã duyệt vẫn truy được về câu gốc.
 */
export function EvidenceToggle({
  id,
  label,
  evidence,
  messages,
  onJump,
}: {
  /** Mã phần tử duy nhất cho vùng nội dung (aria-controls). */
  id: string;
  /** Tên trường, để nút có nhãn đọc được ("Căn cứ Ngân sách"). */
  label: string;
  evidence: Evidence[];
  messages: MessageView[];
  onJump?: (messageId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (evidence.length === 0) return null;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Căn cứ ${label}`}
        onClick={() => setOpen((o) => !o)}
        className="mt-1 h-7 border-0 bg-transparent p-0 text-xs font-semibold text-brand underline"
      >
        Căn cứ
      </button>
      {open ? (
        <div id={id} className="w-full">
          {evidence.map((e, i) => (
            <EvidenceQuote key={`${e.messageId}-${e.start}-${i}`} evidence={e} messages={messages} onJump={onJump} />
          ))}
        </div>
      ) : null}
    </>
  );
}
