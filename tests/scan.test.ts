import { beforeEach, describe, expect, it } from 'vitest';
import { ConfluenceClient } from '../src/confluence/client';
import { adfToText, extractCandidates, proposedTitle } from '../src/core/scan';
import { JiraClient } from '../src/jira/client';
import type { HttpResponse } from '../src/jira/client';
import { parseCursor, scanStep, startCursor } from '../src/services/scan';
import { MemoryKv } from '../src/storage/kv';
import { Repo } from '../src/storage/repo';
import { NOW } from './helpers';

function res(status: number, body: unknown = {}): HttpResponse {
  return { status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
}
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...texts: string[]) => ({ type: 'doc', version: 1, content: texts.map(para) });

describe('adfToText', () => {
  it('flattens ADF into lines, keeping mentions and breaks', () => {
    const adf = { type: 'doc', content: [para('First line.'), { type: 'paragraph', content: [{ type: 'mention', attrs: { text: '@Dana' } }, { type: 'text', text: ' will ship it.' }] }] };
    expect(adfToText(adf)).toBe('First line.\n@Dana will ship it.\n');
    expect(adfToText(null)).toBe('');
  });
});

describe('extractCandidates', () => {
  const accounts = [{ id: 'a1', name: 'Acme Retail' }, { id: 'a2', name: 'Northwind' }];
  it('finds promises line by line, resolves the account and flags duplicates', () => {
    const c = extractCandidates(
      {
        sourceType: 'confluence',
        sourceUrl: 'https://x.atlassian.net/wiki/p/1',
        sourceTitle: 'Notes',
        text: 'Call notes\nWe will deliver SSO for Acme Retail before their rollout on 5 Dec.\nThe weather was nice.',
        accountId: null,
      },
      accounts,
      [{ id: 'C-12', accountId: 'a1', title: 'Deliver SSO for Acme Retail before their rollout' }],
      NOW,
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ accountId: 'a1', suggestedClass: 'confirmed', dueDate: '2026-12-05', reviewState: 'unreviewed', suggestedBy: 'rules' });
    expect(c[0]!.duplicateOf[0]?.id).toBe('C-12');
  });
  it('leaves the account empty when no single account is named', () => {
    const c = extractCandidates(
      { sourceType: 'jira', sourceUrl: 'https://x/browse/AB-1', sourceTitle: 'AB-1', text: 'We will send the customer the plan by Friday.', accountId: null },
      accounts, [], NOW,
    );
    expect(c[0]?.accountId).toBeNull();
  });
  it('proposes a short title from the quote', () => {
    expect(proposedTitle("Priya said we'll have the audit log ready by 12 Dec.")).toBe('Have the audit log ready by 12 Dec');
    expect(proposedTitle('We will deliver SSO before rollout.')).toBe('Deliver SSO before rollout');
  });
});

describe('scan service', () => {
  let repo: Repo;
  beforeEach(async () => {
    repo = new Repo(new MemoryKv(), (() => { let n = 0; return (p: string) => `${p}-${++n}`; })());
    await repo.saveAccount({ name: 'Acme Retail', tier: 'enterprise', renewalDate: null, jiraProjectKey: 'ACME', confluenceSpaceKey: 'CS' });
  });

  const jiraPages = (pages: number) => {
    let call = 0;
    return new JiraClient(async (path) => {
      if (path === '/rest/api/3/field') return res(200, []);
      call++;
      const issues = Array.from({ length: 20 }, (_, i) => ({
        key: `ACME-${call * 100 + i}`,
        fields: { summary: `Item ${i}`, description: doc(`We will deliver item ${call}-${i} by 1 Dec.`), comment: { comments: [{ body: doc('Thanks.') }] } },
      }));
      return res(200, { issues, nextPageToken: call < pages ? `t${call}` : undefined, isLast: call >= pages });
    });
  };
  const noConfluence = new ConfluenceClient(async () => res(404));

  it('scans page by page with a cursor and stores candidates once', async () => {
    let step = await scanStep(repo, jiraPages(2), noConfluence, startCursor(['acme'], []), 'https://x.atlassian.net', NOW);
    expect(step.ok && step.data).toMatchObject({ scanned: 20, added: 20, capped: false });
    const cursor = step.ok ? step.data.cursor : null;
    expect(cursor?.queue[0]).toMatchObject({ kind: 'jira', key: 'ACME', token: 't1' });
    step = await scanStep(repo, jiraPages(2), noConfluence, parseCursor(JSON.parse(JSON.stringify(cursor)))!, 'https://x.atlassian.net', NOW);
    const cands = await repo.listCandidates('unreviewed');
    expect(cands.every((c) => c.accountId && c.sourceUrl.startsWith('https://x.atlassian.net/browse/ACME-'))).toBe(true);
    // Re-scanning the same first page adds nothing new.
    const again = await scanStep(repo, jiraPages(1), noConfluence, startCursor(['ACME'], []), 'https://x.atlassian.net', NOW);
    expect(again.ok && again.data.added).toBe(0);
  });

  it('O21: stops at 50 new candidates and says it was capped', async () => {
    let cursor = startCursor(['ACME'], []);
    const jira = jiraPages(5);
    let last;
    for (let i = 0; i < 5 && cursor; i++) {
      last = await scanStep(repo, jira, noConfluence, cursor, 'https://x.atlassian.net', NOW);
      if (!last.ok) throw new Error(last.message);
      cursor = last.data.cursor!;
    }
    expect(last!.ok && last!.data).toMatchObject({ capped: true, cursor: null });
    expect(await repo.listCandidates()).toHaveLength(50);
  });

  it('O20: a space the user cannot see is skipped with a note, not an error', async () => {
    const step = await scanStep(repo, jiraPages(1), noConfluence, startCursor([], ['SECRET']), 'https://x.atlassian.net', NOW);
    expect(step.ok && step.data).toMatchObject({ skipped: ['Confluence SECRET'], cursor: null });
  });

  it('rejects tampered cursors', () => {
    expect(parseCursor({ queue: [{ kind: 'jira', key: 'bad key"' }], scanned: 0, added: 0, skipped: [] })).toBeNull();
    expect(parseCursor('x')).toBeNull();
  });
});

describe('review', () => {
  let repo: Repo;
  beforeEach(async () => {
    repo = new Repo(new MemoryKv());
    await repo.seedDemo(NOW);
  });
  const actor = { accountId: 'u1' };

  it('demo seed puts the five section P snippets in the inbox, one per class at least', async () => {
    const c = await repo.listCandidates('unreviewed');
    expect(c).toHaveLength(5);
    expect(new Set(c.map((x) => x.suggestedClass))).toEqual(new Set(['confirmed', 'possible', 'suggestion', 'ambiguous']));
  });

  it('confirm creates a commitment with the quote as evidence; it cannot be confirmed twice', async () => {
    const cand = (await repo.listCandidates()).find((c) => c.quote.includes('audit log'))!;
    const r = await repo.reviewCandidate(cand.id, 'confirm', { title: 'Audit log ready' }, actor, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.commitment).toMatchObject({ title: 'Audit log ready', accountId: 'acct-acme', dueDate: '2026-12-12', dueDateSource: 'stated' });
    const ev = await repo.listEvidence(r.data.commitment!.id);
    expect(ev[0]).toMatchObject({ quote: cand.quote, sourceUrl: cand.sourceUrl });
    expect((await repo.reviewCandidate(cand.id, 'confirm', {}, actor, NOW)).ok).toBe(false);
  });

  it('reject needs a reason; ambiguous stays reviewable; O10 nothing auto-confirms', async () => {
    const cands = await repo.listCandidates();
    const amb = cands.find((c) => c.suggestedClass === 'ambiguous')!;
    expect(amb.reviewState).toBe('unreviewed');
    expect((await repo.reviewCandidate(amb.id, 'reject', {}, actor, NOW)).ok).toBe(false);
    const marked = await repo.reviewCandidate(amb.id, 'ambiguous', {}, actor, NOW);
    expect(marked.ok && marked.data.candidate.reviewState).toBe('ambiguous');
    const rej = await repo.reviewCandidate(amb.id, 'reject', { reason: 'Internal note' }, actor, NOW);
    expect(rej.ok && rej.data.candidate).toMatchObject({ reviewState: 'rejected', rejectReason: 'Internal note' });
  });

  it('confirm without an account asks for one', async () => {
    await repo.saveCandidates([{ ...(await repo.listCandidates())[0]!, id: 'orphan', accountId: null }]);
    const r = await repo.reviewCandidate('orphan', 'confirm', {}, actor, NOW);
    expect(!r.ok && r.message).toMatch(/Choose the account/);
  });
});

describe('scan ignores Tally-written text', () => {
  it('skips the description of issues Tally created', async () => {
    const repo = new Repo(new MemoryKv());
    await repo.saveAccount({ name: 'Acme Retail', tier: 'enterprise', renewalDate: null, jiraProjectKey: 'ACME' });
    const jira = new JiraClient(async (path) => {
      if (path === '/rest/api/3/field') return res(200, []);
      return res(200, {
        isLast: true,
        issues: [{ key: 'ACME-1', fields: { summary: 'Weekly sync', description: doc('Delivers a customer commitment tracked in Tally for Acme Retail: "We will ship SSO by 1 Dec" (cmt-1).'), comment: { comments: [] } } }],
      });
    });
    const step = await scanStep(repo, jira, new ConfluenceClient(async () => res(404)), startCursor(['ACME'], []), 'https://x.atlassian.net', NOW);
    expect(step.ok && step.data.added).toBe(0);
  });
});
