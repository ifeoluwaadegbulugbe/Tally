import { beforeEach, describe, expect, it } from 'vitest';
import { commitmentRows, groupRisks, healthOf } from '../src/core';
import { MemoryKv } from '../src/storage/kv';
import { Repo } from '../src/storage/repo';
import { NOW } from './helpers';

let repo: Repo;
const actor = { accountId: 'u1' };

beforeEach(async () => {
  repo = new Repo(new MemoryKv());
  await repo.seedDemo(NOW);
});

async function view(now = NOW) {
  const { signals, commitments } = await repo.evaluateAll(now);
  const rows = commitmentRows(commitments, await repo.listAccounts(), signals, now);
  return { rows, signals, ...groupRisks(rows, signals, now) };
}

describe('groupRisks (F7)', () => {
  it('groups by rule, most severe first, and covers every active signal', async () => {
    const { groups, signals, acknowledged } = await view();
    expect(groups[0]!.rule).toBe('R1');
    const sev = groups.map((g) => g.severity);
    expect([...sev].sort((a, b) => b - a)).toEqual(sev);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(signals.length);
    expect(acknowledged).toEqual([]);
    expect(groups.find((g) => g.rule === 'R5')!.items[0]).toMatchObject({ commitmentId: 'c-nw-ehr', accountName: 'Northwind Health' });
  });
});

describe('acknowledgeSignal (F-32, O7)', () => {
  it('hides a risk until the end of the chosen day, then it returns; history is written', async () => {
    const r = await repo.acknowledgeSignal('sig:c-nw-export:R1', '2026-11-12', 'Customer agreed to wait', actor, NOW);
    expect(r.ok && r.data).toMatchObject({ acknowledgedUntil: '2026-11-12T23:59:59.999Z', acknowledgedBy: 'u1' });

    let v = await view();
    expect(v.acknowledged.map((i) => i.signalId)).toEqual(['sig:c-nw-export:R1']);
    expect(v.groups.find((g) => g.rule === 'R1')).toBeUndefined();
    // R9 still fires on this commitment, so it is Watch rather than Critical while R1 is acknowledged.
    expect(healthOf(v.signals.filter((s) => s.commitmentId === 'c-nw-export'), NOW)).toBe('watch');

    // The daily R1 reason changes ("15 days ago"), yet the acknowledgement carries over.
    const tomorrow = new Date('2026-11-11T12:00:00Z');
    v = await view(tomorrow);
    expect(v.acknowledged).toHaveLength(1);

    const after = new Date('2026-11-13T09:00:00Z');
    v = await view(after);
    expect(v.groups.find((g) => g.rule === 'R1')?.items.map((i) => i.commitmentId)).toContain('c-nw-export');

    const hist = await repo.listHistory('c-nw-export');
    expect(hist.find((h) => h.field === 'riskAcknowledged')).toMatchObject({ to: 'R1 until 2026-11-12', reason: 'Customer agreed to wait' });
  });

  it('validates reason, date range and signal id; null clears', async () => {
    expect((await repo.acknowledgeSignal('sig:c-nw-export:R1', '2026-11-12', '', actor, NOW)).ok).toBe(false);
    expect((await repo.acknowledgeSignal('sig:c-nw-export:R1', '2026-11-01', 'x', actor, NOW)).ok).toBe(false);
    expect((await repo.acknowledgeSignal('sig:c-nw-export:R1', '2027-03-01', 'x', actor, NOW)).ok).toBe(false);
    expect((await repo.acknowledgeSignal('bogus', '2026-11-12', 'x', actor, NOW)).ok).toBe(false);
    const missing = await repo.acknowledgeSignal('sig:c-nw-qbr:R1', '2026-11-12', 'x', actor, NOW);
    expect(!missing.ok && missing.code).toBe('not_found');

    await repo.acknowledgeSignal('sig:c-nw-export:R1', '2026-11-12', 'x', actor, NOW);
    const cleared = await repo.acknowledgeSignal('sig:c-nw-export:R1', null, undefined, actor, NOW);
    expect(cleared.ok && cleared.data.acknowledgedUntil).toBeUndefined();
    expect((await view()).acknowledged).toEqual([]);
  });
});
