// Commitment engine: creation, edits, priority and dashboard rollups.
// Pure functions shared by resolvers, Rovo actions and MCP tools (blueprint principle 5).
import { NewCommitmentInputSchema } from '../types/schemas';
import { daysBetween, toISODate } from './dates';
import { cleanQuote } from './discovery';
import { compareHealth, healthOf, isActive } from './risk';
import type { Account, Commitment, Evidence, Health, Priority, Result, RiskSignal, RuleId, Tier } from './types';
import { fail, isOpen, ok } from './types';

export const DEFAULT_TIER_PRIORITY: Record<Tier, Priority> = {
  enterprise: 'high',
  growth: 'normal',
  standard: 'normal',
};

export function derivePriority(tier: Tier, mapping: Record<Tier, Priority> = DEFAULT_TIER_PRIORITY): Priority {
  return mapping[tier];
}

export interface Actor {
  accountId: string;
}

export type IdGen = (prefix: string) => string;

/** Log a commitment manually (F-01). Manual entries are human-confirmed by definition. */
export function createCommitment(
  raw: unknown,
  account: Account,
  actor: Actor,
  now: Date,
  newId: IdGen,
): Result<{ commitment: Commitment; evidence: Evidence | null }> {
  const parsed = NewCommitmentInputSchema.safeParse(raw);
  if (!parsed.success) {
    return fail('validation', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const input = parsed.data;
  if (input.accountId !== account.id) return fail('validation', 'accountId does not match the account.');

  const ts = now.toISOString();
  const commitment: Commitment = {
    id: newId('cmt'),
    accountId: account.id,
    title: input.title,
    status: input.ownerAccountId ? 'assigned' : 'confirmed',
    ownerAccountId: input.ownerAccountId,
    dueDate: input.dueDate,
    dueDateSource: input.dueDate ? input.dueDateSource === 'unknown' ? 'stated' : input.dueDateSource : 'unknown',
    confirmedDueDate: input.dueDate,
    priority: derivePriority(account.tier),
    priorityOverridden: false,
    issueKeys: [],
    version: 1,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.accountId,
    confirmedAt: ts,
    assignedAt: input.ownerAccountId ? ts : null,
  };
  const evidence: Evidence | null = input.evidence
    ? {
        id: `${commitment.id}:1`,
        commitmentId: commitment.id,
        sourceType: input.evidence.sourceType,
        sourceUrl: input.evidence.sourceUrl,
        quote: cleanQuote(input.evidence.quote),
        capturedAt: ts,
      }
    : null;
  return ok({ commitment, evidence });
}

export interface HistoryRow {
  commitmentId: string;
  at: string;
  field: string;
  from: unknown;
  to: unknown;
  by: string;
  reason?: string;
}

export type CommitmentPatch = Partial<
  Pick<Commitment, 'title' | 'ownerAccountId' | 'dueDate' | 'dueDateSource' | 'priority' | 'issueKeys'>
>;

/**
 * Apply an edit with optimistic concurrency. Returns the new record plus one
 * history row per changed field. A due date change requires a reason (F5 guard).
 */
export function applyPatch(
  c: Commitment,
  patch: CommitmentPatch,
  expectedVersion: number,
  actor: Actor,
  now: Date,
  reason?: string,
): Result<{ commitment: Commitment; history: HistoryRow[] }> {
  if (expectedVersion !== c.version) return fail('conflict', 'Changed by someone else. Reload to see the latest.');
  if (!isOpen(c.status) && c.status !== 'delivered') return fail('validation', `A ${c.status} commitment cannot be edited.`);
  if (patch.title !== undefined && !patch.title.trim()) return fail('validation', 'Title cannot be empty.');
  if (patch.dueDate !== undefined && patch.dueDate !== c.dueDate && c.dueDate && !reason?.trim()) {
    return fail('validation', 'A reason is required to change the due date.');
  }

  const at = now.toISOString();
  const next: Commitment = { ...c };
  const history: HistoryRow[] = [];
  for (const [field, value] of Object.entries(patch) as [keyof CommitmentPatch, unknown][]) {
    if (value === undefined) continue;
    const prev = c[field];
    if (JSON.stringify(prev) === JSON.stringify(value)) continue;
    (next as Record<string, unknown>)[field] = value;
    history.push({ commitmentId: c.id, at, field, from: prev, to: value, by: actor.accountId, reason });
  }
  if (history.length === 0) return ok({ commitment: c, history });

  if (patch.priority !== undefined) next.priorityOverridden = true;
  if (patch.ownerAccountId && !c.assignedAt) next.assignedAt = at;
  if (patch.ownerAccountId && c.status === 'confirmed') {
    next.status = 'assigned';
    history.push({ commitmentId: c.id, at, field: 'status', from: c.status, to: 'assigned', by: actor.accountId });
  }
  if (patch.ownerAccountId === null && c.status === 'assigned') {
    next.status = 'confirmed';
    history.push({ commitmentId: c.id, at, field: 'status', from: c.status, to: 'confirmed', by: actor.accountId });
  }
  if (patch.dueDate && !c.confirmedDueDate) next.confirmedDueDate = patch.dueDate;
  next.version = c.version + 1;
  next.updatedAt = at;
  return ok({ commitment: next, history });
}

// ---------- List views ----------

export interface CommitmentRow extends Commitment {
  accountName: string;
  health: Health;
  /** Reason of the most severe active signal, for the "why" column. */
  topReason: string | null;
}

export function commitmentRows(
  commitments: Commitment[],
  accounts: Pick<Account, 'id' | 'name'>[],
  signals: RiskSignal[],
  now: Date,
): CommitmentRow[] {
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const byCmt = new Map<string, RiskSignal[]>();
  for (const s of signals) if (isActive(s, now)) byCmt.set(s.commitmentId, [...(byCmt.get(s.commitmentId) ?? []), s]);
  return commitments.map((c) => {
    const sigs = (byCmt.get(c.id) ?? []).sort((a, b) => b.severity - a.severity);
    return {
      ...c,
      accountName: names.get(c.accountId) ?? 'Unknown account',
      health: isOpen(c.status) ? healthOf(sigs, now) : 'on_track',
      topReason: sigs[0]?.reason ?? null,
    };
  });
}

export interface AccountRollup extends Account {
  open: number;
  atRisk: number;
  overdue: number;
  nextDue: string | null;
  health: Health;
}

/** Account table columns (F2): counts, next due date and worst health of open commitments. */
export function accountRollups(accounts: Account[], rows: CommitmentRow[], signals: RiskSignal[], now: Date): AccountRollup[] {
  const today = toISODate(now);
  const overdueIds = new Set(signals.filter((s) => s.rule === 'R1' && isActive(s, now)).map((s) => s.commitmentId));
  return accounts.map((a) => {
    const open = rows.filter((r) => r.accountId === a.id && isOpen(r.status));
    const upcoming = open.map((r) => r.dueDate).filter((d): d is string => !!d && d >= today).sort();
    return {
      ...a,
      open: open.length,
      atRisk: open.filter((r) => compareHealth(r.health, 'at_risk') >= 0).length,
      overdue: open.filter((r) => overdueIds.has(r.id)).length,
      nextDue: upcoming[0] ?? null,
      health: open.reduce<Health>((w, r) => (compareHealth(r.health, w) > 0 ? r.health : w), 'on_track'),
    };
  });
}

// ---------- Risks screen (F7) ----------

export interface RiskItem {
  signalId: string;
  rule: RuleId;
  commitmentId: string;
  title: string;
  accountName: string;
  reason: string;
  ownerAccountId: string | null;
  dueDate: string | null;
  health: Health;
  acknowledgedUntil?: string;
  acknowledgedReason?: string;
  acknowledgedBy?: string;
}

export interface RiskGroup {
  rule: RuleId;
  severity: number;
  items: RiskItem[];
}

/**
 * Signals grouped by rule, most severe rule first; items in a group by due date. Signals of
 * closed commitments are dropped. Acknowledged signals (still inside their window) are
 * returned separately so the screen can fold them away (F-32).
 */
export function groupRisks(rows: CommitmentRow[], signals: RiskSignal[], now: Date): { groups: RiskGroup[]; acknowledged: RiskItem[] } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const groups = new Map<RuleId, RiskGroup>();
  const acknowledged: RiskItem[] = [];
  for (const s of signals) {
    const r = byId.get(s.commitmentId);
    if (!r || !isOpen(r.status)) continue;
    const item: RiskItem = {
      signalId: s.id, rule: s.rule, commitmentId: r.id, title: r.title, accountName: r.accountName, reason: s.reason,
      ownerAccountId: r.ownerAccountId, dueDate: r.dueDate, health: r.health,
      acknowledgedUntil: s.acknowledgedUntil, acknowledgedReason: s.acknowledgedReason, acknowledgedBy: s.acknowledgedBy,
    };
    if (!isActive(s, now)) { acknowledged.push(item); continue; }
    const g = groups.get(s.rule) ?? { rule: s.rule, severity: s.severity, items: [] };
    g.items.push(item);
    groups.set(s.rule, g);
  }
  const byDue = (a: RiskItem, b: RiskItem) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
  return {
    groups: [...groups.values()].map((g) => ({ ...g, items: g.items.sort(byDue) })).sort((a, b) => b.severity - a.severity || a.rule.localeCompare(b.rule)),
    acknowledged: acknowledged.sort(byDue),
  };
}

// ---------- Dashboard ----------

export interface AttentionRow {
  commitmentId: string;
  title: string;
  accountId: string;
  health: Health;
  severity: number;
  reason: string;
  ownerAccountId: string | null;
  dueDate: string | null;
}

export interface Dashboard {
  counts: { open: number; atRisk: number; overdue: number; noOwner: number };
  attention: AttentionRow[];
  upcoming: Array<Pick<Commitment, 'id' | 'title' | 'accountId' | 'dueDate'> & { health: Health }>;
  delivered: Array<Pick<Commitment, 'id' | 'title' | 'accountId' | 'updatedAt'>>;
}

export type CommitmentView = '' | 'mine' | 'unassigned' | 'at_risk' | 'overdue';

/**
 * The saved views (F4) as one rule, shared by the dashboard KPIs and the Commitments list so
 * the numbers always match (F-31). Every view is limited to open commitments. Overdue is a
 * fact about the date, so an acknowledged R1 still counts as overdue.
 */
export function matchesView(
  r: Pick<Commitment, 'status' | 'ownerAccountId' | 'dueDate'> & { health: Health },
  view: CommitmentView,
  me: string | undefined,
  today: string,
): boolean {
  if (!isOpen(r.status)) return false;
  switch (view) {
    case 'mine': return !!me && r.ownerAccountId === me;
    case 'unassigned': return !r.ownerAccountId;
    case 'at_risk': return compareHealth(r.health, 'at_risk') >= 0;
    case 'overdue': return !!r.dueDate && r.dueDate < today;
    default: return true;
  }
}

export function buildDashboard(commitments: Commitment[], signals: RiskSignal[], now: Date): Dashboard {
  const today = toISODate(now);
  const byCmt = new Map<string, RiskSignal[]>();
  for (const s of signals) if (isActive(s, now)) byCmt.set(s.commitmentId, [...(byCmt.get(s.commitmentId) ?? []), s]);

  const open = commitments.filter((c) => isOpen(c.status));
  const healthFor = (c: Commitment) => healthOf(byCmt.get(c.id) ?? [], now);

  const attention: AttentionRow[] = open
    .map((c) => {
      const sigs = (byCmt.get(c.id) ?? []).sort((a, b) => b.severity - a.severity);
      const top = sigs[0];
      return top
        ? {
            commitmentId: c.id,
            title: c.title,
            accountId: c.accountId,
            health: healthFor(c),
            severity: top.severity,
            reason: top.reason,
            ownerAccountId: c.ownerAccountId,
            dueDate: c.dueDate,
          }
        : null;
    })
    .filter((r): r is AttentionRow => r !== null)
    .sort((a, b) => b.severity - a.severity || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
    .slice(0, 8);

  const upcoming = open
    .filter((c) => c.dueDate && daysBetween(today, c.dueDate) >= 0 && daysBetween(today, c.dueDate) <= 14)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .map((c) => ({ id: c.id, title: c.title, accountId: c.accountId, dueDate: c.dueDate, health: healthFor(c) }));

  const delivered = commitments
    .filter((c) => c.status === 'delivered' || c.status === 'communicated')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
    .map((c) => ({ id: c.id, title: c.title, accountId: c.accountId, updatedAt: c.updatedAt }));

  return {
    counts: (() => {
      const rows = open.map((c) => ({ ...c, health: healthFor(c) }));
      const n = (v: CommitmentView) => rows.filter((r) => matchesView(r, v, undefined, today)).length;
      return { open: n(''), atRisk: n('at_risk'), overdue: n('overdue'), noOwner: n('unassigned') };
    })(),
    attention,
    upcoming,
    delivered,
  };
}
