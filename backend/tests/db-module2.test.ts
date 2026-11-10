import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { extractionRuns, profileFields, proposals, tasks, tenants } from '../src/db/schema.js';
import { addConversation, addMessage, addProposal, addRun, seedBase } from './helpers/fixtures.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;

beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

const T0 = new Date('2026-11-12T02:00:00Z');

describe('schema Module 2', () => {
  it('AI mặc định TẮT cho tenant mới', async () => {
    const [t] = await db.insert(tenants).values({ name: 'x' }).returning();
    expect(t!.aiExtractionEnabled).toBe(false);
    expect(t!.aiEnabledAt).toBeNull();
  });

  it('chỉ có một đề xuất pending cho mỗi (hội thoại, trường); đề xuất cũ đã đóng thì thêm được', async () => {
    const base = await seedBase(db);
    const m = await addMessage(db, base, { text: 'a', sentAt: T0 });
    const run = await addRun(db, base, m);
    await addProposal(db, base, run, { field: 'budget' });
    await expect(addProposal(db, base, run, { field: 'budget' })).rejects.toThrow();
    // Trường khác thì được.
    await addProposal(db, base, run, { field: 'customer_name' });
    // Đóng đề xuất cũ rồi thêm mới.
    await db.update(proposals).set({ status: 'superseded' }).where(eq(proposals.field, 'budget'));
    await addProposal(db, base, run, { field: 'budget' });
  });

  it('khóa idempotency: cùng (hội thoại, tin cuối, phiên bản prompt) chỉ có một run', async () => {
    const base = await seedBase(db);
    const m = await addMessage(db, base, { text: 'a', sentAt: T0 });
    await addRun(db, base, m, 'v1');
    await expect(addRun(db, base, m, 'v1')).rejects.toThrow();
    await addRun(db, base, m, 'v2'); // phiên bản khác thì được
  });

  it('khóa ngoại ghép tenant: không gắn đề xuất vào hội thoại của tenant khác', async () => {
    const a = await seedBase(db);
    const b = await seedBase(db);
    const m = await addMessage(db, a, { text: 'a', sentAt: T0 });
    const run = await addRun(db, a, m);
    await expect(
      db.insert(proposals).values({ tenantId: b.tenantId, conversationId: a.conversationId, runId: run, field: 'budget', value: {} }),
    ).rejects.toThrow();
  });

  it('khóa ngoại ghép tenant: không tạo run, việc hay hồ sơ cho hội thoại của tenant khác', async () => {
    const a = await seedBase(db);
    const b = await seedBase(db);
    const m = await addMessage(db, a, { text: 'a', sentAt: T0 });
    await expect(
      db.insert(extractionRuns).values({ tenantId: b.tenantId, conversationId: a.conversationId, upToMessageId: m, promptVersion: 'v', model: 'm', status: 'succeeded' }),
    ).rejects.toThrow();
    await expect(
      db.insert(tasks).values({ tenantId: b.tenantId, conversationId: a.conversationId, title: 'x', dueAt: T0 }),
    ).rejects.toThrow();
    const run = await addRun(db, a, m);
    const p = await addProposal(db, a, run, { field: 'budget' });
    await expect(
      db.insert(profileFields).values({ conversationId: a.conversationId, tenantId: b.tenantId, field: 'budget', value: {}, proposalId: p }),
    ).rejects.toThrow();
  });

  it('hồ sơ đã duyệt: một dòng cho mỗi (hội thoại, trường)', async () => {
    const base = await seedBase(db);
    const m = await addMessage(db, base, { text: 'a', sentAt: T0 });
    const run = await addRun(db, base, m);
    const p = await addProposal(db, base, run, { field: 'customer_name' });
    await db.insert(profileFields).values({ conversationId: base.conversationId, tenantId: base.tenantId, field: 'customer_name', value: { text: 'Minh' }, proposalId: p });
    await expect(
      db.insert(profileFields).values({ conversationId: base.conversationId, tenantId: base.tenantId, field: 'customer_name', value: { text: 'Nam' }, proposalId: p }),
    ).rejects.toThrow();
  });

  it('hai hội thoại cùng tenant có đề xuất pending riêng cho cùng một trường', async () => {
    const a = await seedBase(db);
    const b = await addConversation(db, a, 'psid-2');
    const ma = await addMessage(db, a, { text: 'a', sentAt: T0 });
    const mb = await addMessage(db, b, { text: 'b', sentAt: T0 });
    await addProposal(db, a, await addRun(db, a, ma), { field: 'budget' });
    await addProposal(db, b, await addRun(db, b, mb), { field: 'budget' });
  });
});
