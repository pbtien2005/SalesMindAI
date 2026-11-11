import type { ConversationDetail, ConversationSummary, Evidence, MessageView, ProposalView } from '../api/types';

export const summary = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: 'c1',
  pageId: 'page-1',
  pageName: 'Nội thất Minh Phát',
  displayName: 'Anh Minh',
  lastMessageAt: '2026-11-13T02:28:00.000Z',
  lastMessageText: 'Cuối tuần này mình ghé xem được không?',
  waitingOn: 'page',
  waitingMinutes: 8,
  followup: { count: 0, max: 5, stopped: false, suggestStop: false, due: false, dueAt: null },
  isP1: false,
  isNew: true,
  ...over,
});

export const msg = (id: string, text: string, over: Partial<MessageView> = {}): MessageView => ({
  id,
  direction: 'inbound',
  senderKind: 'customer',
  text,
  hasAttachment: false,
  sentAt: '2026-11-13T02:12:00.000Z',
  ...over,
});

/** Câu gốc đúng: chọn đoạn `quote` trong `text` của tin `messageId`. */
export const evidenceOf = (messageId: string, text: string, quote: string): Evidence => {
  const start = text.indexOf(quote);
  if (start < 0) throw new Error(`fixture sai: "${quote}" không có trong "${text}"`);
  return { messageId, start, end: start + quote.length, text: quote };
};

export const proposal = (over: Partial<ProposalView> & Pick<ProposalView, 'id' | 'field'>): ProposalView => ({
  value: { text: '' },
  evidence: [],
  flags: [],
  createdAt: '2026-11-13T02:30:00.000Z',
  ...over,
});

export const detail = (over: Partial<ConversationDetail> = {}): ConversationDetail => ({
  summary: summary(),
  reply: { open: true, closesAt: '2026-11-14T02:00:00.000Z', pageActive: true },
  messages: [],
  approved: [],
  autoFill: [],
  box: [],
  tasks: [],
  ...over,
});

import type { Me } from '../api/types';

/** Lan (sale) của doanh nghiệp demo, đúng như `GET /api/auth/me` trả về. */
export const meLan: Me = { id: 'u-lan', email: 'lan@demo.local', displayName: 'Lan', role: 'sale', tenantId: 't-demo', emailVerified: true, demoTenant: true };
export const meHa: Me = { ...meLan, id: 'u-ha', email: 'ha@demo.local', displayName: 'chị Hà', role: 'manager' };
