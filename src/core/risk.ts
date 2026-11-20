// Risk rules R1-R9 (blueprint section E). Pure functions, no I/O.
// Each rule returns zero or one signal. Severity is a fixed sort weight, not a prediction.
import { daysBetween, formatDay, hoursSince, plural, toISODate } from './dates';
import type { Commitment, Health, IssueSnapshot, RiskSignal, RuleConfig, RuleId } from './types';
import { DEFAULT_RULE_CONFIG, isOpen } from './types';

export interface RiskContext {
  /** Live snapshots of the commitment's linked issues (inaccessible ones are ignored). */
  issues: IssueSnapshot[];
  evidenceCount: number;
}

export const SEVERITY: Record<RuleId, number> = {
  R1: 5,
  R2: 4,
  R3: 3,
  R4: 3,
  R5: 4,
  R6: 4,
  R7: 2,
  R8: 2,
  R9: 2,
};

/** Plain-language description of each rule, for the Risks "Rules" drawer (F7). */
export function describeRules(cfg: RuleConfig = DEFAULT_RULE_CONFIG): Record<RuleId, string> {
  return {
    R1: 'Overdue: the due date has passed and the promise is not delivered or cancelled.',
    R2: `Due soon: due within ${plural(cfg.dueSoonDays, 'day')} and a linked Jira issue is not Done.`,
    R3: `No owner: confirmed for ${plural(cfg.noOwnerHours, 'hour')} or more with nobody assigned.`,
    R4: `No delivery work: owned for ${plural(cfg.noDeliveryWorkDays, 'day')} with no Jira issue linked.`,
    R5: `Blocked work: a linked issue is flagged or in a blocked status (${cfg.blockedStatusNames.join(', ')}).`,
    R6: 'Date mismatch: a linked issue is due after the promise is due.',
    R7: 'Date moved: the due date was moved later after the promise was confirmed.',
    R8: 'No evidence: no source quote is recorded for the promise.',
    R9: `Stale delivery: a linked issue that is not Done has not been updated for ${plural(cfg.staleDays, 'day')}.`,
  };
}

type Hit = { reason: string; inputs: Record<string, unknown> } | null;

const isDone = (i: IssueSnapshot) => i.statusCategory === 'done';

function isBlocked(i: IssueSnapshot, cfg: RuleConfig): boolean {
  const name = i.statusName.trim().toLowerCase();
  return i.flagged || cfg.blockedStatusNames.some((b) => b.trim().toLowerCase() === name);
}

function visibleIssues(c: Commitment, ctx: RiskContext): IssueSnapshot[] {
  return ctx.issues.filter((i) => c.issueKeys.includes(i.key) && i.accessible !== false);
}

const rules: Record<RuleId, (c: Commitment, ctx: RiskContext, now: Date, cfg: RuleConfig) => Hit> = {
  R1(c, _ctx, now) {
    if (!c.dueDate) return null;
    const late = daysBetween(c.dueDate, toISODate(now));
    if (late <= 0) return null;
    return {
      reason: `Due ${formatDay(c.dueDate, now)}, ${plural(late, 'day')} ago.`,
      inputs: { dueDate: c.dueDate, daysLate: late },
    };
  },

  R2(c, ctx, now, cfg) {
    if (!c.dueDate) return null;
    const left = daysBetween(toISODate(now), c.dueDate);
    if (left < 0 || left > cfg.dueSoonDays) return null;
    const open = visibleIssues(c, ctx).find((i) => !isDone(i));
    if (!open) return null;
    return {
      reason: `Due in ${plural(left, 'day')}; ${open.key} is ${open.statusName}.`,
      inputs: { dueDate: c.dueDate, daysLeft: left, issueKey: open.key, issueStatus: open.statusName },
    };
  },

  R3(c, _ctx, now, cfg) {
    if (c.status !== 'confirmed' || c.ownerAccountId) return null;
    const hours = hoursSince(c.confirmedAt, now);
    if (hours < cfg.noOwnerHours) return null;
    const days = Math.floor(hours / 24);
    const when = days === 0 ? 'today' : `${plural(days, 'day')} ago`;
    return {
      reason: `Confirmed ${when} with no owner.`,
      inputs: { confirmedAt: c.confirmedAt, hoursUnowned: Math.floor(hours) },
    };
  },

  R4(c, _ctx, now, cfg) {
    if (c.status !== 'assigned' || c.issueKeys.length > 0 || !c.assignedAt) return null;
    const days = hoursSince(c.assignedAt, now) / 24;
    if (days < cfg.noDeliveryWorkDays) return null;
    return { reason: 'No Jira issue linked.', inputs: { assignedAt: c.assignedAt, daysAssigned: Math.floor(days) } };
  },

  R5(c, ctx, _now, cfg) {
    const blocked = visibleIssues(c, ctx).filter((i) => !isDone(i) && isBlocked(i, cfg));
    if (blocked.length === 0) return null;
    const keys = blocked.map((i) => i.key);
    return {
      reason: `${keys.join(', ')} ${keys.length === 1 ? 'is' : 'are'} blocked.`,
      inputs: { issueKeys: keys, flagged: blocked.map((i) => i.flagged) },
    };
  },

  R6(c, ctx, now) {
    if (!c.dueDate) return null;
    const due = c.dueDate;
    const late = visibleIssues(c, ctx)
      .filter((i) => !isDone(i) && i.dueDate && i.dueDate > due)
      .sort((a, b) => (b.dueDate! > a.dueDate! ? 1 : -1))[0];
    if (!late || !late.dueDate) return null;
    return {
      reason: `${late.key} due ${formatDay(late.dueDate, now)}, promise due ${formatDay(due, now)}.`,
      inputs: { issueKey: late.key, issueDueDate: late.dueDate, dueDate: due },
    };
  },

  R7(c, _ctx, now) {
    if (!c.dueDate || !c.confirmedDueDate || c.dueDate <= c.confirmedDueDate) return null;
    return {
      reason: `Moved from ${formatDay(c.confirmedDueDate, now)} to ${formatDay(c.dueDate, now)}.`,
      inputs: { from: c.confirmedDueDate, to: c.dueDate, daysMoved: daysBetween(c.confirmedDueDate, c.dueDate) },
    };
  },

  R8(_c, ctx) {
    if (ctx.evidenceCount > 0) return null;
    return { reason: 'No source quote recorded.', inputs: { evidenceCount: 0 } };
  },

  R9(c, ctx, now, cfg) {
    const stale = visibleIssues(c, ctx)
      .filter((i) => !isDone(i))
      .map((i) => ({ i, days: Math.floor(hoursSince(i.updated, now) / 24) }))
      .filter((x) => x.days >= cfg.staleDays)
      .sort((a, b) => b.days - a.days)[0];
    if (!stale) return null;
    return {
      reason: `${stale.i.key} untouched for ${plural(stale.days, 'day')}.`,
      inputs: { issueKey: stale.i.key, updated: stale.i.updated, daysStale: stale.days },
    };
  },
};

export const RULE_IDS = Object.keys(rules) as RuleId[];

/**
 * Evaluate all rules for one commitment. Closed commitments (delivered, communicated,
 * cancelled) produce no signals.
 */
export function evaluateRisks(
  c: Commitment,
  ctx: RiskContext,
  now: Date,
  cfg: RuleConfig = DEFAULT_RULE_CONFIG,
): RiskSignal[] {
  if (!isOpen(c.status)) return [];
  const evaluatedAt = now.toISOString();
  const out: RiskSignal[] = [];
  for (const rule of RULE_IDS) {
    const hit = rules[rule](c, ctx, now, cfg);
    if (hit) {
      out.push({
        id: `sig:${c.id}:${rule}`,
        commitmentId: c.id,
        rule,
        severity: SEVERITY[rule],
        reason: hit.reason,
        inputs: hit.inputs,
        evaluatedAt,
      });
    }
  }
  return out.sort((a, b) => b.severity - a.severity || a.rule.localeCompare(b.rule));
}

/** Carry acknowledgements from previously stored signals onto freshly evaluated ones (F-32). */
export function carryAcknowledgements(fresh: RiskSignal[], previous: RiskSignal[]): RiskSignal[] {
  const byId = new Map(previous.map((s) => [s.id, s]));
  return fresh.map((s) => {
    const prev = byId.get(s.id);
    return prev?.acknowledgedUntil
      ? { ...s, acknowledgedUntil: prev.acknowledgedUntil, acknowledgedReason: prev.acknowledgedReason, acknowledgedBy: prev.acknowledgedBy }
      : s;
  });
}

export function isActive(s: RiskSignal, now: Date): boolean {
  return !s.acknowledgedUntil || Date.parse(s.acknowledgedUntil) <= now.getTime();
}

/** Health = highest severity among unacknowledged signals: 5 critical, 4 at risk, 2-3 watch. */
export function healthOf(signals: RiskSignal[], now: Date): Health {
  const max = signals.filter((s) => isActive(s, now)).reduce((m, s) => Math.max(m, s.severity), 0);
  if (max >= 5) return 'critical';
  if (max === 4) return 'at_risk';
  if (max >= 2) return 'watch';
  return 'on_track';
}

const HEALTH_RANK: Record<Health, number> = { on_track: 0, watch: 1, at_risk: 2, critical: 3 };

export function worstHealth(list: Health[]): Health {
  return list.reduce<Health>((w, h) => (HEALTH_RANK[h] > HEALTH_RANK[w] ? h : w), 'on_track');
}

export function compareHealth(a: Health, b: Health): number {
  return HEALTH_RANK[a] - HEALTH_RANK[b];
}
