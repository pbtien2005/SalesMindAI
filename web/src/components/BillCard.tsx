import { useState } from 'react';
import { formatVnd } from '../api/format';
import { useConfirmPayment, useRejectPayment } from '../api/hooks';
import type { PaymentView } from '../api/types';
import { ErrorBanner } from './ErrorBanner';
import { StatusChip } from './StatusChip';

const primary = 'h-9 flex-1 rounded-lg border-0 bg-brand px-3 text-sm font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2';
const secondary = 'h-9 rounded-lg border border-line-strong bg-white px-3 text-sm disabled:opacity-50';

/**
 * Khoản chuyển khoản AI đọc từ ảnh bill của khách. AI chỉ ĐỌC số tiền; việc đã nhận tiền hay chưa do Sale xác nhận.
 * Dòng so ngưỡng chỉ có khi đọc được số tiền và đã có đơn.
 */
export function BillCard({ payment, imageUrl }: { payment: PaymentView; imageUrl: string | null }) {
  const confirm = useConfirmPayment();
  const reject = useRejectPayment();
  const [manual, setManual] = useState('');
  const manualNum = Number(manual.replace(/\D/g, ''));
  const busy = confirm.isPending || reject.isPending;
  const proposed = payment.status === 'proposed';
  const needsManual = !payment.readOk;
  const canConfirm = proposed && !busy && (!needsManual || manualNum >= 1);

  return (
    <section aria-label="Ảnh bill chuyển khoản" className="mb-2.5 rounded-[10px] border border-[#e0a33a] bg-[#fffaee] p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="m-0 text-sm font-bold">Bill chuyển khoản</h3>
        {payment.status === 'confirmed' ? <StatusChip tone="green">Đã xác nhận bởi {payment.confirmedBy ?? 'Sale'}</StatusChip> : null}
        {payment.status === 'rejected' ? <StatusChip tone="gray">Đã bỏ qua</StatusChip> : null}
        {proposed ? <StatusChip tone="amber">Chờ Sale xác nhận</StatusChip> : null}
      </div>

      {imageUrl ? (
        <div className="relative mb-2 inline-block max-w-full">
          <img src={imageUrl} alt="Ảnh bill khách gửi" loading="lazy" referrerPolicy="no-referrer" className="block max-h-56 max-w-full rounded-md border border-line" />
          {payment.bbox ? (
            <span
              aria-hidden="true"
              data-testid="bill-bbox"
              className="pointer-events-none absolute rounded-sm border-2 border-brand"
              style={{ left: `${payment.bbox.x * 100}%`, top: `${payment.bbox.y * 100}%`, width: `${payment.bbox.w * 100}%`, height: `${payment.bbox.h * 100}%` }}
            />
          ) : null}
        </div>
      ) : null}

      {payment.readOk && payment.amountVnd !== null ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-3">Số tiền AI đọc</dt>
          <dd className="m-0 font-bold">{formatVnd(payment.amountVnd)}</dd>
          {payment.transferNote ? (
            <>
              <dt className="text-ink-3">Nội dung</dt>
              <dd className="m-0">{payment.transferNote}</dd>
            </>
          ) : null}
          {payment.billTime ? (
            <>
              <dt className="text-ink-3">Thời gian</dt>
              <dd className="m-0">{payment.billTime}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="m-0 text-sm font-semibold text-[#7a1b12]">Không đọc được số tiền: Sale nhập tay hoặc bỏ qua.</p>
      )}

      {payment.verdict && payment.amountVnd !== null && payment.orderTotalVnd !== null && payment.ratioPercent !== null && payment.thresholdPercent !== null ? (
        <p role="status" className={`mb-0 mt-2 rounded-md px-2 py-1.5 text-sm font-semibold ${payment.verdict === 'ok' ? 'bg-[#dcf3e4] text-[#0f5132]' : 'bg-p1-soft text-[#7a1b12]'}`}>
          {formatVnd(payment.amountVnd)} / {formatVnd(payment.orderTotalVnd)} = {payment.ratioPercent}%,{' '}
          {payment.verdict === 'ok' ? `đạt ngưỡng ≥ ${payment.thresholdPercent}%` : `dưới ${payment.thresholdPercent}%`}
        </p>
      ) : null}

      <p className="mb-0 mt-2 text-xs text-ink-3">
        AI chỉ đọc số tiền, trạng thái thanh toán do Sale xác nhận.{payment.simulatedReader ? ' Đang dùng bộ đọc mô phỏng (không phải AI thật).' : ''}
      </p>

      {proposed ? (
        <>
          {needsManual ? (
            <div className="mt-2">
              <label htmlFor={`amount-${payment.id}`} className="mb-0.5 block text-xs text-ink-3">
                Số tiền Sale nhập (VND)
              </label>
              <input id={`amount-${payment.id}`} name="amount" inputMode="numeric" autoComplete="off" value={manual} onChange={(e) => setManual(e.target.value)} className="h-9 w-full rounded-lg border border-line-strong px-2 text-sm" />
            </div>
          ) : null}
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              className={primary}
              disabled={!canConfirm}
              onClick={() => confirm.mutate({ id: payment.id, ...(needsManual ? { amountVnd: manualNum } : {}) })}
            >
              Xác nhận đã cọc
            </button>
            <button type="button" className={secondary} disabled={busy} onClick={() => reject.mutate(payment.id)}>
              Bỏ qua
            </button>
          </div>
        </>
      ) : null}
      {confirm.error || reject.error ? (
        <div className="mt-2">
          <ErrorBanner error={(confirm.error ?? reject.error)!} />
        </div>
      ) : null}
    </section>
  );
}
