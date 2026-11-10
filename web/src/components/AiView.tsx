import { useState } from 'react';
import { formatDateTime } from '../api/format';
import { useAi, useDeleteTenant, useDisableAi, useEnableAi } from '../api/hooks';
import { useSession } from '../state/session';
import { ErrorBanner } from './ErrorBanner';
import { Main } from './Main';
import { StatusChip } from './StatusChip';

const btn = 'h-10 rounded-lg border border-line-strong bg-white px-4 text-sm font-semibold disabled:opacity-50';
const primary = 'h-10 rounded-lg border-0 bg-brand px-5 text-sm font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2';

/** Xuất và xóa dữ liệu doanh nghiệp (chỉ chủ). */
function DataSection() {
  const del = useDeleteTenant();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  return (
    <section aria-label="Dữ liệu doanh nghiệp" className="rounded-xl border border-line bg-white p-5 text-sm">
      <h3 className="m-0 mb-2 text-base font-bold">Dữ liệu doanh nghiệp</h3>
      <p className="mt-0 text-ink-3">Tải toàn bộ dữ liệu (hội thoại, tin nhắn, hồ sơ khách, việc) dưới dạng JSON. Không gồm mật khẩu hay token.</p>
      <a href="/api/tenant/export" download className="inline-flex h-10 items-center rounded-lg border border-line-strong bg-white px-4 font-semibold text-ink no-underline">Tải dữ liệu</a>
      <hr className="my-4 border-line" />
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            del.mutate({ confirmName: name, password });
          }}
        >
          <p className="mt-0 font-semibold text-p1">Xóa vĩnh viễn toàn bộ dữ liệu, mọi thành viên và Page đã kết nối. Không hoàn tác được.</p>
          <label htmlFor="del-name" className="mb-1 block text-xs font-semibold">Nhập đúng tên doanh nghiệp để xác nhận</label>
          <input id="del-name" name="confirm-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} className="mb-3 h-10 w-full rounded-lg border border-line-strong px-3" />
          <label htmlFor="del-pass" className="mb-1 block text-xs font-semibold">Mật khẩu của bạn</label>
          <input id="del-pass" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mb-3 h-10 w-full rounded-lg border border-line-strong px-3" />
          {del.error ? <ErrorBanner error={del.error} /> : null}
          <div className="mt-3 flex gap-2">
            <button type="submit" className="h-10 rounded-lg border-0 bg-p1 px-4 font-semibold text-white disabled:opacity-50" disabled={name.trim() === '' || password === '' || del.isPending}>Xóa vĩnh viễn</button>
            <button type="button" className={btn} onClick={() => setOpen(false)}>Hủy</button>
          </div>
        </form>
      ) : (
        <button type="button" className={btn} onClick={() => setOpen(true)}>Xóa dữ liệu doanh nghiệp…</button>
      )}
    </section>
  );
}

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

        {isOwner ? <DataSection /> : null}

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
