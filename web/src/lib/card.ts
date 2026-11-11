/**
 * Dựng các dòng của "Thẻ khách" từ chi tiết hội thoại. Hàm thuần, không gọi API.
 *
 * Ưu tiên: dữ liệu đã duyệt > AI tự điền (trường nhẹ, chưa duyệt) > đang chờ trong Hộp đề xuất > thiếu.
 * Mốc thời gian mơ hồ (cờ `needs_clarification`) KHÔNG bao giờ có ngày cho tới khi Sale chọn: trạng thái `needs_date`.
 */
import { formatDateTime, formatPhoneDisplay } from '../api/format';
import { NEEDS_CLARIFICATION, type ApprovedView, type ConversationDetail, type Evidence, type ProposalView } from '../api/types';
import { CARD_FIELDS, fieldLabel } from './fields';

export type RowState = 'approved' | 'ai' | 'pending_review' | 'needs_date' | 'missing';

export interface CardRow {
  field: string;
  label: string;
  state: RowState;
  /** Giá trị hiển thị (rỗng nếu thiếu). */
  text: string;
  /** `approved`: người duyệt, lúc duyệt, và đã sửa hay duyệt nguyên. */
  decidedBy?: string | null;
  decidedAt?: string;
  edited?: boolean;
  /** `ai`: câu gốc đã kiểm chứng của đề xuất. */
  evidence: Evidence[];
  /** `ai`: id đề xuất, để Sale sửa giá trị AI điền sai. */
  proposalId?: string;
}

function approvedText(a: ApprovedView): string {
  if (a.field === 'timeline' && a.value.chosenAt) return formatDateTime(a.value.chosenAt);
  if (a.field === 'phone') return formatPhoneDisplay(a.value.text);
  return a.value.text;
}

export function buildCardRows(detail: ConversationDetail): CardRow[] {
  const approved = new Map<string, ApprovedView>(detail.approved.map((a) => [a.field, a]));
  const ai = new Map<string, ProposalView>(detail.autoFill.map((p) => [p.field, p]));
  const inBox = new Map<string, ProposalView>();
  for (const b of detail.box) {
    if (b.kind !== 'proposal') continue;
    // Mốc hẹn giữ ở Hộp đề xuất (bắt buộc chọn ngày); SĐT, địa chỉ... hiện như dòng AI điền, duyệt chung ở Thẻ khách.
    if (b.field === 'timeline') inBox.set(b.field, b);
    else if (!ai.has(b.field)) ai.set(b.field, b);
  }

  return CARD_FIELDS.map((field): CardRow => {
    const label = fieldLabel(field);
    const a = approved.get(field);
    if (a) {
      return { field, label, state: 'approved', text: approvedText(a), decidedBy: a.decidedBy, decidedAt: a.updatedAt, edited: a.status === 'edited', evidence: [] };
    }
    const p = ai.get(field);
    if (p) return { field, label, state: 'ai', text: field === 'phone' ? formatPhoneDisplay(p.value.text) : p.value.text, evidence: p.evidence, proposalId: p.id };

    const pending = inBox.get(field);
    if (pending) {
      const vague = pending.flags.includes(NEEDS_CLARIFICATION);
      return { field, label, state: vague ? 'needs_date' : 'pending_review', text: '', evidence: [] };
    }
    return { field, label, state: 'missing', text: '', evidence: [] };
  });
}

/** Mọi câu gốc đang chờ (trường nhẹ và Hộp đề xuất), để tô trong khung chat. */
export function allEvidence(detail: ConversationDetail): Evidence[] {
  const out: Evidence[] = detail.autoFill.flatMap((p) => p.evidence);
  for (const b of detail.box) if (b.kind === 'proposal') out.push(...b.evidence);
  return out;
}
