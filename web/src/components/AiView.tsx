import { useState } from 'react';
import { formatDateTime } from '../api/format';
import { useAi, useDisableAi, useEnableAi } from '../api/hooks';
import { useSession } from '../state/session';
import { ErrorBanner } from './ErrorBanner';
import { Main } from './Main';
import { StatusChip } from './StatusChip';

const btn = 'h-10 rounded-lg border border-line-strong bg-white px-4 text-sm font-semibold disabled:opacity-50';
const primary = 'h-10 rounded-lg border-0 bg-brand px-5 text-sm font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2';

export function AiView() {
  const { role } = useSession();
  const ai = useAi();
  const enable = useEnableAi();
  const disable = useDisableAi();
  const [ack, setAck] = useState(false);
  const isOwner = role === 'owner';
  const d = ai.data;
  const failure = enable.error ?? disable.error ?? ai.error;

  return (
    <Main title="AI" className="overflow-auto bg-canvas">
      <div className="mx-auto flex max-w-[760px] flex-col gap-5 p-6">
        <div className="flex items-center gap-3">
          <h2 className="m-0 grow text-[22px] font-bold">AI trích xuất thông tin</h2>
          {d ? <StatusChip tone={d.enabled ? 'green' : 'gray'}>{d.enabled ? 'Đang bật' : 'Đang tắt'}</StatusChip> : null}
        </div>
        {failure ? <ErrorBanner error={failure} /> : null}

        <section aria-label="Cách AI hoạt động" className="rounded-xl border border-line bg-white p-5 text-sm">
          <p className="mt-0">AI đọc tin nhắn của khách để điền sẵn tên, sản phẩm, ngân sách, SĐT và mốc hẹn. Mọi thông tin đều kèm câu gốc; AI chỉ đề xuất, nhân viên quyết định. AI không bao giờ tự suy ra ngày từ cụm như "cuối tuần này".</p>
          {d?.mode === 'offline' ? (
            <p className="mb-0 text-ink-3">Máy chủ đang ở chế độ <strong>mô phỏng</strong> (bộ luật, không gọi AI bên ngoài, không gửi dữ liệu ra ngoài).</p>
          ) : (
            <p className="mb-0 text-ink-3">Máy chủ đang ở chế độ <strong>AI thật</strong>: nội dung chat của khách được gửi tới nhà cung cấp AI ở nước ngoài để xử lý.</p>
          )}
        </section>

        {d ? (
          <section aria-label="Mức dùng hôm nay" className="rounded-xl border border-line bg-white p-5">
            <h3 className="m-0 mb-3 text-base font-bold">Mức dùng hôm nay</h3>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-3">Lời gọi AI</dt>
              <dd className="m-0">{d.today.calls}{d.cap !== null ? ` / ${d.cap}` : ''}</dd>
              <dt className="text-ink-3">Token vào / ra</dt>
              <dd className="m-0">{d.today.inputTokens.toLocaleString('vi-VN')} / {d.today.outputTokens.toLocaleString('vi-VN')}</dd>
              {d.consentAt ? (
                <>
                  <dt className="text-ink-3">Đã đồng ý lúc</dt>
                  <dd className="m-0">{formatDateTime(d.consentAt)}</dd>
                </>
              ) : null}
            </dl>
            {d.cap !== null && d.today.calls >= d.cap ? (
              <p role="alert" className="mb-0 mt-3 text-sm text-amber">Đã dùng hết hạn mức AI hôm nay. Tin mới vẫn được lưu; AI sẽ tiếp tục vào ngày mai (giờ Việt Nam).</p>
            ) : null}
          </section>
        ) : null}

        {d && !d.enabled ? (
          <section aria-label="Bật AI" className="rounded-xl border border-line bg-white p-5">
            <h3 className="m-0 mb-2 text-base font-bold">Bật AI cho doanh nghiệp</h3>
            {isOwner ? (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
                  <span>
                    Tôi hiểu rằng khi bật, nội dung tin nhắn của khách có thể được gửi tới nhà cung cấp AI ở nước ngoài, và tôi chịu trách nhiệm đã có căn cứ pháp lý phù hợp (Luật 91/2025/QH15 về bảo vệ dữ liệu cá nhân). Tin cũ trước lúc bật không tự được xử lý.
                  </span>
                </label>
                <button type="button" className={`${primary} mt-3`} disabled={!ack || enable.isPending} onClick={() => enable.mutate()}>
                  Bật AI
                </button>
              </>
            ) : (
              <p className="m-0 text-sm text-ink-3">Chỉ chủ doanh nghiệp mới bật được AI.</p>
            )}
          </section>
        ) : null}

        {d?.enabled && isOwner ? (
          <div>
            <button type="button" className={btn} disabled={disable.isPending} onClick={() => disable.mutate()}>
              Tắt AI
            </button>
          </div>
        ) : null}
      </div>
    </Main>
  );
}
