import { useState } from 'react';
import { formatVnd } from '../api/format';
import { useSendReplyDraft, useUpdateOrder } from '../api/hooks';
import type { OrderView, ReplyDraftView } from '../api/types';
import { useSession } from '../state/session';
import { ErrorBanner } from './ErrorBanner';
import { StatusChip } from './StatusChip';

const input = 'h-9 w-full rounded-lg border border-line-strong px-2 text-sm';
const primary = 'h-9 rounded-lg border-0 bg-brand px-3 text-sm font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2';

const STATUS: Record<OrderView['status'], { tone: 'amber' | 'blue' | 'green' | 'gray'; label: string }> = {
  draft: { tone: 'amber', label: 'Đơn nháp' },
  awaiting_deposit: { tone: 'blue', label: 'Chờ cọc' },
  confirmed: { tone: 'green', label: 'Đã tạo đơn' },
  cancelled: { tone: 'gray', label: 'Đã hủy' },
};

function Missing() {
  return <span className="rounded bg-p1-soft px-1.5 py-px text-xs font-semibold text-[#7a1b12]">Thiếu</span>;
}

/** Đơn nháp do AI điền từ cuộc trò chuyện. Sale kiểm tra, sửa số lượng và địa chỉ. */
export function OrderDraftCard({ order }: { order: OrderView }) {
  const update = useUpdateOrder();
  const editable = order.status === 'draft';
  const [qty, setQty] = useState(String(order.quantity));
  const [address, setAddress] = useState(order.address ?? '');
  const s = STATUS[order.status];
  const qtyNum = Number(qty);
  const qtyValid = Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= 1000;

  return (
    <section aria-label="Đơn hàng" className="mb-2.5 rounded-[10px] border border-line-strong bg-white p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="m-0 text-sm font-bold">{order.code ? `Đơn #${order.code}` : 'Đơn nháp'}</h3>
        <StatusChip tone={s.tone}>{s.label}</StatusChip>
      </div>
      <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-ink-3">Khách</dt>
        <dd className="m-0">{order.customerName ?? <Missing />}</dd>
        <dt className="text-ink-3">SĐT</dt>
        <dd className="m-0">{order.phone ?? <Missing />}</dd>
        <dt className="text-ink-3">Sản phẩm</dt>
        <dd className="m-0 font-semibold">
          {order.productName} ({order.sku})
        </dd>
        <dt className="text-ink-3">Số lượng</dt>
        <dd className="m-0">
          {editable ? (
            <span className="flex gap-1.5">
              <label htmlFor={`qty-${order.id}`} className="sr-only">
                Số lượng
              </label>
              <input id={`qty-${order.id}`} name="quantity" inputMode="numeric" autoComplete="off" value={qty} onChange={(e) => setQty(e.target.value)} className={`${input} w-20`} />
              <button type="button" className={primary} disabled={!qtyValid || qtyNum === order.quantity || update.isPending} onClick={() => update.mutate({ id: order.id, patch: { quantity: qtyNum } })}>
                Lưu
              </button>
            </span>
          ) : (
            order.quantity
          )}
        </dd>
        <dt className="text-ink-3">Đơn giá</dt>
        <dd className="m-0">{formatVnd(order.unitPriceVnd)}</dd>
        <dt className="text-ink-3">Tổng</dt>
        <dd className="m-0 font-semibold">{formatVnd(order.totalVnd)}</dd>
        <dt className="text-ink-3">Cọc cần</dt>
        <dd className="m-0">{formatVnd(order.depositRequiredVnd)}</dd>
        {order.depositPaidVnd > 0 ? (
          <>
            <dt className="text-ink-3">Đã cọc</dt>
            <dd className="m-0 font-semibold text-ok">{formatVnd(order.depositPaidVnd)}</dd>
          </>
        ) : null}
        <dt className="text-ink-3">Địa chỉ</dt>
        <dd className="m-0">
          {editable ? (
            <span className="flex flex-col gap-1.5">
              <label htmlFor={`addr-${order.id}`} className="sr-only">
                Địa chỉ nhận hàng
              </label>
              <input id={`addr-${order.id}`} name="address" autoComplete="off" placeholder="Địa chỉ nhận hàng" value={address} onChange={(e) => setAddress(e.target.value)} className={input} />
              {order.address === null ? <Missing /> : null}
              <button type="button" className={`${primary} self-start`} disabled={address.trim() === '' || address.trim() === (order.address ?? '') || update.isPending} onClick={() => update.mutate({ id: order.id, patch: { address: address.trim() } })}>
                Lưu địa chỉ
              </button>
            </span>
          ) : (
            (order.address ?? <Missing />)
          )}
        </dd>
      </dl>
      {order.flags.includes('price_mismatch') ? (
        <p role="note" className="mb-0 mt-2 rounded-md bg-amber-soft px-2 py-1.5 text-xs text-amber-ink">
          Giá khách nhắc khác giá niêm yết. Đơn dùng giá niêm yết; hãy kiểm tra lại với khách.
        </p>
      ) : null}
      {editable ? <p className="mb-0 mt-2 text-xs text-ink-3">AI chỉ điền nháp, Sale phải kiểm tra lại trước khi gửi cho khách.</p> : null}
      {update.error ? (
        <div className="mt-2">
          <ErrorBanner error={update.error} />
        </div>
      ) : null}
    </section>
  );
}

const DRAFT_LABEL: Record<ReplyDraftView['kind'], string> = {
  confirm_order: 'Soạn sẵn từ đơn nháp',
  top_up: 'Soạn sẵn: nhắc chuyển nốt cọc',
  deposit_received: 'Soạn sẵn: báo đã nhận cọc',
};

/** Tin nháp gửi khách. Sale đọc, sửa tại ô rồi bấm Gửi: không phải tự soạn. */
export function ReplyDraftCard({ draft, conversationId }: { draft: ReplyDraftView; conversationId: string }) {
  const { me } = useSession();
  const send = useSendReplyDraft();
  const [text, setText] = useState(draft.text);
  const [sentOk, setSentOk] = useState(false);
  const empty = text.trim() === '';

  return (
    <section aria-label={`Tin nháp: ${DRAFT_LABEL[draft.kind]}`} className="mb-2.5 rounded-[10px] border border-line-strong bg-white p-3">
      <div className="text-xs font-semibold text-ink-3">{DRAFT_LABEL[draft.kind]}</div>
      <label htmlFor={`draft-${draft.id}`} className="sr-only">
        Nội dung tin gửi khách
      </label>
      <textarea id={`draft-${draft.id}`} name={`draft-${conversationId}`} autoComplete="off" rows={5} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} className="mt-1 w-full rounded-lg border border-line-strong p-2 text-sm leading-snug" />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className={primary}
          disabled={empty || send.isPending}
          onClick={() => send.mutate({ id: draft.id, text: text.trim() }, { onSuccess: () => setSentOk(true) })}
        >
          {send.isPending ? 'Đang gửi…' : 'Gửi'}
        </button>
        {me.demoTenant ? <span className="text-xs text-ink-3">Demo: tin chưa gửi tới Facebook</span> : null}
      </div>
      {sentOk ? (
        <div role="status" className="mt-1.5 text-xs font-semibold text-ok">
          Đã gửi.
        </div>
      ) : null}
      {send.error ? (
        <div className="mt-2">
          <ErrorBanner error={send.error} />
        </div>
      ) : null}
    </section>
  );
}
