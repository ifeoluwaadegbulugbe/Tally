import { beforeEach, describe, expect, it } from 'vitest';
import { RULE_IDS } from '../src/core';
import { MemoryKv } from '../src/storage/kv';
import { Repo, keys } from '../src/storage/repo';
import { NOW } from './helpers';

let kv: MemoryKv;
let repo: Repo;
let n = 0;
const actor = { accountId: 'u0' };

beforeEach(() => {
  kv = new MemoryKv();
  n = 0;
  repo = new Repo(kv, (p) => `${p}-${++n}`);
});

async function withAccount() {
  const r = await repo.saveAccount({ name: 'Acme Retail', tier: 'enterprise', renewalDate: '2027-02-01' });
  if (!r.ok) throw new Error(r.message);
  return r.data;
}

describe('accounts', () => {
  it('round-trips and lists by name', async () => {
    await repo.saveAccount({ name: 'Zeta', tier: 'growth', renewalDate: null });
    const a = await withAccount();
    expect(await repo.getAccount(a.id)).toEqual(a);
    expect((await repo.listAccounts()).map((x) => x.name)).toEqual(['Acme Retail', 'Zeta']);
  });
  it('rejects invalid input and duplicate names', async () => {
    await withAccount();
    expect((await repo.saveAccount({ name: '', tier: 'enterprise', renewalDate: null })).ok).toBe(false);
    const dup = await repo.saveAccount({ name: 'acme retail', tier: 'growth', renewalDate: null });
    expect(!dup.ok && dup.code).toBe('conflict');
  });
});

describe('commitments', () => {
  it('creates with evidence and a history row, priority from tier', async () => {
    const a = await withAccount();
    const r = await repo.createCommitment(
      { accountId: a.id, title: 'Support SSO', dueDate: '2026-12-05', evidence: { sourceType: 'manual', sourceUrl: 'https://e.x/1', quote: 'We will ship SSO.' } },
      actor,
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.priority).toBe('high');
    expect(await repo.getCommitment(r.data.id)).toEqual(r.data);
    expect(await repo.listEvidence(r.data.id)).toHaveLength(1);
    expect((await repo.listHistory(r.data.id)).map((h) => h.field)).toEqual(['created']);
  });
  it('O13: unknown account is a validation error with no write', async () => {
    const r = await repo.createCommitment({ accountId: 'nope', title: 'x' }, actor, NOW);
    expect(!r.ok && r.code).toBe('validation');
    expect(await repo.listCommitments()).toEqual([]);
  });
  it('updates with history, and O14: a stale version conflicts without writing', async () => {
    const a = await withAccount();
    const c = await repo.createCommitment({ accountId: a.id, title: 'SSO' }, actor, NOW);
    if (!c.ok) throw new Error(c.message);
    const u = await repo.updateCommitment(c.data.id, { ownerAccountId: 'u2' }, 1, actor, NOW);
    expect(u.ok && u.data).toMatchObject({ status: 'assigned', version: 2, ownerAccountId: 'u2' });
    const stale = await repo.updateCommitment(c.data.id, { title: 'Other' }, 1, actor, NOW);
    expect(!stale.ok && stale.code).toBe('conflict');
    expect((await repo.getCommitment(c.data.id))?.title).toBe('SSO');
    expect((await repo.listHistory(c.data.id)).map((h) => h.field)).toEqual(['created', 'ownerAccountId', 'status']);
  });
  it('filters by account, status and owner', async () => {
    const a = await withAccount();
    await repo.createCommitment({ accountId: a.id, title: 'one' }, actor, NOW);
    await repo.createCommitment({ accountId: a.id, title: 'two', ownerAccountId: 'u5' }, actor, NOW);
    expect(await repo.listCommitments({ ownerAccountId: null })).toHaveLength(1);
    expect(await repo.listCommitments({ status: 'assigned' })).toHaveLength(1);
    expect(await repo.listCommitments({ accountId: 'other' })).toHaveLength(0);
  });
  it('child prefixes do not leak between ids (c1 vs c10)', async () => {
    await kv.set(keys.ev('cmt-1', 1), { commitmentId: 'cmt-1' });
    await kv.set(keys.ev('cmt-10', 1), { commitmentId: 'cmt-10' });
    expect(await repo.listEvidence('cmt-1')).toHaveLength(1);
  });
});

describe('evidence', () => {
  it('masks emails and caps quotes; rejects bad URLs', async () => {
    const a = await withAccount();
    const c = await repo.createCommitment({ accountId: a.id, title: 'SSO' }, actor, NOW);
    if (!c.ok) throw new Error(c.message);
    const e = await repo.addEvidence(c.data.id, { sourceType: 'confluence', sourceUrl: 'https://x.atlassian.net/wiki/1', quote: 'mail dana@acme.com' }, actor, NOW);
    expect(e.ok && e.data.quote).toBe('mail d***@acme.com');
    const bad = await repo.addEvidence(c.data.id, { sourceType: 'manual', sourceUrl: 'not a url', quote: 'q' }, actor, NOW);
    expect(!bad.ok && bad.code).toBe('validation');
  });
});

describe('signals', () => {
  it('replaceSignals keeps acknowledgements and removes signals that stopped firing', async () => {
    const base = { commitmentId: 'c1', severity: 2, reason: 'r', inputs: {}, evaluatedAt: NOW.toISOString() };
    await repo.replaceSignals('c1', [
      { ...base, id: 'sig:c1:R8', rule: 'R8' },
      { ...base, id: 'sig:c1:R7', rule: 'R7' },
    ]);
    await kv.set(keys.sig('c1', 'R8'), { ...base, id: 'sig:c1:R8', rule: 'R8', acknowledgedUntil: '2026-12-01T00:00:00Z' });
    const merged = await repo.replaceSignals('c1', [{ ...base, id: 'sig:c1:R8', rule: 'R8' }]);
    expect(merged[0]!.acknowledgedUntil).toBe('2026-12-01T00:00:00Z');
    expect((await repo.listSignals('c1')).map((s) => s.rule)).toEqual(['R8']);
  });
});

describe('evaluateAll', () => {
  it('writes only changed signals and removes ones that stopped firing', async () => {
    await repo.seedDemo(NOW);
    const writes: string[] = [];
    const set = kv.setMany.bind(kv);
    kv.setMany = async (items) => {
      writes.push(...items.map((i) => i.key));
      return set(items);
    };
    const first = await repo.evaluateAll(NOW);
    expect(writes).toEqual([]); // nothing changed since the seed evaluation
    await kv.delete(keys.ev('c-acme-security', 1)); // no-op: it had no evidence
    await kv.delete(keys.ev('c-nw-qbr', 1)); // QBR loses its evidence -> R8 appears
    const second = await repo.evaluateAll(NOW);
    expect(writes).toEqual([keys.sig('c-nw-qbr', 'R8')]);
    expect(second.signals.length).toBe(first.signals.length + 1);
    const c = await repo.getCommitment('c-nw-export');
    await kv.set(keys.cmt('c-nw-export'), { ...c, status: 'cancelled' }); // closed -> its signals go
    const third = await repo.evaluateAll(NOW);
    expect(third.signals.some((s) => s.commitmentId === 'c-nw-export')).toBe(false);
    expect(await repo.listSignals('c-nw-export')).toEqual([]);
  });
});

describe('demo seed and delete', () => {
  it('seeds section P data and evaluates all nine rules', async () => {
    const r = await repo.seedDemo(NOW, 'https://usetallyapp.atlassian.net');
    expect(r.ok && r.data).toEqual({ accounts: 3, commitments: 10, evidence: 9 });
    expect(new Set((await repo.listSignals()).map((s) => s.rule))).toEqual(new Set(RULE_IDS));
    expect((await repo.getSettings()).demoLoadedAt).toBe(NOW.toISOString());
    const ev = await repo.listEvidence('c-acme-sso');
    expect(ev[0]!.sourceUrl.startsWith('https://usetallyapp.atlassian.net/')).toBe(true);
  });
  it('refuses to seed over existing data', async () => {
    await withAccount();
    const r = await repo.seedDemo(NOW);
    expect(!r.ok && r.code).toBe('conflict');
  });
  it('O34: deleteAll leaves storage empty, and seeding works again after', async () => {
    await repo.seedDemo(NOW);
    const { deleted } = await repo.deleteAll();
    expect(deleted).toBeGreaterThan(0);
    expect(kv.data.size).toBe(0);
    expect((await repo.seedDemo(NOW)).ok).toBe(true);
  });
});

describe('settings', () => {
  it('returns defaults, merges patches and validates rules', async () => {
    expect((await repo.getSettings()).rules.dueSoonDays).toBe(3);
    const s = await repo.saveSettings({ rules: { ...(await repo.getSettings()).rules, dueSoonDays: 5 } });
    expect(s.ok && s.data.rules.dueSoonDays).toBe(5);
    const bad = await repo.saveSettings({ rules: { ...(await repo.getSettings()).rules, staleDays: 0 } });
    expect(bad.ok).toBe(false);
  });
});

describe('transitions', () => {
  async function seeded() {
    await repo.seedDemo(NOW);
    return (await repo.getCommitment('c-nw-ehr'))!;
  }
  it('O8: cancel needs a reason, records customer informed, and clears signals', async () => {
    const c = await seeded();
    const bad = await repo.transitionCommitment(c.id, { action: 'cancel' }, c.version, actor, NOW);
    expect(!bad.ok && bad.code).toBe('validation');
    const r = await repo.transitionCommitment(c.id, { action: 'cancel', reason: 'Customer dropped it', customerInformed: true }, c.version, actor, NOW);
    expect(r.ok && r.data.status).toBe('cancelled');
    const hist = await repo.listHistory(c.id);
    expect(hist.find((h) => h.field === 'customerInformed')?.to).toBe(true);
    await repo.evaluateAll(NOW);
    expect(await repo.listSignals(c.id)).toEqual([]);
  });
  it('renegotiate sets the new agreed date without firing R7', async () => {
    const c = await seeded();
    const r = await repo.transitionCommitment(c.id, { action: 'renegotiate', reason: 'Scope grew', newDueDate: '2027-01-15' }, c.version, actor, NOW);
    expect(r.ok && r.data).toMatchObject({ status: 'renegotiated', dueDate: '2027-01-15', confirmedDueDate: '2027-01-15' });
    const { signals } = await repo.evaluateAll(NOW);
    expect(signals.filter((s) => s.commitmentId === c.id).map((s) => s.rule)).not.toContain('R7');
  });
  it('rejects stale versions and bad dates', async () => {
    const c = await seeded();
    expect((await repo.transitionCommitment(c.id, { action: 'cancel', reason: 'x' }, c.version - 1, actor, NOW)).ok).toBe(false);
    const bad = await repo.transitionCommitment(c.id, { action: 'renegotiate', reason: 'x', newDueDate: '15/01/2027' }, c.version, actor, NOW);
    expect(!bad.ok && bad.code).toBe('validation');
  });
});
