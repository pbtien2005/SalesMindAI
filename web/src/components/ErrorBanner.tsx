import { ApiError } from '../api/client';

/** Hiện lỗi API dễ hiểu; `no_demo_data` và mất kết nối có hướng dẫn khắc phục riêng. */
export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;

  let title = 'Có lỗi khi gọi máy chủ demo';
  let hint: string | null = null;
  if (e?.code === 'no_demo_data') {
    title = 'Chưa có dữ liệu demo';
    hint = 'Chạy `npm run cli -- demo:reset` trong thư mục backend/, hoặc bấm "Đặt lại demo" ở thanh trên.';
  } else if (e?.code === 'network') {
    title = 'Không kết nối được máy chủ demo';
    hint = 'Chạy `npm run dev` trong thư mục backend/ (cần DEMO_MODE=true trong backend/.env).';
  } else if (e?.status === 404) {
    title = 'API demo chưa được bật';
    hint = 'Đặt DEMO_MODE=true trong backend/.env rồi khởi động lại máy chủ.';
  }

  return (
    <div role="alert" className="rounded-xl border border-[#f1b7b0] bg-p1-bg p-4 text-ink">
      <div className="font-semibold text-p1">{title}</div>
      <div className="mt-1 text-sm text-ink-2">{error instanceof Error ? error.message : String(error)}</div>
      {hint ? <div className="mt-2 text-sm text-ink-2">{hint}</div> : null}
    </div>
  );
}
