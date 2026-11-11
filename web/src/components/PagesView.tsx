import { useState } from 'react';
import { formatDateTime } from '../api/format';
import { useBackfillPage, useDisconnectPage, usePages } from '../api/hooks';
import type { PageView } from '../api/types';
import { ConnectPageDialog, useConnectBlock } from './ConnectPageDialog';
import { ErrorBanner } from './ErrorBanner';
import { Main } from './Main';
import { StatusChip } from './StatusChip';

const btn = 'h-9 rounded-lg border border-line-strong bg-white px-3 text-sm disabled:opacity-50';
const primary = 'h-10 rounded-lg border-0 bg-brand px-5 text-sm font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2';

const CONNECT_ERRORS: Record<string, string> = {
  facebook: 'Facebook từ chối hoặc không phản hồi. Hãy thử lại sau ít phút.',
  system: 'Có lỗi hệ thống khi lưu Page. Hãy thử lại; nếu vẫn lỗi, báo cho quản trị viên.',
};

/** Kết quả quay về từ Facebook (`/?connected=2&skipped=0&failed=0` hoặc `/?connect_error=facebook`). Đọc một lần rồi xóa khỏi URL. */
function readOutcome(): { kind: 'ok' | 'partial' | 'none' | 'error'; text: string } | null {
  const q = new URLSearchParams(window.location.search);
  const err = q.get('connect_error');
  const connected = q.get('connected');
  if (err === null && connected === null) return null;
  window.history.replaceState(null, '', window.location.pathname);
  if (err !== null) return { kind: 'error', text: CONNECT_ERRORS[err] ?? 'Không kết nối được Page.' };
  const n = Number(connected) || 0;
  const skipped = Number(q.get('skipped')) || 0;
  const failed = Number(q.get('failed')) || 0;
  const notes = [
    skipped ? `${skipped} Page đang được doanh nghiệp khác sử dụng nên không kết nối được` : '',
    failed ? `${failed} Page đã lưu nhưng chưa đăng ký được webhook (chưa nhận được tin)` : '',
  ].filter(Boolean);
  if (n === 0 && notes.length === 0) return { kind: 'none', text: 'Chưa có Page nào được kết nối. Hãy chọn ít nhất một Page trong hộp thoại của Facebook.' };
  return { kind: notes.length ? 'partial' : 'ok', text: `Đã kết nối ${n} Page.${notes.length ? ' ' + notes.join('; ') + '.' : ''}${n > 0 ? ' Bấm "Lấy lại tin cũ" ở từng Page để tải các hội thoại trước đây; tin mới sẽ tự hiện trong Hội thoại.' : ''}` };
}

const STATUS: Record<PageView['status'], { tone: 'green' | 'amber' | 'gray'; label: string }> = {
  active: { tone: 'green', label: 'Đang hoạt động' },
  token_invalid: { tone: 'amber', label: 'Cần kết nối lại' },
  disconnected: { tone: 'gray', label: 'Đã ngắt kết nối' },
};

function PageCard({ p }: { p: PageView }) {
  const disconnect = useDisconnectPage();
  const backfill = useBackfillPage();
  const block = useConnectBlock();
  const [reconnecting, setReconnecting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const st = STATUS[p.status];

  return (
    <li className="rounded-xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="m-0 grow text-base font-bold">{p.name}</h3>
        <StatusChip tone={st.tone}>{st.label}</StatusChip>
      </div>
      <dl className="m-0 mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-3">Webhook</dt>
        <dd className="m-0">{p.status === 'disconnected' ? 'Đã hủy đăng ký' : p.webhookSubscribed ? 'Đã đăng ký' : 'Chưa nhận được tin (đăng ký chưa thành công)'}</dd>
        <dt className="text-ink-3">Hội thoại</dt>
        <dd className="m-0">{p.conversations}</dd>
        <dt className="text-ink-3">Tin gần nhất</dt>
        <dd className="m-0">{p.lastMessageAt ? formatDateTime(p.lastMessageAt) : 'Chưa có'}</dd>
        <dt className="text-ink-3">Kết nối bởi</dt>
        <dd className="m-0">{p.connectedBy ?? 'Quản trị viên (CLI)'}</dd>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {p.status !== 'active' ? (
          <button type="button" className={btn} disabled={block !== null} onClick={() => setReconnecting(true)}>
            Kết nối lại
          </button>
        ) : (
          <button
            type="button"
            className={btn}
            disabled={backfill.isPending}
            onClick={() => backfill.mutate(p.id, { onSuccess: (r) => setNote(r.queued ? 'Đã xếp việc lấy lại tin cũ (tối đa 20 tin gần nhất mỗi hội thoại).' : 'Đã có việc lấy tin cũ đang chờ.') })}
          >
            Lấy lại tin cũ
          </button>
        )}
        {p.status !== 'disconnected' ? (
          confirm ? (
            <span className="flex items-center gap-2">
              <span className="text-sm">Ngắt kết nối {p.name}? Tin cũ vẫn được giữ.</span>
              <button type="button" className="h-9 rounded-lg border-0 bg-p1 px-3 text-sm font-semibold text-white" disabled={disconnect.isPending} onClick={() => disconnect.mutate(p.id, { onSettled: () => setConfirm(false) })}>
                Ngắt
              </button>
              <button type="button" className={btn} onClick={() => setConfirm(false)}>
                Hủy
              </button>
            </span>
          ) : (
            <button type="button" className={btn} aria-label={`Ngắt kết nối ${p.name}`} onClick={() => setConfirm(true)}>
              Ngắt kết nối
            </button>
          )
        ) : null}
      </div>
      {note ? (
        <p role="status" className="mb-0 mt-3 text-sm text-ok">
          {note}
        </p>
      ) : null}
      {disconnect.error ?? backfill.error ? <div className="mt-3"><ErrorBanner error={disconnect.error ?? backfill.error} /></div> : null}
      <ConnectPageDialog open={reconnecting} reconnect onClose={() => setReconnecting(false)} />
    </li>
  );
}

export function PagesView() {
  const pages = usePages();
  const block = useConnectBlock();
  const [dialog, setDialog] = useState(false);
  const [outcome] = useState(readOutcome);
  const list = pages.data?.pages ?? [];

  return (
    <Main title="Page Facebook" className="overflow-auto bg-canvas">
      <div className="mx-auto flex max-w-[860px] flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="m-0 grow text-[22px] font-bold">Page Facebook</h2>
          <button type="button" className={primary} disabled={block !== null} onClick={() => setDialog(true)}>
            {list.some((p) => p.status !== 'disconnected') ? '+ Thêm Page' : 'Kết nối Page Facebook'}
          </button>
        </div>
        {block ? <p role="status" className="m-0 -mt-3 text-sm text-ink-3">{block}</p> : null}
        <ConnectPageDialog open={dialog} onClose={() => setDialog(false)} />

        {outcome ? (
          <div role="status" className={`rounded-xl border p-4 text-sm ${outcome.kind === 'ok' ? 'border-[#b7dfc4] bg-[#eefaf2]' : 'border-[#e0a33a] bg-[#fffaee]'}`}>
            {outcome.text}
          </div>
        ) : null}
        {pages.data?.facebookConfigured === false ? (
          <div role="alert" className="rounded-xl border border-[#e0a33a] bg-[#fffaee] p-4 text-sm">
            Máy chủ chưa được cấu hình ứng dụng Facebook (FB_APP_ID, APP_SECRET). Xem hướng dẫn trong doc/KET-NOI-PAGE.md.
          </div>
        ) : null}
        {pages.isError ? <ErrorBanner error={pages.error} /> : null}

        <p className="m-0 text-sm text-ink-3">
          Khi ứng dụng Facebook còn ở chế độ phát triển, chỉ tài khoản có vai trò trong ứng dụng (quản trị viên, nhà phát triển, người thử nghiệm) mới kết nối được Page và nhắn tin thử.
        </p>

        {pages.data && list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong bg-white p-8 text-center">
            <div className="mb-1 text-base font-bold">Chưa kết nối Page nào</div>
            <div className="text-sm text-ink-3">Bấm "Kết nối Page Facebook", đăng nhập Facebook và chọn các Page bạn quản lý. Có thể chọn nhiều Page cùng lúc.</div>
          </div>
        ) : null}

        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {list.map((p) => (
            <PageCard key={p.id} p={p} />
          ))}
        </ul>
      </div>
    </Main>
  );
}
