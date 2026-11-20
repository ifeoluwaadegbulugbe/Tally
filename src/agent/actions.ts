// Rovo agent actions (blueprint I) and, in T13, the MCP tools. Thin wrappers over the
// same engine the UI uses (principle 5). Outputs are small JSON; every failure is the H4
// envelope, and an unknown account or id is not_found, never an empty success, so the
// agent has nothing to invent from.
import { z } from 'zod';
import {
  candidateKey,
  cleanQuote,
  commitmentRows,
  describeRules,
  extractDate,
  fail,
  findDuplicates,
  healthOf,
  isActive,
  isOpen,
  ok,
  suggestClass,
} from '../core';
import type { Account, CandidateClass, CommitmentRow, Health, Result } from '../core';
import type { Candidate } from '../core/scan';
import type { Repo } from '../storage/repo';

/** Source marker for text pasted into Rovo chat (no URL exists; the agent must not make one up). */
export const ROVO_CHAT_SOURCE = 'urn:tally:rovo-chat';

export interface AgentDeps {
  repo: Repo;
  /** Display names for account ids (Jira); may return {} if Jira is unreachable. */
  names: (ids: string[]) => Promise<Record<string, string>>;
  actor: { accountId: string };
  now: Date;
}

const MAX_ROWS = 20;
const HEALTH = ['on_track', 'watch', 'at_risk', 'critical'] as const;
const STATUS = ['confirmed', 'assigned', 'in_delivery', 'delivered', 'communicated', 'renegotiated', 'cancelled'] as const;

// Shared input schemas (also used by the MCP tools in T13).
export const FindInput = z.object({
  account: z.string().trim().min(1).max(120).optional(),
  owner: z.string().trim().min(1).max(120).optional(),
  status: z.enum(STATUS).optional(),
  health: z.enum(HEALTH).optional(),
  text: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_ROWS).optional(),
});
export const AccountInput = z.object({ account: z.string().trim().min(1).max(120) });
export const CommitmentIdInput = z.object({ commitmentId: z.string().trim().min(1).max(64) });
export const ProposeInput = z.object({
  account: z.string().trim().min(1).max(120).optional(),
  quote: z.string().trim().min(8).max(600),
  sourceUrl: z.string().trim().url().optional(),
  suggestedClass: z.enum(['confirmed', 'possible', 'suggestion', 'ambiguous']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export const DraftInput = z.object({
  account: z.string().trim().min(1).max(120),
  commitmentIds: z.string().trim().max(400).optional(), // comma separated: Rovo inputs are scalars
});

function parse<T>(schema: z.ZodType<T>, raw: unknown): Result<T> {
  // Rovo sends empty strings for unused optional inputs; treat them as absent.
  const clean = Object.fromEntries(
    Object.entries((raw ?? {}) as Record<string, unknown>).filter(([k, v]) => k !== 'context' && v !== '' && v !== null && v !== undefined),
  );
  const r = schema.safeParse(clean);
  return r.success ? ok(r.data) : fail('validation', r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
}

/** Match an account by id, exact name, or a unique partial name (case-insensitive). */
export function matchAccount(accounts: Account[], query: string): Result<Account> {
  const q = query.trim().toLowerCase();
  const exact = accounts.find((a) => a.id === query || a.name.toLowerCase() === q);
  if (exact) return ok(exact);
  const partial = accounts.filter((a) => a.name.toLowerCase().includes(q));
  if (partial.length === 1) return ok(partial[0]!);
  if (partial.length > 1) return fail('validation', `"${query}" matches several accounts: ${partial.map((a) => a.name).join(', ')}. Use the full name.`);
  return fail('not_found', `No account named "${query}". Known accounts: ${accounts.map((a) => a.name).join(', ') || 'none'}.`);
}

async function rowsWithNames(d: AgentDeps) {
  const { signals, commitments } = await d.repo.evaluateAll(d.now);
  const accounts = await d.repo.listAccounts();
  const rows = commitmentRows(commitments, accounts, signals, d.now);
  const names = await d.names(rows.map((r) => r.ownerAccountId).filter((x): x is string => !!x));
  return { rows, accounts, signals, names };
}

const ownerLabel = (id: string | null, names: Record<string, string>) => (id ? (names[id] ?? 'Assigned (name unavailable)') : 'Unassigned');

function brief(r: CommitmentRow, names: Record<string, string>) {
  return {
    id: r.id,
    title: r.title,
    account: r.accountName,
    owner: ownerLabel(r.ownerAccountId, names),
    due: r.dueDate,
    status: r.status,
    health: isOpen(r.status) ? r.health : null,
    topRisk: isOpen(r.status) ? r.topReason : null,
  };
}

// ---------- find-commitments ----------

export async function findCommitments(raw: unknown, d: AgentDeps) {
  const input = parse(FindInput, raw);
  if (!input.ok) return input;
  const f = input.data;
  const { rows, accounts, names } = await rowsWithNames(d);
  let list = rows;
  if (f.account) {
    const a = matchAccount(accounts, f.account);
    if (!a.ok) return a;
    list = list.filter((r) => r.accountId === a.data.id);
  }
  if (f.owner) {
    const o = f.owner.toLowerCase();
    list = list.filter((r) =>
      o === 'me' ? r.ownerAccountId === d.actor.accountId
        : o === 'unassigned' || o === 'none' ? !r.ownerAccountId
        : ownerLabel(r.ownerAccountId, names).toLowerCase().includes(o));
  }
  if (f.status) list = list.filter((r) => r.status === f.status);
  else list = list.filter((r) => isOpen(r.status)); // default: what is still owed
  if (f.health) list = list.filter((r) => r.health === f.health);
  if (f.text) {
    const t = f.text.toLowerCase();
    list = list.filter((r) => `${r.title} ${r.id}`.toLowerCase().includes(t));
  }
  const rank: Record<Health, number> = { critical: 0, at_risk: 1, watch: 2, on_track: 3 };
  list.sort((a, b) => rank[a.health] - rank[b.health] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const limit = f.limit ?? MAX_ROWS;
  return ok({
    count: list.length,
    shown: Math.min(list.length, limit),
    commitments: list.slice(0, limit).map((r) => brief(r, names)),
    note: list.length === 0 ? 'No commitments found for these filters.' : undefined,
  });
}

// ---------- get-account-health ----------

export async function getAccountHealth(raw: unknown, d: AgentDeps) {
  const input = parse(AccountInput, raw);
  if (!input.ok) return input;
  const { rows, accounts, signals, names } = await rowsWithNames(d);
  const a = matchAccount(accounts, input.data.account);
  if (!a.ok) return a;
  const mine = rows.filter((r) => r.accountId === a.data.id);
  const open = mine.filter((r) => isOpen(r.status));
  const counts = { on_track: 0, watch: 0, at_risk: 0, critical: 0 } as Record<Health, number>;
  for (const r of open) counts[r.health]++;
  const openIds = new Set(open.map((r) => r.id));
  const top = signals
    .filter((s) => openIds.has(s.commitmentId) && isActive(s, d.now))
    .sort((x, y) => y.severity - x.severity)
    .slice(0, 5)
    .map((s) => ({ commitmentId: s.commitmentId, title: mine.find((r) => r.id === s.commitmentId)?.title, rule: s.rule, reason: s.reason }));
  return ok({
    account: a.data.name,
    tier: a.data.tier,
    renewalDate: a.data.renewalDate,
    open: open.length,
    delivered: mine.filter((r) => r.status === 'delivered' || r.status === 'communicated').length,
    byHealth: counts,
    topSignals: top,
    needsAttention: open.filter((r) => r.health === 'critical' || r.health === 'at_risk').map((r) => brief(r, names)),
  });
}

// ---------- explain-risk ----------

export async function explainRisk(raw: unknown, d: AgentDeps) {
  const input = parse(CommitmentIdInput, raw);
  if (!input.ok) return input;
  const id = input.data.commitmentId;
  const { rows, signals, names } = await rowsWithNames(d);
  const row = rows.find((r) => r.id === id || r.id.toLowerCase() === id.toLowerCase());
  if (!row) return fail('not_found', `No commitment with id ${id}. Use find-commitments to get ids.`);
  const [settings, evidence, issues] = await Promise.all([d.repo.getSettings(), d.repo.listEvidence(row.id), d.repo.listIssueSnapshots()]);
  const rules = describeRules(settings.rules);
  const mine = signals.filter((s) => s.commitmentId === row.id);
  return ok({
    commitment: brief(row, names),
    health: isOpen(row.status) ? healthOf(mine, d.now) : null,
    signals: mine.map((s) => ({
      rule: s.rule,
      reason: s.reason,
      ruleText: rules[s.rule],
      acknowledged: !isActive(s, d.now) ? { until: s.acknowledgedUntil, reason: s.acknowledgedReason } : undefined,
    })),
    linkedIssues: row.issueKeys.map((k) => {
      const i = issues.find((x) => x.key === k);
      return i ? { key: k, status: i.statusName, flagged: i.flagged, due: i.dueDate } : { key: k, status: 'unknown' };
    }),
    evidence: evidence.map((e) => ({ quote: e.quote, source: e.sourceUrl })),
  });
}

// ---------- propose-candidate ----------

/**
 * Put a possible promise in the Tally inbox for a person to review. Never creates a
 * commitment. The quote must be words from the conversation or source; dates are only
 * kept if written in the quote.
 */
export async function proposeCandidate(raw: unknown, d: AgentDeps) {
  const input = parse(ProposeInput, raw);
  if (!input.ok) return input;
  const p = input.data;
  const [accounts, commitments] = await Promise.all([d.repo.listAccounts(), d.repo.listCommitments()]);
  let accountId: string | null = null;
  if (p.account) {
    const a = matchAccount(accounts, p.account);
    if (!a.ok) return a;
    accountId = a.data.id;
  }
  const quote = cleanQuote(p.quote);
  const names = accounts.map((a) => a.name);
  const rules = suggestClass(quote, names, !!accountId);
  const stated = extractDate(quote, d.now);
  // A date the agent supplies is only accepted if it is also what the quote says.
  const dueDate = p.dueDate && stated === p.dueDate ? p.dueDate : stated;
  const sourceUrl = p.sourceUrl ?? ROVO_CHAT_SOURCE;
  const cand: Candidate = {
    id: candidateKey(sourceUrl, quote),
    accountId,
    sourceType: 'agent',
    sourceUrl,
    sourceTitle: p.sourceUrl ? 'Proposed by Tally Agent' : 'Pasted into Rovo chat',
    quote,
    suggestedClass: (p.suggestedClass ?? rules.class) as CandidateClass,
    suggestedBy: p.suggestedClass ? 'agent' : 'rules',
    reason: p.suggestedClass ? `Tally Agent suggested "${p.suggestedClass}". Rules say: ${rules.reason}` : rules.reason,
    dueDate,
    duplicateOf: accountId ? findDuplicates(quote, accountId, commitments) : [],
    reviewState: 'unreviewed',
    createdAt: d.now.toISOString(),
  };
  const added = await d.repo.saveCandidates([cand]);
  return ok({
    candidateId: cand.id,
    added: added === 1,
    note: added === 1
      ? 'Added to the Tally inbox as unreviewed. A person must confirm it in Tally (Inbox) before it becomes a commitment.'
      : 'This quote is already in the Tally inbox.',
    account: accounts.find((a) => a.id === accountId)?.name ?? null,
    suggestedClass: cand.suggestedClass,
    dueDate,
    possibleDuplicates: cand.duplicateOf,
  });
}

// ---------- draft-customer-update ----------

/**
 * Deterministic draft from stored fields only, saved to Tally's Updates as a draft for a person
 * to edit and approve (F-41). Lists the ids it used. Never sends anything.
 */
export async function draftCustomerUpdate(raw: unknown, d: AgentDeps) {
  const input = parse(DraftInput, raw);
  if (!input.ok) return input;
  const a = matchAccount(await d.repo.listAccounts(), input.data.account);
  if (!a.ok) return a;
  const ids = input.data.commitmentIds?.split(',').map((x) => x.trim()).filter(Boolean);
  const draft = await d.repo.createDraft(a.data.id, ids, d.actor, d.now, 'agent');
  if (!draft.ok) return draft;
  return ok({
    account: a.data.name,
    draftId: draft.data.id,
    body: draft.data.body,
    usedCommitmentIds: draft.data.commitmentIds,
    note: 'Saved as a draft in Tally > Updates. A person must review and approve it there before anything is sent. Tally never sends messages.',
  });
}

// ---------- get-commitment-details (MCP, T13) ----------

/** One commitment in full: properties, evidence, delivery links, active signals, recent history. */
export async function getCommitmentDetails(raw: unknown, d: AgentDeps) {
  const input = parse(CommitmentIdInput, raw);
  if (!input.ok) return input;
  const { rows, signals, names } = await rowsWithNames(d);
  const id = input.data.commitmentId;
  const row = rows.find((r) => r.id === id || r.id.toLowerCase() === id.toLowerCase());
  if (!row) return fail('not_found', `No commitment with id ${id}. Use find_commitments to get ids.`);
  const [evidence, history, issues] = await Promise.all([d.repo.listEvidence(row.id), d.repo.listHistory(row.id), d.repo.listIssueSnapshots()]);
  return ok({
    ...brief(row, names),
    priority: row.priority,
    dueDateSource: row.dueDateSource,
    evidence: evidence.map((e) => ({ quote: e.quote, source: e.sourceUrl, capturedAt: e.capturedAt })),
    linkedIssues: row.issueKeys.map((k) => {
      const i = issues.find((x) => x.key === k);
      return i ? { key: k, summary: i.summary, status: i.statusName, done: i.statusCategory === 'done', flagged: i.flagged, due: i.dueDate } : { key: k, status: 'unknown' };
    }),
    signals: signals.filter((s) => s.commitmentId === row.id && isActive(s, d.now)).map((s) => ({ rule: s.rule, severity: s.severity, reason: s.reason })),
    recentHistory: history.slice(-5).reverse().map((h) => ({ at: h.at, change: h.field, from: h.from, to: h.to, reason: h.reason })),
  });
}

// ---------- identify-at-risk-commitments (MCP, T13) ----------

export const AtRiskInput = z.object({
  minSeverity: z.coerce.number().int().min(2).max(5).optional(),
  account: z.string().trim().min(1).max(120).optional(),
});

/** Open commitments with active rule hits at or above a severity, worst first, with every reason. */
export async function identifyAtRisk(raw: unknown, d: AgentDeps) {
  const input = parse(AtRiskInput, raw);
  if (!input.ok) return input;
  const min = input.data.minSeverity ?? 4;
  const { rows, accounts, signals, names } = await rowsWithNames(d);
  let accountId: string | undefined;
  if (input.data.account) {
    const a = matchAccount(accounts, input.data.account);
    if (!a.ok) return a;
    accountId = a.data.id;
  }
  const items = rows
    .filter((r) => isOpen(r.status) && (!accountId || r.accountId === accountId))
    .map((r) => {
      const hits = signals.filter((s) => s.commitmentId === r.id && isActive(s, d.now)).sort((a, b) => b.severity - a.severity);
      return { r, hits, worst: hits[0]?.severity ?? 0 };
    })
    .filter((x) => x.worst >= min)
    .sort((a, b) => b.worst - a.worst || (a.r.dueDate ?? '9999').localeCompare(b.r.dueDate ?? '9999'));
  return ok({
    minSeverity: min,
    count: items.length,
    commitments: items.slice(0, MAX_ROWS).map((x) => ({ ...brief(x.r, names), signals: x.hits.map((s) => ({ rule: s.rule, severity: s.severity, reason: s.reason })) })),
    note: items.length === 0 ? `No open commitments with a rule of severity ${min} or more.` : undefined,
  });
}
