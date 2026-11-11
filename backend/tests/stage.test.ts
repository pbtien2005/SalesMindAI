import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { profileFields } from '../src/db/schema.js';
import { loadConversationSummaries } from '../src/followup/overview.js';
import { addMessage, addProposal, addRun, seedBase } from './helpers/fixtures.js';
import { openTestDb, truncateAll } from './helpers/test-db.js';

const handle = openTestDb();
const { db } = handle;
beforeEach(() => truncateAll(handle));
afterAll(() => handle.close());

const NOW = new Date('2026-11-13T02:41:00Z');

async function setup() {
  const base = await seedBase(db, { aiEnabled: true });
  const m = await addMessage(db, base, { text: 'Cuối tuần này anh ghé', sentAt: new Date('2026-11-13T02:40:00Z') });
  const run = await addRun(db, base, m);
  return { ...base, run };
}
async function put(base: { tenantId: string; conversationId: string; pageId: string; run: string }, field: 'timeline' | 'phone', value: object) {
  const proposalId = await addProposal(db, base, base.run, { field, value, status: 'accepted' });
  await db.insert(profileFields).values({ tenantId: base.tenantId, conversationId: base.conversationId, field, value, proposalId, updatedAt: NOW });
}
const stage = async (base: { tenantId: string }, now = NOW) => (await loadConversationSummaries(db, base.tenantId, now))[0]!;

describe('giai đoạn khách (stage, nextContact)', () => {
  it('chưa có SĐT đã duyệt và chưa bám: new', async () => {
    const base = await setup();
    const s = await stage(base);
    expect(s.stage).toBe('new');
    expect(s.nextContact).toBeNull();
  });

  it('có SĐT đã duyệt, chưa hẹn: chasing', async () => {
    const base = await setup();
    await put(base, 'phone', { text: '0912345678' });
    expect((await stage(base)).stage).toBe('chasing');
  });

  it('mốc hẹn đã duyệt còn ở tương lai: tracking, nextContact đúng giờ hẹn; quá giờ thì trở lại', async () => {
    const base = await setup();
    await put(base, 'timeline', { text: 'cuối tuần này', chosenAt: '2026-11-14T03:00:00.000Z' });
    const s = await stage(base);
    expect(s.stage).toBe('tracking');
    expect(s.nextContact?.at.toISOString()).toBe('2026-11-14T03:00:00.000Z');
    expect(s.nextContact?.reason).toBe('Ngày hẹn đã xác nhận (ưu tiên 1)');
    const later = await stage(base, new Date('2026-11-14T03:00:01Z'));
    expect(later.stage).toBe('new');
    expect(later.nextContact).toBeNull();
  });
});
