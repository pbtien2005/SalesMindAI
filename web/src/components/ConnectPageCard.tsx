import { useState } from 'react';
import { usePages } from '../api/hooks';
import { useSession } from '../state/session';
import { ConnectPageDialog, useConnectBlock } from './ConnectPageDialog';

/**
 * Thẻ mời kết nối Page đầu tiên, hiện ở Trang chủ và Hộp thư khi doanh nghiệp chưa có Page nào đang kết nối.
 * Owner và manager có nút bấm; sale chỉ được nhắn nhờ quản lý. Không hiện khi đã có Page (hoặc chưa tải xong).
 */
export function ConnectPageCard({ className = '' }: { className?: string }) {
  const { role } = useSession();
  const canConnect = role === 'owner' || role === 'manager';
  const pages = usePages(canConnect);
  const block = useConnectBlock();
  const [open, setOpen] = useState(false);

  if (!canConnect || !pages.data || pages.data.pages.some((p) => p.status !== 'disconnected')) return null;

  return (
    <section aria-label="Kết nối Page đầu tiên" className={`rounded-xl border border-dashed border-brand bg-brand-soft p-5 ${className}`}>
      <h2 className="m-0 mb-1 text-base font-bold">Kết nối Page Facebook đầu tiên</h2>
      <p className="m-0 mb-3 text-sm text-ink-2">Chưa có Page nào được kết nối nên chưa có tin nhắn của khách. Kết nối Page để AI bắt đầu trích nhu cầu, ngân sách và mốc thời gian từ tin nhắn.</p>
      <ol className="m-0 mb-3 list-decimal pl-5 text-sm text-ink-2">
        <li>Đăng nhập Facebook bằng tài khoản quản lý Page</li>
        <li>Chọn các Page muốn dùng</li>
        <li>Quay lại đây, tin nhắn mới sẽ tự hiện trong Hội thoại</li>
      </ol>
      <button type="button" disabled={block !== null} onClick={() => setOpen(true)} className="h-10 rounded-lg border-0 bg-brand px-5 text-sm font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2">
        Kết nối Page Facebook
      </button>
      {block ? <p role="status" className="m-0 mt-2 text-xs text-ink-3">{block}</p> : null}
      <ConnectPageDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
