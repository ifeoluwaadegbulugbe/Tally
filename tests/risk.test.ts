import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_CONFIG, carryAcknowledgements, describeRules, evaluateRisks, healthOf } from '../src/core';
import type { RuleId } from '../src/core';
import { NOW, cmt, daysAgo, hoursAgo, issue } from './helpers';

const rules = (c = cmt(), issues = [] as ReturnType<typeof issue>[], evidenceCount = 1, cfg = DEFAULT_RULE_CONFIG) =>
  evaluateRisks(c, { issues, evidenceCount }, NOW, cfg);
const ids = (...a: Parameters<typeof rules>) => rules(...a).map((s) => s.rule);
const fires = (rule: RuleId, ...a: Parameters<typeof rules>) => ids(...a).includes(rule);

describe('R1 overdue', () => {
  it('O1: due yesterday, status assigned -> R1, severity 5, critical', () => {
    const s = rules(cmt({ dueDate: '2026-11-09', issueKeys: ['A-1'] }), [issue({ key: 'A-1' })]);
    const r1 = s.find((x) => x.rule === 'R1');
    expect(r1?.severity).toBe(5);
    expect(r1?.reason).toBe('Due 9 Nov, 1 day ago.');
    expect(healthOf(s, NOW)).toBe('critical');
  });
  it('does not fire when due today or later', () => {
    expect(fires('R1', cmt({ dueDate: '2026-11-10' }))).toBe(false);
  });
  it('does not fire for delivered, communicated or cancelled', () => {
    for (const status of ['delivered', 'communicated', 'cancelled'] as const) {
      expect(rules(cmt({ status, dueDate: '2026-10-01' }), [], 0)).toEqual([]);
    }
  });
});

describe('R2 due soon', () => {
  it('O2: due in 2 days, linked issue To Do -> R2', () => {
    const s = rules(cmt({ dueDate: '2026-11-12', issueKeys: ['A-1'] }), [
      issue({ key: 'A-1', statusName: 'To Do', statusCategory: 'todo' }),
    ]);
    expect(s.find((x) => x.rule === 'R2')?.reason).toBe('Due in 2 days; A-1 is To Do.');
  });
  it('does not fire when all linked issues are Done', () => {
    expect(fires('R2', cmt({ dueDate: '2026-11-12', issueKeys: ['A-1'] }), [issue({ key: 'A-1', statusCategory: 'done' })])).toBe(false);
  });
  it('does not fire outside the threshold', () => {
    expect(fires('R2', cmt({ dueDate: '2026-11-14', issueKeys: ['A-1'] }), [issue({ key: 'A-1' })])).toBe(false);
  });
  it('respects a configured threshold', () => {
    const cfg = { ...DEFAULT_RULE_CONFIG, dueSoonDays: 5 };
    expect(fires('R2', cmt({ dueDate: '2026-11-14', issueKeys: ['A-1'] }), [issue({ key: 'A-1' })], 1, cfg)).toBe(true);
  });
});

describe('R3 no owner', () => {
  it('O3: confirmed 2 days ago with no owner -> R3', () => {
    const s = rules(cmt({ status: 'confirmed', ownerAccountId: null, confirmedAt: daysAgo(2), assignedAt: null }));
    expect(s.find((x) => x.rule === 'R3')?.reason).toBe('Confirmed 2 days ago with no owner.');
  });
  it('does not fire within 24 hours', () => {
    expect(fires('R3', cmt({ status: 'confirmed', ownerAccountId: null, confirmedAt: hoursAgo(23) }))).toBe(false);
  });
  it('does not fire once owned', () => {
    expect(fires('R3', cmt({ status: 'confirmed', ownerAccountId: 'u1', confirmedAt: daysAgo(4) }))).toBe(false);
  });
});

describe('R4 no delivery work', () => {
  it('fires when assigned 3+ days with no linked issue', () => {
    expect(fires('R4', cmt({ assignedAt: daysAgo(3) }))).toBe(true);
  });
  it('does not fire before 3 days or with an issue linked', () => {
    expect(fires('R4', cmt({ assignedAt: daysAgo(2) }))).toBe(false);
    expect(fires('R4', cmt({ assignedAt: daysAgo(5), issueKeys: ['A-1'] }), [issue({ key: 'A-1' })])).toBe(false);
  });
});

describe('R5 blocked work', () => {
  it('O4: linked issue flagged -> R5 naming the key', () => {
    const s = rules(cmt({ issueKeys: ['ACME-42'] }), [issue({ key: 'ACME-42', flagged: true })]);
    expect(s.find((x) => x.rule === 'R5')?.reason).toBe('ACME-42 is blocked.');
  });
  it('fires on a configured blocked status name, case-insensitively', () => {
    expect(fires('R5', cmt({ issueKeys: ['A-1'] }), [issue({ key: 'A-1', statusName: 'blocked' })])).toBe(true);
  });
  it('ignores issues the user cannot see', () => {
    expect(fires('R5', cmt({ issueKeys: ['A-1'] }), [issue({ key: 'A-1', flagged: true, accessible: false })])).toBe(false);
  });
  it('ignores issues not linked to this commitment', () => {
    expect(fires('R5', cmt({ issueKeys: ['A-1'] }), [issue({ key: 'B-9', flagged: true })])).toBe(false);
  });
});

describe('R6 date mismatch', () => {
  it('O5: issue due after the promise -> R6 with both dates', () => {
    const s = rules(cmt({ dueDate: '2026-12-05', issueKeys: ['A-1'] }), [issue({ key: 'A-1', dueDate: '2026-12-14' })]);
    expect(s.find((x) => x.rule === 'R6')?.reason).toBe('A-1 due 14 Dec, promise due 5 Dec.');
  });
  it('does not fire when the issue is due on or before the promise', () => {
    expect(fires('R6', cmt({ dueDate: '2026-12-05', issueKeys: ['A-1'] }), [issue({ key: 'A-1', dueDate: '2026-12-05' })])).toBe(false);
  });
});

describe('R7 date moved', () => {
  it('fires when the due date moved later after confirmation', () => {
    const s = rules(cmt({ confirmedDueDate: '2026-11-26', dueDate: '2026-12-05' }));
    expect(s.find((x) => x.rule === 'R7')?.reason).toBe('Moved from 26 Nov to 5 Dec.');
  });
  it('does not fire when moved earlier', () => {
    expect(fires('R7', cmt({ confirmedDueDate: '2026-12-10', dueDate: '2026-12-05' }))).toBe(false);
  });
});

describe('R8 no evidence', () => {
  it('fires with zero evidence and not otherwise', () => {
    expect(fires('R8', cmt(), [], 0)).toBe(true);
    expect(fires('R8', cmt(), [], 1)).toBe(false);
  });
});

describe('R9 stale delivery', () => {
  it('fires when a linked issue is untouched for 7+ days', () => {
    const s = rules(cmt({ issueKeys: ['A-1'] }), [issue({ key: 'A-1', updated: daysAgo(9) })]);
    expect(s.find((x) => x.rule === 'R9')?.reason).toBe('A-1 untouched for 9 days.');
  });
  it('does not fire for Done issues or recent updates', () => {
    expect(fires('R9', cmt({ issueKeys: ['A-1'] }), [issue({ key: 'A-1', updated: daysAgo(9), statusCategory: 'done' })])).toBe(false);
    expect(fires('R9', cmt({ issueKeys: ['A-1'] }), [issue({ key: 'A-1', updated: daysAgo(6) })])).toBe(false);
  });
});

describe('health and acknowledgement', () => {
  it('O6: all issues Done and no other problems -> no signals, on track', () => {
    const s = rules(cmt({ status: 'in_delivery', issueKeys: ['A-1'] }), [issue({ key: 'A-1', statusCategory: 'done', statusName: 'Done' })]);
    expect(s).toEqual([]);
    expect(healthOf(s, NOW)).toBe('on_track');
  });
  it('maps severity to health bands', () => {
    expect(healthOf(rules(cmt({ issueKeys: ['A-1'] }), [issue({ key: 'A-1', flagged: true })]), NOW)).toBe('at_risk');
    expect(healthOf(rules(cmt(), [], 0), NOW)).toBe('watch');
  });
  it('O7: acknowledged signal is hidden until expiry, then reappears', () => {
    const fresh = rules(cmt(), [], 0);
    const acked = fresh.map((s) => ({ ...s, acknowledgedUntil: '2026-11-12T00:00:00Z', acknowledgedReason: 'Waiting on legal' }));
    const carried = carryAcknowledgements(rules(cmt(), [], 0), acked);
    expect(healthOf(carried, NOW)).toBe('on_track');
    expect(healthOf(carried, new Date('2026-11-13T00:00:00Z'))).toBe('watch');
  });
  it('every signal records rule, inputs and evaluation time', () => {
    for (const s of rules(cmt({ dueDate: '2026-11-01', confirmedDueDate: '2026-10-20' }), [], 0)) {
      expect(s.id).toBe(`sig:c1:${s.rule}`);
      expect(s.inputs).toBeTypeOf('object');
      expect(s.evaluatedAt).toBe(NOW.toISOString());
    }
  });
  it('describes every rule in plain language', () => {
    expect(Object.keys(describeRules())).toHaveLength(9);
  });
});
