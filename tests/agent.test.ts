// The blueprint's six-step Rovo test script (section I, O22-O24), run against the action
// functions with demo data. Live Rovo chat checks the same paths end to end.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ROVO_CHAT_SOURCE,
  draftCustomerUpdate,
  explainRisk,
  findCommitments,
  getAccountHealth,
  matchAccount,
  proposeCandidate,
} from '../src/agent/actions';
import type { AgentDeps } from '../src/agent/actions';
import { MemoryKv } from '../src/storage/kv';
import { Repo } from '../src/storage/repo';
import { NOW } from './helpers';

let d: AgentDeps;
beforeEach(async () => {
  const repo = new Repo(new MemoryKv());
  await repo.seedDemo(NOW);
  d = { repo, actor: { accountId: 'demo-priya' }, now: NOW, names: async () => ({ 'demo-priya': 'Priya', 'demo-sam': 'Sam', 'demo-lee': 'Lee', 'demo-dana': 'Dana' }) };
});

describe('Rovo test script', () => {
  it('1. "Which commitments are at risk?" returns the seeded list with IDs, worst first', async () => {
    const r = await findCommitments({ health: 'at_risk' }, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.commitments.map((c) => c.id).sort()).toEqual(['c-acme-onboarding', 'c-bf-training', 'c-nw-ehr']);
    const critical = await findCommitments({ health: 'critical' }, d);
    expect(critical.ok && critical.data.commitments[0]!.id).toBe('c-nw-export');
  });

  it('2. "Why is Northwind\'s integration at risk?" returns R5 with the issue key', async () => {
    const r = await explainRisk({ commitmentId: 'c-nw-ehr' }, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.signals.map((s) => s.rule)).toEqual(expect.arrayContaining(['R5', 'R6']));
    expect(r.data.signals.find((s) => s.rule === 'R5')!.reason).toBe('DEMO-21 is blocked.');
    expect(r.data.linkedIssues[0]).toMatchObject({ key: 'DEMO-21', flagged: true });
    expect(r.data.evidence[0]!.quote).toContain('EHR integration');
  });

  it('3. "Which commitments have no owner?" returns the Acme SSO item', async () => {
    const r = await findCommitments({ owner: 'unassigned' }, d);
    expect(r.ok && r.data.commitments.map((c) => c.id)).toEqual(['c-acme-sso']);
    const mine = await findCommitments({ owner: 'me' }, d);
    expect(mine.ok && mine.data.commitments.every((c) => c.owner === 'Priya')).toBe(true);
  });

  it('4. a pasted promise lands in the inbox as unreviewed, never confirmed (O10)', async () => {
    const r = await proposeCandidate({ quote: "Priya said we'd have the audit log ready by 12 Dec for Acme", account: 'Acme', dueDate: '2026-12-20' }, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ added: true, account: 'Acme Retail', dueDate: '2026-12-12' }); // the quote's date wins
    const inbox = await d.repo.listCandidates('unreviewed');
    const cand = inbox.find((c) => c.id === r.data.candidateId)!;
    expect(cand).toMatchObject({ sourceType: 'agent', sourceUrl: ROVO_CHAT_SOURCE, sourceTitle: 'Pasted into Rovo chat', reviewState: 'unreviewed' });
    expect((await d.repo.listCommitments()).some((c) => c.title.includes('audit log ready'))).toBe(false);
    const again = await proposeCandidate({ quote: "Priya said we'd have the audit log ready by 12 Dec for Acme", account: 'Acme' }, d);
    expect(again.ok && again.data.added).toBe(false);
  });

  it('5. "Draft an update for Acme" returns a draft plus the IDs it used', async () => {
    const r = await draftCustomerUpdate({ account: 'acme retail' }, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.usedCommitmentIds).toEqual(expect.arrayContaining(['c-acme-sso', 'c-acme-onboarding']));
    expect(r.data.body).toContain('Hello Acme Retail team');
    expect(r.data.body).not.toMatch(/DEMO-\d+/); // no internal keys to customers
    expect(r.data.note).toMatch(/approve/);
  });

  it('6. an unknown account is not_found, never an invention (O23)', async () => {
    for (const r of [
      await findCommitments({ account: 'Initech' }, d),
      await getAccountHealth({ account: 'Initech' }, d),
      await draftCustomerUpdate({ account: 'Initech' }, d),
      await explainRisk({ commitmentId: 'c-initech-1' }, d),
    ]) {
      expect(r.ok).toBe(false);
      expect(!r.ok && r.code).toBe('not_found');
    }
  });
});

describe('inputs (O27)', () => {
  it('ignores empty strings Rovo sends for unused inputs and the context field', async () => {
    const r = await findCommitments({ account: '', owner: '', status: '', health: '', text: '', context: { cloudId: 'x' } }, d);
    expect(r.ok && r.data.count).toBe(8);
  });
  it('rejects bad enums and missing required inputs with a structured error', async () => {
    const bad = await findCommitments({ health: 'doomed' }, d);
    expect(!bad.ok && bad.code).toBe('validation');
    const missing = await getAccountHealth({}, d);
    expect(!missing.ok && missing.message).toMatch(/account/);
    const badUrl = await proposeCandidate({ quote: 'We will ship it by 1 Dec.', sourceUrl: 'not a link' }, d);
    expect(!badUrl.ok && badUrl.code).toBe('validation');
  });
  it('asks to disambiguate partial names that match several accounts', () => {
    const accounts = [
      { id: 'a', name: 'Acme Retail', tier: 'enterprise' as const, renewalDate: null },
      { id: 'b', name: 'Acme Health', tier: 'growth' as const, renewalDate: null },
    ];
    const r = matchAccount(accounts, 'acme');
    expect(!r.ok && r.message).toMatch(/several accounts/);
  });
  it('account health summarises counts and top signals', async () => {
    const r = await getAccountHealth({ account: 'Northwind' }, d);
    expect(r.ok && r.data).toMatchObject({ account: 'Northwind Health', open: 3 });
    expect(r.ok && r.data.topSignals[0]!.rule).toBe('R1');
  });
});

describe('MCP-only tools (T13)', () => {
  it('get-commitment-details returns evidence, links, signals and history', async () => {
    const { getCommitmentDetails } = await import('../src/agent/actions');
    const r = await getCommitmentDetails({ commitmentId: 'C-NW-EHR' }, d); // case-insensitive id
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ id: 'c-nw-ehr', account: 'Northwind Health', owner: 'Priya' });
    expect(r.data.linkedIssues[0]).toMatchObject({ key: 'DEMO-21', flagged: true, done: false });
    expect(r.data.signals.map((s) => s.rule)).toEqual(expect.arrayContaining(['R5', 'R6']));
    expect(r.data.recentHistory[0]!.change).toBe('seeded');
    const missing = await getCommitmentDetails({ commitmentId: 'nope' }, d);
    expect(!missing.ok && missing.code).toBe('not_found');
  });

  it('identify-at-risk-commitments filters by severity and account, worst first', async () => {
    const { identifyAtRisk } = await import('../src/agent/actions');
    const atRisk = await identifyAtRisk({}, d);
    expect(atRisk.ok && atRisk.data.commitments[0]!.id).toBe('c-nw-export'); // severity 5 first
    expect(atRisk.ok && atRisk.data.count).toBe(4);
    const critical = await identifyAtRisk({ minSeverity: 5 }, d);
    expect(critical.ok && critical.data.commitments.map((c) => c.id)).toEqual(['c-nw-export']);
    const nw = await identifyAtRisk({ account: 'Northwind', minSeverity: '2' }, d); // strings coerce
    expect(nw.ok && nw.data.commitments.every((c) => c.account === 'Northwind Health')).toBe(true);
    const bad = await identifyAtRisk({ minSeverity: 9 }, d);
    expect(!bad.ok && bad.code).toBe('validation');
  });
});
