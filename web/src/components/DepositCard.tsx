import { useState } from 'react';
import { formatVnd } from '../api/format';
import { useConfirmOrder } from '../api/hooks';
import type { OrderView } from '../api/types';
import { ErrorBanner } from './ErrorBanner';

/** Bước "Tạo đơn": hiện khi khoản cọc đã đủ. Địa chỉ nhận hàng bắt buộc (6 đến 200 ký tự). */
export function DepositCard({ order }: { order: OrderView }) {
  const confirm = useConfirmOrder();
  const [address, setAddress] = useState(order.address ?? '');
  const [created, setCreated] = useState<string | null>(null);
  const a = address.trim();
  const valid = a.length >= 6 && a.length <= 200;

  if (order.status === 'confirmed' || created) {
    return (
      <section aria-label="Tạo đơn" className="mb-2.5 rounded-[10px] border border-[#8fd0a5] bg-[#effaf3] p-3">
        <div role="status" className="text-sm font-bold text-[#0f5132]">
          Đã tạo đơn #{created ?? order.code}
        </div>
        <div className="text-xs text-ink-3">
          Đã cọc {formatVnd(order.depositPaidVnd)} / {formatVnd(order.totalVnd)}.
        </div>
      </section>
    );
  }
  if (order.status !== 'awaiting_deposit' || order.depositPaidVnd < order.depositRequiredVnd) return null;

  return (
    <section aria-label="Tạo đơn" className="mb-2.5 rounded-[10px] border border-line-strong bg-white p-3">
      <h3 className="m-0 mb-1 text-sm font-bold">Tạo đơn</h3>
      <p className="m-0 mb-2 text-xs text-ink-2">
        Đã nhận cọc {formatVnd(order.depositPaidVnd)} (cần {formatVnd(order.depositRequiredVnd)}). Nhập địa chỉ nhận hàng để tạo đơn.
      </p>
      <label htmlFor={`create-addr-${order.id}`} className="mb-0.5 block text-xs text-ink-3">
        Địa chỉ nhận hàng
      </label>
      <input id={`create-addr-${order.id}`} name="address" autoComplete="off" value={address} onChange={(e) => setAddress(e.target.value)} className="h-9 w-full rounded-lg border border-line-strong px-2 text-sm" />
      <button
        type="button"
        className="mt-2 h-9 w-full rounded-lg border-0 bg-brand text-sm font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2"
        disabled={!valid || confirm.isPending}
        onClick={() => confirm.mutate({ id: order.id, address: a }, { onSuccess: (r) => setCreated(r.code) })}
      >
        Xác nhận tạo đơn
      </button>
      {confirm.error ? (
        <div className="mt-2">
          <ErrorBanner error={confirm.error} />
        </div>
      ) : null}
    </section>
  );
}
