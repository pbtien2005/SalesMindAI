import type { ConversationDetail } from '../api/types';
import { BillCard } from './BillCard';
import { DepositCard } from './DepositCard';
import { OrderDraftCard, ReplyDraftCard } from './OrderDraftCard';
import { StatusChip } from './StatusChip';

/** Phần "đơn hàng" của một hội thoại: tín hiệu chốt, đơn nháp, tin nháp, bill và bước tạo đơn. Không hiện gì nếu chưa có. */
export function OrderSection({ detail, onJump }: { detail: ConversationDetail; onJump: (messageId: string) => void }) {
  const { order, replyDrafts = [], payments = [], summary, messages } = detail;
  const signal = summary.closeSignal;
  const pendingBills = payments.filter((p) => p.status === 'proposed');
  const doneBills = payments.filter((p) => p.status !== 'proposed');
  if (!order && !signal && payments.length === 0) return null;
  const imageOf = (messageId: string) => messages.find((m) => m.id === messageId)?.attachments?.find((a) => a.type === 'image' && a.url)?.url ?? null;

  return (
    <div className="border-b border-[#eef1f5] px-[18px] py-4">
      <h2 className="m-0 mb-2.5 text-[15px] font-bold">Đơn hàng</h2>
      {signal ? (
        <div className="mb-2.5 text-sm">
          <StatusChip tone="p1">Tín hiệu chốt đơn</StatusChip>{' '}
          <span className="text-ink-2">
            căn cứ “{signal.text}”{' '}
            <button type="button" onClick={() => onJump(signal.messageId)} className="border-0 bg-transparent p-0 font-semibold text-brand underline">
              xem trong chat
            </button>
          </span>
        </div>
      ) : null}
      {order ? <OrderDraftCard key={`${order.id}-${order.status}-${order.quantity}-${order.address ?? ''}`} order={order} /> : null}
      {replyDrafts.map((d) => (
        <ReplyDraftCard key={`${d.id}-${d.text}`} draft={d} conversationId={summary.id} />
      ))}
      {pendingBills.map((p) => (
        <BillCard key={p.id} payment={p} imageUrl={imageOf(p.messageId)} />
      ))}
      {order ? <DepositCard key={order.id} order={order} /> : null}
      {doneBills.map((p) => (
        <BillCard key={p.id} payment={p} imageUrl={imageOf(p.messageId)} />
      ))}
    </div>
  );
}
