/**
 * Service duyệt đề xuất: nơi DUY NHẤT được ghi `profile_fields` (dữ liệu đã duyệt).
 *
 * Quy tắc:
 * - Chỉ đề xuất đang `pending` mới quyết định được; hai quyết định đồng thời cho cùng một đề xuất thì chỉ một cái thắng.
 * - `timeline` có cờ `needs_clarification` (cụm tương đối hoặc mơ hồ) KHÔNG duyệt được nếu Sale chưa chọn ngày giờ
 *   (`chosenAt`). Hệ thống không bao giờ tự điền ngày.
 * - Duyệt `timeline` có `chosenAt` thì tạo việc "Khách hẹn ghé xem" đúng vào thời điểm Sale chọn.
 */
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { profileFields, proposals, tasks } from '../db/schema.js';
import { NEEDS_CLARIFICATION, type ProposalValue } from './types.js';

export type ProposalErrorCode = 'not_found' | 'not_pending' | 'needs_date' | 'invalid';

export class ProposalError extends Error {
  override readonly name = 'ProposalError';
  constructor(
    readonly code: ProposalErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type DecideAction = 'accept' | 'edit' | 'dismiss';

export interface DecideInput {
  tenantId: string;
  proposalId: string;
  action: DecideAction;
  /** Ai quyết định (tên hiển thị), ghi vào lịch sử. */
  by: string;
  /** Bắt buộc với `edit`. */
  editedText?: string | undefined;
  /** ISO 8601 có múi giờ. Bắt buộc khi duyệt `timeline` có cờ `needs_clarification`. */
  chosenAt?: string | undefined;
}

export interface DecideResult {
  proposalId: string;
  field: string;
  status: 'accepted' | 'edited' | 'dismissed';
  /** Giá trị đã duyệt (không có khi `dismiss`). */
  value?: ProposalValue;
  taskId?: string;
}

const isoWithOffset = z.string().datetime({ offset: true });
const APPOINTMENT_TASK = 'Khách hẹn ghé xem';
const MAX_TEXT = 200;

export async function decideProposal(db: Db, input: DecideInput, now: Date): Promise<DecideResult> {
  const by = input.by.trim();
  if (by === '') throw new ProposalError('invalid', 'Thiếu tên người quyết định.');

  return db.transaction(async (tx) => {
    // Khóa dòng: quyết định đồng thời cho cùng một đề xuất sẽ xếp hàng, cái sau thấy trạng thái đã đổi.
    const [p] = await tx
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, input.proposalId), eq(proposals.tenantId, input.tenantId)))
      .for('update');
    if (!p) throw new ProposalError('not_found', 'Không có đề xuất này.');
    if (p.status !== 'pending') throw new ProposalError('not_pending', `Đề xuất đã ở trạng thái ${p.status}, không quyết định lại được.`);

    // Lớp phòng thủ thứ hai (ngoài khóa dòng): chỉ đổi trạng thái khi nó VẪN là pending, và phải trúng đúng một dòng.
    const close = async (set: Partial<typeof proposals.$inferInsert>) => {
      const rows = await tx
        .update(proposals)
        .set(set)
        .where(and(eq(proposals.id, p.id), eq(proposals.status, 'pending')))
        .returning({ id: proposals.id });
      if (rows.length !== 1) throw new ProposalError('not_pending', 'Đề xuất vừa được quyết định ở nơi khác.');
    };

    if (input.action === 'dismiss') {
      await close({ status: 'dismissed', decidedBy: by, decidedAt: now });
      return { proposalId: p.id, field: p.field, status: 'dismissed' };
    }

    const original = p.value as ProposalValue;
    let value: ProposalValue = { ...original };
    if (input.action === 'edit') {
      const text = input.editedText?.trim() ?? '';
      if (text === '' || text.length > MAX_TEXT) throw new ProposalError('invalid', `Giá trị sửa phải có từ 1 đến ${MAX_TEXT} ký tự.`);
      value = { ...original, text };
    }

    // Mốc thời gian mơ hồ: Sale phải chọn ngày giờ.
    let chosenAt: Date | null = null;
    if (p.field === 'timeline') {
      const needsDate = p.flags.includes(NEEDS_CLARIFICATION);
      if (input.chosenAt !== undefined) {
        if (!isoWithOffset.safeParse(input.chosenAt).success) throw new ProposalError('invalid', 'Ngày giờ phải theo dạng ISO 8601 có múi giờ.');
        chosenAt = new Date(input.chosenAt);
      } else if (needsDate) {
        throw new ProposalError('needs_date', 'Mốc thời gian này chưa có ngày cụ thể: Sale phải chọn ngày giờ trước khi duyệt.');
      }
    } else if (input.chosenAt !== undefined) {
      throw new ProposalError('invalid', 'Chỉ mốc thời gian (timeline) mới có ngày giờ.');
    }
    const decided = (chosenAt ? { ...value, chosenAt: chosenAt.toISOString() } : value) as ProposalValue & { chosenAt?: string };
    const status = input.action === 'edit' ? 'edited' : 'accepted';

    await close({ status, decidedValue: decided, decidedBy: by, decidedAt: now });
    await tx
      .insert(profileFields)
      .values({ conversationId: p.conversationId, field: p.field, tenantId: p.tenantId, value: decided, proposalId: p.id, updatedAt: now })
      .onConflictDoUpdate({
        target: [profileFields.conversationId, profileFields.field],
        // Mỗi lần ghi đè giá trị đã duyệt, `version` tăng 1.
        set: { value: decided, proposalId: p.id, updatedAt: now, version: sql`${profileFields.version} + 1` },
      });

    let taskId: string | undefined;
    if (chosenAt) {
      // Một lịch hẹn đang mở cho mỗi hội thoại: lịch cũ được đóng khi Sale chọn lịch mới.
      await tx
        .update(tasks)
        .set({ doneAt: now })
        .where(and(eq(tasks.conversationId, p.conversationId), eq(tasks.source, 'appointment')));
      const [t] = await tx
        .insert(tasks)
        .values({ tenantId: p.tenantId, conversationId: p.conversationId, title: APPOINTMENT_TASK, dueAt: chosenAt, source: 'appointment' })
        .returning({ id: tasks.id });
      taskId = t!.id;
    }
    return { proposalId: p.id, field: p.field, status, value: decided, ...(taskId ? { taskId } : {}) };
  });
}

export interface PendingProposal {
  id: string;
  field: string;
  value: ProposalValue;
  evidence: unknown;
  flags: string[];
  createdAt: Date;
}

/** Đề xuất đang chờ của một hội thoại, mới nhất trước. */
export async function listPending(db: Db, tenantId: string, conversationId: string): Promise<PendingProposal[]> {
  const rows = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.tenantId, tenantId), eq(proposals.conversationId, conversationId), eq(proposals.status, 'pending')))
    .orderBy(proposals.createdAt);
  return rows.map((r) => ({ id: r.id, field: r.field, value: r.value as ProposalValue, evidence: r.evidence, flags: r.flags, createdAt: r.createdAt }));
}
