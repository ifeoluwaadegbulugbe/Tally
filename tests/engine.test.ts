import { describe, expect, it } from 'vitest';
import {
  RULE_IDS,
  accountRollups,
  commitmentRows,
  applyPatch,
  buildDashboard,
  buildDemoData,
  createCommitment,
  draftUpdate,
  evaluateRisks,
  healthOf,
  scanText,
} from '../src/core';
import type { Account, RiskSignal } from '../src/core';
import { NOW, cmt } from './helpers';

const acme: Account = { id: 'a1', name: 'Acme Retail', tier: 'enterprise', renewalDate: null };
let n = 0;
const newId = (p: string) => `${p}-${++n}`;

describe('createCommitment', () => {
  it('creates a confirmed, unowned commitment with priority from tier', () => {
    const r = createCommitment({ accountId: 'a1', title: 'Support SSO', dueDate: '2026-12-05' }, acme, { accountId: 'u0' }, NOW, newId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.commitment).toMatchObject({ status: 'confirmed', priority: 'high', dueDateSource: 'stated', confirmedDueDate: '2026-12-05' });
    expect(r.data.evidence).toBeNull();
  });
  it('starts as assigned when an owner is given, and masks emails in evidence', () => {
    const r = createCommitment(
      { accountId: 'a1', title: 'x', ownerAccountId: 'u1', evidence: { sourceType: 'manual', sourceUrl: 'https://e.x/1', quote: 'ask bob@acme.com' } },
      acme, { accountId: 'u0' }, NOW, newId,
    );
    expect(r.ok && r.data.commitment.status).toBe('assigned');
    expect(r.ok && r.data.evidence?.quote).toBe('ask b***@acme.com');
  });
  it('O13: empty title, bad date or wrong account -> validation error', () => {
    const bad = [
      { accountId: 'a1', title: '   ' },
      { accountId: 'a1', title: 'x', dueDate: '2026-13-40' },
      { accountId: 'a9', title: 'x' },
    ];
    for (const input of bad) {
      const r = createCommitment(input, acme, { accountId: 'u0' }, NOW, newId);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.code).toBe('validation');
    }
  });
});

describe('applyPatch', () => {
  it('O14: a stale version gets a conflict', () => {
    const r = applyPatch(cmt({ version: 3 }), { title: 'New' }, 2, { accountId: 'u1' }, NOW);
    expect(!r.ok && r.code).toBe('conflict');
  });
  it('requires a reason to change a due date and writes history', () => {
    const c = cmt();
    expect(applyPatch(c, { dueDate: '2026-12-20' }, 1, { accountId: 'u1' }, NOW).ok).toBe(false);
    const r = applyPatch(c, { dueDate: '2026-12-20' }, 1, { accountId: 'u1' }, NOW, 'Vendor delay');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.commitment.version).toBe(2);
    expect(r.data.commitment.confirmedDueDate).toBe('2026-12-05'); // kept for R7
    expect(r.data.history).toEqual([
      expect.objectContaining({ field: 'dueDate', from: '2026-12-05', to: '2026-12-20', reason: 'Vendor delay' }),
    ]);
  });
  it('setting an owner moves confirmed to assigned', () => {
    const r = applyPatch(cmt({ status: 'confirmed', ownerAccountId: null, assignedAt: null }), { ownerAccountId: 'u2' }, 1, { accountId: 'u1' }, NOW);
    expect(r.ok && r.data.commitment.status).toBe('assigned');
    expect(r.ok && r.data.commitment.assignedAt).toBe(NOW.toISOString());
  });
});

describe('draftUpdate', () => {
  const items = [
    cmt({ id: 'c1', accountId: 'a1', title: 'SSO', status: 'in_delivery', dueDate: '2026-12-05' }),
    cmt({ id: 'c2', accountId: 'a1', title: 'Migration plan', status: 'delivered' }),
    cmt({ id: 'c3', accountId: 'a1', title: 'Dropped item', status: 'cancelled' }),
    cmt({ id: 'c4', accountId: 'a2', title: 'Other customer', status: 'in_delivery' }),
  ];
  const blocked: RiskSignal = {
    id: 'sig:c1:R5', commitmentId: 'c1', rule: 'R5', severity: 4, reason: 'ACME-42 is blocked.', inputs: {}, evaluatedAt: NOW.toISOString(),
  };

  it('O31: lists the IDs it used; every line comes from a stored commitment', () => {
    const d = draftUpdate(acme, items, [], NOW);
    expect(d.used).toEqual(['c2', 'c1']);
    const lines = d.body.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(d.used.length);
    const titles = items.filter((c) => d.used.includes(c.id)).map((c) => c.title);
    for (const l of lines) expect(titles.some((t) => l.startsWith(`- ${t}:`))).toBe(true);
    expect(d.body).not.toContain('Other customer');
    expect(d.body).not.toContain('Dropped item');
  });
  it('never leaks internal risk detail to the customer', () => {
    const d = draftUpdate(acme, items, [blocked], NOW);
    expect(d.body).not.toContain('ACME-42');
    expect(d.body).toContain('reviewing the 5 Dec date');
  });
  it('returns an empty draft when there is nothing to report', () => {
    expect(draftUpdate({ id: 'zz', name: 'Initech' }, items, [], NOW)).toEqual({ body: '', used: [] });
  });
});

describe('demo data', () => {
  const demo = buildDemoData(NOW);
  const evidenceCount = (id: string) => demo.evidence.filter((e) => e.commitmentId === id).length;
  const signals = demo.commitments.flatMap((c) => evaluateRisks(c, { issues: demo.issues, evidenceCount: evidenceCount(c.id) }, NOW));
  const healthOfCmt = (id: string) => healthOf(signals.filter((s) => s.commitmentId === id), NOW);

  it('seed data shows all nine rules (week-3 gate)', () => {
    expect(new Set(signals.map((s) => s.rule))).toEqual(new Set(RULE_IDS));
  });
  it('matches the intended demo states', () => {
    expect(healthOfCmt('c-acme-sso')).toBe('watch'); // R3 unowned
    expect(healthOfCmt('c-acme-onboarding')).toBe('at_risk'); // R2
    expect(healthOfCmt('c-nw-ehr')).toBe('at_risk'); // R5 + R6
    expect(healthOfCmt('c-nw-export')).toBe('critical'); // R1
    expect(healthOfCmt('c-nw-qbr')).toBe('on_track');
    expect(healthOfCmt('c-bf-residency')).toBe('watch'); // R4
  });
  it('dashboard KPIs are consistent with the data', () => {
    const d = buildDashboard(demo.commitments, signals, NOW);
    // at risk or worse: onboarding (R2), EHR (R5/R6), export (R1), training (R6)
    expect(d.counts).toEqual({ open: 8, atRisk: 4, overdue: 1, noOwner: 1 });
    expect(d.attention[0]!.commitmentId).toBe('c-nw-export');
    expect(d.attention.length).toBeLessThanOrEqual(8);
    expect(d.delivered.map((x) => x.id)).toEqual(['c-bf-audit', 'c-acme-migration']);
  });
  it('candidate sources demonstrate every class', () => {
    const classes = demo.candidateSources.flatMap((s) => scanText(s.text, NOW, { contextAccount: true }).map((h) => h.suggestedClass));
    expect(classes.sort()).toEqual(['ambiguous', 'confirmed', 'confirmed', 'possible', 'suggestion']);
  });
});

describe('list views', () => {
  const demo = buildDemoData(NOW);
  const count = (id: string) => demo.evidence.filter((e) => e.commitmentId === id).length;
  const signals = demo.commitments.flatMap((c) => evaluateRisks(c, { issues: demo.issues, evidenceCount: count(c.id) }, NOW));
  const rows = commitmentRows(demo.commitments, demo.accounts, signals, NOW);

  it('rows carry account name, health and the top reason', () => {
    const r = rows.find((x) => x.id === 'c-nw-export')!;
    expect(r).toMatchObject({ accountName: 'Northwind Health', health: 'critical' });
    expect(r.topReason).toMatch(/^Due .*ago\.$/);
    expect(rows.find((x) => x.id === 'c-acme-migration')!.health).toBe('on_track'); // delivered
  });
  it('account rollups match the rows', () => {
    const roll = accountRollups(demo.accounts, rows, signals, NOW);
    const nw = roll.find((a) => a.id === 'acct-northwind')!;
    expect(nw).toMatchObject({ open: 3, atRisk: 2, overdue: 1, health: 'critical' });
    const acme = roll.find((a) => a.id === 'acct-acme')!;
    expect(acme.open).toBe(3);
    expect(acme.nextDue).toBe('2026-11-13');
  });
});

describe('KPIs match the list views (F-31)', () => {
  it('every dashboard count equals the matching saved view over the same rows', async () => {
    const { matchesView } = await import('../src/core/engine');
    const demo = buildDemoData(NOW);
    const count = (id: string) => demo.evidence.filter((e) => e.commitmentId === id).length;
    const signals = demo.commitments.flatMap((c) => evaluateRisks(c, { issues: demo.issues, evidenceCount: count(c.id) }, NOW));
    // Acknowledge the overdue signal: it must still count as overdue in both places.
    const acked = signals.map((s) => (s.rule === 'R1' ? { ...s, acknowledgedUntil: '2026-12-31T00:00:00Z' } : s));
    const d = buildDashboard(demo.commitments, acked, NOW);
    const rows = commitmentRows(demo.commitments, demo.accounts, acked, NOW);
    const today = '2026-11-10';
    const n = (v: Parameters<typeof matchesView>[1]) => rows.filter((r) => matchesView(r, v, undefined, today)).length;
    expect(d.counts).toEqual({ open: n(''), atRisk: n('at_risk'), overdue: n('overdue'), noOwner: n('unassigned') });
    expect(d.counts.overdue).toBe(1);
  });
});
