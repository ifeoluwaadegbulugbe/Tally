// Customer updates (T15: F-40, F-41, O9): draft from stored facts, edit, approve, mark sent,
// with who and when; approval refused if facts moved; sent marks delivered items communicated.
import { beforeEach, describe, expect, it } from 'vitest';
import { draftCustomerUpdate } from '../src/agent/actions';
import { MemoryKv } from '../src/storage/kv';
import { Repo } from '../src/storage/repo';
import { NOW } from './helpers';

const PRIYA = { accountId: 'u-priya' };
const SAM = { accountId: 'u-sam' };
let repo: Repo;
let acme: string;

beforeEach(async () => {
  repo = new Repo(new MemoryKv());
  await repo.seedDemo(NOW);
  acme = (await repo.listAccounts()).find((a) => a.name === 'Acme Retail')!.id;
});

describe('customer update drafts', () => {
  it('F-40: drafts from stored commitments only and lists the IDs used', async () => {
    const r = await repo.createDraft(acme, undefined, PRIYA, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const acmeIds = (await repo.listCommitments({ accountId: acme })).filter((c) => c.status !== 'cancelled').map((c) => c.id).sort();
    expect([...r.data.commitmentIds].sort()).toEqual(acmeIds);
    expect(r.data).toMatchObject({ status: 'draft', source: 'ui', createdBy: 'u-priya', version: 1 });
    expect(r.data.body).toContain('Hello Acme Retail team');
    expect(r.data.body).not.toMatch(/DEMO-\d+/);
    for (const id of r.data.commitmentIds) expect(r.data.usedVersions[id]).toBeTypeOf('number');
    expect((await repo.listDrafts(acme)).map((d) => d.id)).toEqual([r.data.id]);
  });

  it('rejects unknown accounts and commitments from another account', async () => {
    expect((await repo.createDraft('nope', undefined, PRIYA, NOW)).ok).toBe(false);
    const r = await repo.createDraft(acme, ['c-nw-ehr'], PRIYA, NOW);
    expect(!r.ok && r.code).toBe('not_found');
  });

  it('F-41: edit, approve, mark sent records who and when; text freezes after approval', async () => {
    const d = (await repo.createDraft(acme, undefined, PRIYA, NOW)) as { ok: true; data: { id: string; version: number } };
    const later = new Date(NOW.getTime() + 60_000);
    const edited = await repo.editDraft(d.data.id, 'Hello Acme,\n\nShort version.', 1, SAM, later);
    expect(edited.ok && edited.data).toMatchObject({ body: 'Hello Acme,\n\nShort version.', editedBy: 'u-sam', version: 2 });
    expect((await repo.editDraft(d.data.id, '', 2, SAM, later)).ok).toBe(false);
    const stale = await repo.approveDraft(d.data.id, 1, PRIYA, later);
    expect(!stale.ok && stale.code).toBe('conflict'); // old version
    const approved = await repo.approveDraft(d.data.id, 2, PRIYA, later);
    expect(approved.ok && approved.data).toMatchObject({ status: 'approved', approvedBy: 'u-priya', approvedAt: later.toISOString() });
    const frozen = await repo.editDraft(d.data.id, 'changed', 3, SAM, later);
    expect(!frozen.ok && frozen.message).toMatch(/frozen/);
    const sent = await repo.markDraftSent(d.data.id, 3, SAM, later);
    expect(sent.ok && sent.data.draft).toMatchObject({ status: 'sent', sentBy: 'u-sam', sentAt: later.toISOString() });
    const discard = await repo.discardDraft(d.data.id, 4);
    expect(!discard.ok && discard.message).toMatch(/record/);
  });

  it('mark sent needs approval first', async () => {
    const d = await repo.createDraft(acme, undefined, PRIYA, NOW);
    const r = await repo.markDraftSent(d.ok ? d.data.id : '', 1, PRIYA, NOW);
    expect(!r.ok && r.message).toMatch(/Approve/);
  });

  it('approval is refused when a commitment changed after drafting', async () => {
    const d = await repo.createDraft(acme, ['c-acme-sso'], PRIYA, NOW);
    if (!d.ok) throw new Error('draft failed');
    const c = (await repo.getCommitment('c-acme-sso'))!;
    await repo.updateCommitment('c-acme-sso', { ownerAccountId: 'u-sam' }, c.version, SAM, NOW);
    expect(await repo.staleCommitments(d.data)).toEqual(['c-acme-sso']);
    const r = await repo.approveDraft(d.data.id, 1, PRIYA, NOW);
    expect(!r.ok && r.code).toBe('conflict');
    expect(!r.ok && r.message).toMatch(/new draft/);
  });

  it('O9: a sent update moves the delivered commitments it covers to communicated, with history', async () => {
    const delivered = (await repo.listCommitments()).find((c) => c.status === 'delivered');
    expect(delivered).toBeDefined();
    const d = await repo.createDraft(delivered!.accountId, [delivered!.id], PRIYA, NOW);
    if (!d.ok) throw new Error('draft failed');
    await repo.approveDraft(d.data.id, 1, PRIYA, NOW);
    const sent = await repo.markDraftSent(d.data.id, 2, PRIYA, NOW);
    expect(sent.ok && sent.data.communicated).toEqual([delivered!.id]);
    const after = (await repo.getCommitment(delivered!.id))!;
    expect(after.status).toBe('communicated');
    const hist = await repo.listHistory(delivered!.id);
    expect(hist.some((h) => h.field === 'status' && h.to === 'communicated' && String(h.reason).includes(d.data.id))).toBe(true);
  });

  it('open commitments stay as they are when an update is sent', async () => {
    const d = await repo.createDraft(acme, ['c-acme-sso'], PRIYA, NOW);
    if (!d.ok) throw new Error('draft failed');
    await repo.approveDraft(d.data.id, 1, PRIYA, NOW);
    const sent = await repo.markDraftSent(d.data.id, 2, PRIYA, NOW);
    expect(sent.ok && sent.data.communicated).toEqual([]);
    expect((await repo.getCommitment('c-acme-sso'))!.status).not.toBe('communicated');
  });

  it('a draft can be discarded before it is sent', async () => {
    const d = await repo.createDraft(acme, undefined, PRIYA, NOW);
    if (!d.ok) throw new Error('draft failed');
    expect((await repo.discardDraft(d.data.id, 1)).ok).toBe(true);
    expect(await repo.listDrafts()).toEqual([]);
  });

  it('the agent action saves its draft for approval in Tally, as the asking user', async () => {
    const r = await draftCustomerUpdate({ account: 'acme retail' }, { repo, actor: PRIYA, now: NOW, names: async () => ({}) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const saved = await repo.getDraft(r.data.draftId);
    expect(saved).toMatchObject({ status: 'draft', source: 'agent', createdBy: 'u-priya' });
    expect(r.data.usedCommitmentIds).toEqual(saved!.commitmentIds);
    expect(r.data.note).toMatch(/Updates/);
  });

  it('delete-all removes drafts too', async () => {
    await repo.createDraft(acme, undefined, PRIYA, NOW);
    await repo.deleteAll();
    expect(await repo.listDrafts()).toEqual([]);
  });
});
