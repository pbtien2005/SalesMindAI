import { useEffect, useRef } from 'react';
import { useConnectUrl, usePages } from '../api/hooks';
import { useSession } from '../state/session';
import { ErrorBanner } from './ErrorBanner';

/** Lý do chưa cho kết nối Page (null = được). Dùng chung cho mọi nút "Thêm Page". */
export function useConnectBlock(): string | null {
  const { role } = useSession();
  const pages = usePages(role !== 'sale');
  if (pages.data?.facebookConfigured === false) return 'Máy chủ chưa cấu hình ứng dụng Facebook (FB_APP_ID, APP_SECRET).';
  return null;
}

/**
 * Hộp thoại giải thích trước khi chuyển sang Facebook: lỗi hay gặp nhất là chọn thiếu Page hoặc đăng nhập
 * sai tài khoản, nên nói rõ trước. Bấm "Tiếp tục" mới xin liên kết và chuyển trang.
 */
export function ConnectPageDialog({ open, onClose, reconnect = false }: { open: boolean; onClose: () => void; reconnect?: boolean }) {
  const connect = useConnectUrl();
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const go = () => connect.mutate(undefined, { onSuccess: (r) => window.location.assign(r.url) });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="connect-title" className="w-full max-w-[480px] rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="connect-title" className="m-0 mb-2 text-lg font-bold">
          {reconnect ? 'Kết nối lại Page Facebook' : 'Kết nối Page Facebook'}
        </h2>
        <p className="m-0 mb-3 text-sm text-ink-2">Bạn sẽ được chuyển sang Facebook để đăng nhập và cấp quyền. Trước khi tiếp tục, hãy lưu ý:</p>
        <ul className="m-0 mb-4 flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
          <li>Đăng nhập bằng tài khoản Facebook <b>đang quản lý Page</b> cần kết nối.</li>
          <li>
            Ở bước chọn Page của Facebook, <b>tick đúng các Page</b> muốn dùng. Có thể chọn nhiều Page cùng lúc.
          </li>
          <li>Cấp đủ các quyền được yêu cầu. Thiếu quyền thì hệ thống không nhận được tin nhắn.</li>
          <li>Khi ứng dụng Facebook còn ở chế độ phát triển, tài khoản phải có vai trò (quản trị viên, nhà phát triển hoặc người thử nghiệm) trong ứng dụng.</li>
          <li>Liên kết chỉ dùng một lần, hết hạn sau 10 phút. Hãy hoàn tất trong cùng trình duyệt này.</li>
        </ul>
        {connect.error ? (
          <div className="mb-3">
            <ErrorBanner error={connect.error} />
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-line-strong bg-white px-4 text-sm">
            Để sau
          </button>
          <button ref={primary} type="button" disabled={connect.isPending} onClick={go} className="h-10 rounded-lg border-0 bg-brand px-5 text-sm font-semibold text-white disabled:opacity-60">
            {connect.isPending ? 'Đang mở Facebook…' : 'Tiếp tục với Facebook'}
          </button>
        </div>
      </div>
    </div>
  );
}
