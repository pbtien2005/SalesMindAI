import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useAdvanceClockTo, useCustomerMessage, useInbox, usePageMessage, usePersonas } from '../api/hooks';
import { useSession } from '../state/session';
import { ErrorBanner } from './ErrorBanner';

/** Câu mẫu lấy nguyên văn từ doc/KICH-BAN-DEMO-MVP.md (bộ trích offline chỉ hiểu các câu này và biến thể gần). */
const CUSTOMER_SAMPLES = [
  { label: 'Cảnh 1, tin 1', text: 'Chào shop, anh đang tìm sofa phòng khách tầm 15 triệu' },
  { label: 'Cảnh 1, tin 2', text: 'Có mẫu nào màu xám không em?' },
  { label: 'Cảnh 3', text: 'Anh Minh đây, hôm qua bận quá. SĐT anh 0912 345 678. Cuối tuần này anh ghé shop xem được không?' },
];

const LAN_SAMPLES = [
  {
    label: 'Cảnh 1',
    text: 'Dạ em chào anh ạ. Em gửi anh vài mẫu sofa xám, nổi bật là Sofa Milan xám (SF-021) giá 12 triệu ạ. Anh cho em xin SĐT để em tư vấn thêm nhé.',
  },
  { label: 'Cảnh 2', text: 'Anh Minh ơi, mẫu Sofa Milan xám em gửi hôm qua anh xem thế nào ạ? Anh cho em xin SĐT để em giữ hàng nhé.' },
];

/** Mốc tua đồng hồ theo kịch bản. Đồng hồ chỉ tiến, không lùi (muốn quay lại thì "Đặt lại demo"). */
const CLOCK_JUMPS = [
  { label: 'Cảnh 1: Thứ Năm 12/11 09:05', to: '2026-11-12T09:05:00+07:00' },
  { label: 'Cảnh 2: Thứ Sáu 13/11 09:30', to: '2026-11-13T09:30:00+07:00' },
  { label: 'Cảnh 3: Thứ Sáu 13/11 09:40', to: '2026-11-13T09:40:00+07:00' },
];

const field = 'w-full rounded-lg border border-line-strong px-2.5 text-sm';
const chip = 'h-7 rounded-full border border-line-strong bg-white px-2.5 text-xs hover:bg-canvas';
const sendBtn = 'h-9 w-full rounded-lg border-0 bg-brand font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-[#eef1f5] px-[18px] py-4">
      <h3 className="m-0 mb-2.5 text-sm font-bold">{title}</h3>
      {children}
    </section>
  );
}

/** Ngăn kéo Giả lập: chỉ để diễn demo (chưa dùng Page Facebook thật). */
export function SimulatorPanel() {
  const { simulatorOpen, closeSimulator, conversationId } = useSession();
  const personas = usePersonas();
  const inbox = useInbox();
  const customer = useCustomerMessage();
  const page = usePageMessage();
  const clock = useAdvanceClockTo();

  const [persona, setPersona] = useState('minh');
  const [customerText, setCustomerText] = useState('');
  const [target, setTarget] = useState('');
  const [pageText, setPageText] = useState('');
  const panel = useRef<HTMLElement>(null);

  // Mở ngăn kéo thì đưa focus vào trong để người dùng bàn phím không phải Tab qua cả màn hình.
  useEffect(() => {
    if (simulatorOpen) panel.current?.focus();
  }, [simulatorOpen]);

  if (!simulatorOpen) return null;

  const list = inbox.data?.conversations ?? [];
  const pageTarget = list.some((c) => c.id === target) ? target : list.some((c) => c.id === conversationId) ? (conversationId as string) : (list[0]?.id ?? '');

  const sendCustomer = (e: FormEvent) => {
    e.preventDefault();
    const text = customerText.trim();
    if (!text || customer.isPending) return;
    customer.mutate({ target: { persona }, text }, { onSuccess: () => setCustomerText('') });
  };
  const sendPage = (e: FormEvent) => {
    e.preventDefault();
    const text = pageText.trim();
    if (!text || !pageTarget || page.isPending) return;
    page.mutate({ conversationId: pageTarget, text }, { onSuccess: () => setPageText('') });
  };
  // Đóng thì trả focus về nút "Giả lập" đã mở nó.
  const close = () => {
    closeSimulator();
    document.getElementById('sim-toggle')?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // Esc trong danh sách chọn chỉ nên đóng danh sách, không đóng cả bảng.
    if (e.key === 'Escape' && !(e.target instanceof HTMLSelectElement)) close();
  };

  return (
    <aside
      id="simulator-panel"
      ref={panel}
      tabIndex={-1}
      aria-label="Bảng Giả lập"
      onKeyDown={onKeyDown}
      className="overscroll-contain outline-none absolute bottom-0 right-0 top-0 z-10 flex w-[380px] flex-col overflow-auto border-l border-line-strong bg-white shadow-[-8px_0_24px_rgba(15,27,45,.12)]"
    >
      <div className="flex items-center justify-between border-b border-line px-[18px] py-3.5">
        <div>
          <h2 className="m-0 text-[15px] font-bold">Giả lập (chỉ dùng khi demo)</h2>
          <div className="text-xs text-ink-3">Tin giả đi qua webhook thật, chưa dùng Page Facebook thật.</div>
        </div>
        <button type="button" onClick={close} aria-label="Đóng bảng Giả lập" className="h-9 w-9 rounded-lg border border-line-strong bg-white text-lg leading-none">
          ×
        </button>
      </div>

      <Section title="Khách nhắn tới Page">
        <form onSubmit={sendCustomer} className="flex flex-col gap-2">
          <label htmlFor="sim-persona" className="text-xs text-ink-3">
            Khách
          </label>
          <select id="sim-persona" name="persona" autoComplete="off" value={persona} onChange={(e) => setPersona(e.target.value)} className={`${field} h-9`}>
            {(personas.data?.personas ?? [{ key: 'minh', displayName: 'Facebook: anh Minh' }]).map((p) => (
              <option key={p.key} value={p.key}>
                {p.displayName}
              </option>
            ))}
          </select>
          <label htmlFor="sim-customer-text" className="text-xs text-ink-3">
            Nội dung tin
          </label>
          <textarea id="sim-customer-text" name="customer-text" autoComplete="off" placeholder="Ví dụ: Chào shop, anh đang tìm sofa…" value={customerText} onChange={(e) => setCustomerText(e.target.value)} rows={3} className={`${field} py-2`} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-ink-3">Câu mẫu:</span>
            {CUSTOMER_SAMPLES.map((s) => (
              <button key={s.label} type="button" className={chip} onClick={() => setCustomerText(s.text)}>
                {s.label}
              </button>
            ))}
          </div>
          <button type="submit" className={sendBtn} disabled={customerText.trim() === '' || customer.isPending}>
            Gửi như khách
          </button>
          {customer.isSuccess ? (
            <div role="status" className="text-xs font-semibold text-ok">
              Đã gửi. AI trích xuất sau vài giây.
            </div>
          ) : null}
          {customer.error ? <ErrorBanner error={customer.error} /> : null}
        </form>
      </Section>

      <Section title="Lan trả lời ở Page Inbox">
        <form onSubmit={sendPage} className="flex flex-col gap-2">
          <label htmlFor="sim-target" className="text-xs text-ink-3">
            Hội thoại
          </label>
          <select id="sim-target" name="conversation" autoComplete="off" value={pageTarget} onChange={(e) => setTarget(e.target.value)} className={`${field} h-9`} disabled={list.length === 0}>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
          <label htmlFor="sim-page-text" className="text-xs text-ink-3">
            Nội dung tin
          </label>
          <textarea id="sim-page-text" name="page-text" autoComplete="off" placeholder="Ví dụ: Dạ em chào anh ạ…" value={pageText} onChange={(e) => setPageText(e.target.value)} rows={3} className={`${field} py-2`} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-ink-3">Câu mẫu:</span>
            {LAN_SAMPLES.map((s) => (
              <button key={s.label} type="button" className={chip} onClick={() => setPageText(s.text)}>
                {s.label}
              </button>
            ))}
          </div>
          <button type="submit" className={sendBtn} disabled={pageText.trim() === '' || !pageTarget || page.isPending}>
            Gửi như Lan
          </button>
          {page.isSuccess ? (
            <div role="status" className="text-xs font-semibold text-ok">
              Đã gửi, tin hiện với nhãn Page Inbox.
            </div>
          ) : null}
          {page.error ? <ErrorBanner error={page.error} /> : null}
        </form>
      </Section>

      <Section title="Tua đồng hồ demo">
        <div className="flex flex-col gap-1.5">
          {CLOCK_JUMPS.map((j) => (
            <button key={j.to} type="button" className="h-9 rounded-lg border border-line-strong bg-white px-3 text-left text-sm disabled:opacity-50" disabled={clock.isPending} onClick={() => clock.mutate(j.to)}>
              {j.label}
            </button>
          ))}
        </div>
        <p className="m-0 mt-2 text-xs text-ink-3">Đồng hồ chỉ tiến, không lùi. Muốn làm lại từ đầu, bấm "Đặt lại demo" ở thanh trên.</p>
        {clock.error ? (
          <div className="mt-2">
            <ErrorBanner error={clock.error} />
          </div>
        ) : null}
      </Section>
    </aside>
  );
}
