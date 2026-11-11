import { useCallback, useEffect, useRef, useState } from 'react';
import { INBOX_STEP, useConversation, useInbox } from '../api/hooks';
import { useSession } from '../state/session';
import { ChatPane } from './ChatPane';
import { CustomerCard } from './CustomerCard';
import { ErrorBanner } from './ErrorBanner';
import { InboxList } from './InboxList';
import { Main } from './Main';
import { HistoryPanel } from './HistoryPanel';
import { ProposalBox } from './ProposalBox';

/** Màn Hội thoại: danh sách | khung chat | Hộp đề xuất và thẻ khách. */
export function ChatView() {
  const { conversationId, selectConversation } = useSession();
  const [pageId, setPageId] = useState('');
  const [target, setTarget] = useState(INBOX_STEP);
  const inbox = useInbox(pageId || undefined, target);
  const list = inbox.data?.conversations ?? [];
  // Các Page đã thấy trong hộp thư (nhớ cả khi đang lọc một Page, để bộ lọc không tự mất lựa chọn).
  const [knownPages, setKnownPages] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const add = list.filter((c) => c.pageName && !knownPages.has(c.pageId));
    if (add.length > 0) setKnownPages((m) => new Map([...m, ...add.map((c) => [c.pageId, c.pageName] as const)]));
  }, [list, knownPages]);
  const pageOptions = [...knownPages].map(([id, name]) => ({ id, name }));

  // Chưa chọn (hoặc hội thoại đã chọn không còn sau khi đặt lại demo) thì mở hội thoại đầu tiên.
  const effectiveId = list.some((c) => c.id === conversationId) ? conversationId : (list[0]?.id ?? null);
  const detail = useConversation(effectiveId);

  // Giữ phiên đồng bộ với hội thoại đang hiển thị (Bảng Giả lập dựa vào đó để chọn sẵn hội thoại).
  useEffect(() => {
    if (effectiveId !== null && effectiveId !== conversationId) selectConversation(effectiveId);
  }, [effectiveId, conversationId, selectConversation]);

  const [flashId, setFlashId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const jump = useCallback((messageId: string) => {
    clearTimeout(timer.current);
    setFlashId(messageId);
    timer.current = setTimeout(() => setFlashId(null), 2000);
  }, []);

  if (inbox.error) {
    return (
      <Main title="Hội thoại" className="p-6">
        <ErrorBanner error={inbox.error} />
      </Main>
    );
  }
  if (!inbox.data) {
    return (
      <Main title="Hội thoại" className="p-6 text-ink-3">
        Đang tải hộp thư…
      </Main>
    );
  }

  return (
    <Main title="Hội thoại" className="flex min-h-0">
      <InboxList
        conversations={list}
        now={inbox.data.now}
        selectedId={effectiveId}
        onSelect={selectConversation}
        pages={pageOptions}
        pageId={pageId}
        onPageChange={(id) => {
          setPageId(id);
          setTarget(INBOX_STEP);
        }}
        hasMore={inbox.data.hasMore}
        onLoadMore={() => setTarget((t) => t + INBOX_STEP)}
      />
      {detail.data ? (
        <>
          {/* key: trạng thái cục bộ (bản nháp, hộp xác nhận) không được rò sang hội thoại khác */}
          <ChatPane key={detail.data.summary.id} detail={detail.data} flashId={flashId} />
          <aside aria-label="Thông tin khách" className="flex w-[360px] flex-none flex-col overflow-auto border-l border-line bg-white">
            <ProposalBox conversationId={detail.data.summary.id} items={detail.data.box} messages={detail.data.messages} onJump={jump} />
            <CustomerCard detail={detail.data} onJump={jump} />
            <HistoryPanel conversationId={detail.data.summary.id} messages={detail.data.messages} onJump={jump} />
          </aside>
        </>
      ) : (
        <div className="min-w-0 grow p-6">
          {detail.error ? <ErrorBanner error={detail.error} /> : <p className="text-ink-3">{effectiveId ? 'Đang tải hội thoại…' : 'Khi có khách nhắn tới, cuộc trò chuyện sẽ hiện ở đây.'}</p>}
        </div>
      )}
    </Main>
  );
}
