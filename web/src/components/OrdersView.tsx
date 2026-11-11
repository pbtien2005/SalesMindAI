import { formatVnd } from '../api/format';
import { useOrders } from '../api/hooks';
import type { OrderRow } from '../api/types';
import { useSession } from '../state/session';
import { ErrorBanner } from './ErrorBanner';
import { Main } from './Main';
import { StatusChip } from './StatusChip';

const STATUS: Record<OrderRow['status'], { tone: 'amber' | 'blue' | 'green' | 'gray'; label: string }> = {
  draft: { tone: 'amber', label: 'Nháp' },
  awaiting_deposit: { tone: 'blue', label: 'Chờ cọc' },
  confirmed: { tone: 'green', label: 'Đã tạo' },
  cancelled: { tone: 'gray', label: 'Đã hủy' },
};

/** Màn Đơn hàng: mã, khách, sản phẩm, tổng, đã cọc, còn lại, trạng thái. */
export function OrdersView() {
  const q = useOrders();
  const { openConversation } = useSession();
  const rows = q.data?.orders ?? [];
  return (
    <Main title="Đơn hàng" className="overflow-auto bg-canvas">
      <div className="mx-auto flex max-w-[980px] flex-col gap-4 p-6">
        <h1 className="m-0 text-[22px] font-bold">Đơn hàng</h1>
        {q.error ? <ErrorBanner error={q.error} /> : null}
        {q.data && rows.length === 0 ? <p className="text-ink-3">Chưa có đơn nào. Đơn nháp xuất hiện khi khách chốt mua.</p> : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Danh sách đơn hàng</caption>
              <thead>
                <tr className="border-b border-line text-xs text-ink-3">
                  {['Mã', 'Khách', 'Sản phẩm', 'Tổng', 'Đã cọc', 'Còn lại', 'Trạng thái'].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b border-[#eef1f5] last:border-b-0">
                    <td className="px-3 py-2.5 font-semibold">{o.code ? `#${o.code}` : '—'}</td>
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => openConversation(o.conversationId)} className="border-0 bg-transparent p-0 text-left font-semibold text-brand underline">
                        {o.customerName}
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      {o.quantity} × {o.productName} ({o.sku})
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{formatVnd(o.totalVnd)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{formatVnd(o.depositPaidVnd)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{formatVnd(o.remainingVnd)}</td>
                    <td className="px-3 py-2.5">
                      <StatusChip tone={STATUS[o.status].tone}>{STATUS[o.status].label}</StatusChip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Main>
  );
}
