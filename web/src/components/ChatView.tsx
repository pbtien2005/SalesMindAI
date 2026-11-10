import { useCallback, useEffect, useRef, useState } from 'react';
import { useConversation, useInbox } from '../api/hooks';
import { useSession } from '../state/session';
import { ChatPane } from './ChatPane';
import { CustomerCard } from './CustomerCard';
import { ErrorBanner } from './ErrorBanner';
import { InboxList } from './InboxList';
import { ProposalBox } from './ProposalBox';

/** Màn Hội thoại: danh sách | khung chat | Hộp đề xuất và thẻ khách. */
export function ChatView() {
  const { role, conversationId, selectConversation } = useSession();
  const inbox = useInbox();
  const list = inbox.data?.conversations ?? [];

  // Chưa chọn (hoặc hội thoại đã chọn không còn sau khi đặt lại demo) thì mở hội thoại đầu tiên.
  const effectiveId = list.some((c) => c.id === conversationId) ? conversationId : (list[0]?.id ?? null);
  const detail = useConversation(effectiveId);

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
      <div className="min-w-0 grow p-6">
        <ErrorBanner error={inbox.error} />
      </div>
    );
  }
  if (!inbox.data) return <div className="p-6 text-ink-3">Đang tải hộp thư…</div>;

  return (
    <div className="flex min-h-0 min-w-0 grow">
      <InboxList conversations={list} now={inbox.data.now} selectedId={effectiveId} onSelect={selectConversation} />
      {detail.data ? (
        <>
          <ChatPane detail={detail.data} role={role} flashId={flashId} />
          <aside aria-label="Thông tin khách" className="flex w-[360px] flex-none flex-col overflow-auto border-l border-line bg-white">
            <ProposalBox conversationId={detail.data.summary.id} items={detail.data.box} messages={detail.data.messages} onJump={jump} />
            <CustomerCard detail={detail.data} onJump={jump} />
          </aside>
        </>
      ) : (
        <div className="min-w-0 grow p-6">
          {detail.error ? <ErrorBanner error={detail.error} /> : <p className="text-ink-3">{effectiveId ? 'Đang tải hội thoại…' : 'Khi có khách nhắn tới, cuộc trò chuyện sẽ hiện ở đây.'}</p>}
        </div>
      )}
    </div>
  );
}
