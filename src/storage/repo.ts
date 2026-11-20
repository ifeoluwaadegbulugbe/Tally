// Tally repository: typed access to every entity in the KV store (blueprint H6).
//
// Key design (type:id; trailing ':' on child prefixes so "c1" never matches "c10"):
//   acct:{id}                     Account
//   cmt:{id}                      Commitment (versioned)
//   ev:{cmtId}:{nnnn}             Evidence
//   hist:{cmtId}:{iso}:{seq}      History row
//   sig:{cmtId}:{rule}            Risk signal (acknowledgement survives re-evaluation)
//   issue:{key}                   Issue snapshot cache (demo data until Jira sync, T08)
//   cand:{id}                     Discovery candidate (T10)
//   draft:{id}                    Customer update draft (T15)
//   settings                      Settings singleton
//
// Lists read a whole prefix and filter in memory. That is fine for hundreds of
// commitments per site; move to KVS custom entities with indexes if it grows (V5).
// KVS plain keys have no conditional write, so the version check is read-then-write:
// it catches stale edits from the UI, but two saves in the same instant could race.
import {
  buildDemoData,
  carryAcknowledgements,
  createCommitment,
  applyPatch,
  canTransition,
  deriveSystemStatus,
  evaluateRisks,
  fail,
  ok,
  DEFAULT_RULE_CONFIG,
  DEFAULT_TIER_PRIORITY,
  cleanQuote,
  draftUpdate,
  DRAFT_MAX_BODY,
} from '../core';
import type {
  Account,
  Actor,
  Commitment,
  CommitmentPatch,
  Evidence,
  HistoryRow,
  IdGen,
  IssueSnapshot,
  Priority,
  Result,
  RiskSignal,
  RuleConfig,
  Tier,
  UpdateDraft,
} from '../core';
import { AccountSchema, EvidenceSchema, RuleConfigSchema } from '../types/schemas';
import type { KV } from './kv';
import { extractCandidates, proposedTitle } from '../core/scan';
import type { Candidate } from '../core/scan';

export const keys = {
  acct: (id: string) => `acct:${id}`,
  cmt: (id: string) => `cmt:${id}`,
  ev: (cmtId: string, n: number) => `ev:${cmtId}:${String(n).padStart(4, '0')}`,
  evPrefix: (cmtId: string) => `ev:${cmtId}:`,
  // seq orders rows written together; the random suffix stops same-millisecond writes colliding.
  hist: (cmtId: string, at: string, seq: number) =>
    `hist:${cmtId}:${at}:${String(seq).padStart(2, '0')}:${crypto.randomUUID().slice(0, 6)}`,
  histPrefix: (cmtId: string) => `hist:${cmtId}:`,
  sig: (cmtId: string, rule: string) => `sig:${cmtId}:${rule}`,
  cand: (id: string) => `cand:${id}`,
  draft: (id: string) => `draft:${id}`,
  sigPrefix: (cmtId: string) => `sig:${cmtId}:`,
  issue: (key: string) => `issue:${key}`,
  settings: 'settings',
};

/** Every prefix the app writes; deleteAll removes exactly these. */
const ALL_PREFIXES = ['acct:', 'cmt:', 'ev:', 'hist:', 'sig:', 'issue:', 'cand:', 'draft:'];

export interface Settings {
  rules: RuleConfig;
  scanScope: { projectKeys: string[]; spaceKeys: string[]; includeComments: boolean };
  tierPriority: Record<Tier, Priority>;
  demoLoadedAt: string | null;
  lastScanAt?: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  rules: DEFAULT_RULE_CONFIG,
  scanScope: { projectKeys: [], spaceKeys: [], includeComments: true },
  tierPriority: DEFAULT_TIER_PRIORITY,
  demoLoadedAt: null,
};

export interface CommitmentFilter {
  accountId?: string;
  status?: Commitment['status'];
  ownerAccountId?: string | null;
}

export const defaultId: IdGen = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export class Repo {
  constructor(
    private readonly kv: KV,
    private readonly newId: IdGen = defaultId,
  ) {}

  // ---------- Accounts ----------

  async listAccounts(): Promise<Account[]> {
    const rows = await this.kv.list<Account>('acct:');
    return rows.map((r) => r.value).sort((a, b) => a.name.localeCompare(b.name));
  }

  getAccount(id: string): Promise<Account | undefined> {
    return this.kv.get<Account>(keys.acct(id));
  }

  async saveAccount(raw: unknown): Promise<Result<Account>> {
    const withId = { id: this.newId('acct'), ...(raw as object) };
    const parsed = AccountSchema.safeParse(withId);
    if (!parsed.success) return fail('validation', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const existing = await this.listAccounts();
    const clash = existing.find((a) => a.id !== parsed.data.id && a.name.toLowerCase() === parsed.data.name.toLowerCase());
    if (clash) return fail('conflict', `An account named ${clash.name} already exists.`);
    await this.kv.set(keys.acct(parsed.data.id), parsed.data);
    return ok(parsed.data);
  }

  // ---------- Commitments ----------

  async listCommitments(filter: CommitmentFilter = {}): Promise<Commitment[]> {
    const rows = await this.kv.list<Commitment>('cmt:');
    return rows
      .map((r) => r.value)
      .filter((c) => (filter.accountId ? c.accountId === filter.accountId : true))
      .filter((c) => (filter.status ? c.status === filter.status : true))
      .filter((c) => (filter.ownerAccountId !== undefined ? c.ownerAccountId === filter.ownerAccountId : true));
  }

  getCommitment(id: string): Promise<Commitment | undefined> {
    return this.kv.get<Commitment>(keys.cmt(id));
  }

  async createCommitment(raw: unknown, actor: Actor, now: Date): Promise<Result<Commitment>> {
    const accountId = (raw as { accountId?: unknown })?.accountId;
    const account = typeof accountId === 'string' ? await this.getAccount(accountId) : undefined;
    if (!account) return fail('validation', 'accountId: unknown account');
    const settings = await this.getSettings();
    const res = createCommitment(raw, account, actor, now, this.newId);
    if (!res.ok) return res;
    const commitment = { ...res.data.commitment, priority: settings.tierPriority[account.tier] };
    const writes: Array<{ key: string; value: unknown }> = [{ key: keys.cmt(commitment.id), value: commitment }];
    if (res.data.evidence) writes.push({ key: keys.ev(commitment.id, 1), value: res.data.evidence });
    const created: HistoryRow = { commitmentId: commitment.id, at: commitment.createdAt, field: 'created', from: null, to: commitment.title, by: actor.accountId };
    writes.push({ key: keys.hist(commitment.id, created.at, 0), value: created });
    await this.kv.setMany(writes);
    return ok(commitment);
  }

  async updateCommitment(
    id: string,
    patch: CommitmentPatch,
    expectedVersion: number,
    actor: Actor,
    now: Date,
    reason?: string,
  ): Promise<Result<Commitment>> {
    const current = await this.getCommitment(id);
    if (!current) return fail('not_found', `Commitment ${id} not found.`);
    const res = applyPatch(current, patch, expectedVersion, actor, now, reason);
    if (!res.ok) return res;
    if (res.data.history.length === 0) return ok(current);
    // Re-read just before writing to narrow the race window (no conditional writes on plain keys).
    const latest = await this.getCommitment(id);
    if (latest?.version !== current.version) return fail('conflict', 'Changed by someone else. Reload to see the latest.');
    await this.kv.setMany<unknown>([
      { key: keys.cmt(id), value: res.data.commitment },
      ...res.data.history.map((h, i) => ({ key: keys.hist(id, h.at, i + 1), value: h })),
    ]);
    return ok(res.data.commitment);
  }

  /**
   * Owner-driven transitions (section C): cancel needs a reason and records whether the
   * customer was told; renegotiate needs a reason and a new date. A renegotiated date is a
   * new agreement, so it also becomes the confirmed date (R7 compares against it).
   */
  async transitionCommitment(
    id: string,
    input: { action: 'cancel' | 'renegotiate'; reason?: string; newDueDate?: string; customerInformed?: boolean },
    expectedVersion: number,
    actor: Actor,
    now: Date,
  ): Promise<Result<Commitment>> {
    const current = await this.getCommitment(id);
    if (!current) return fail('not_found', `Commitment ${id} not found.`);
    if (current.version !== expectedVersion) return fail('conflict', 'Changed by someone else. Reload to see the latest.');
    const to = input.action === 'cancel' ? 'cancelled' : 'renegotiated';
    if (input.newDueDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.newDueDate)) {
      return fail('validation', 'newDueDate: expected a date as YYYY-MM-DD');
    }
    const check = canTransition(current.status, to, current, { reason: input.reason, newDueDate: input.newDueDate });
    if (!check.ok) return fail('validation', check.reason);

    const at = now.toISOString();
    const reason = input.reason!.trim();
    const next: Commitment = { ...current, status: to, version: current.version + 1, updatedAt: at };
    const history: HistoryRow[] = [{ commitmentId: id, at, field: 'status', from: current.status, to, by: actor.accountId, reason }];
    if (to === 'renegotiated') {
      next.dueDate = input.newDueDate!;
      next.confirmedDueDate = input.newDueDate!;
      next.dueDateSource = 'stated';
      history.push({ commitmentId: id, at, field: 'dueDate', from: current.dueDate, to: input.newDueDate, by: actor.accountId, reason });
    } else {
      history.push({ commitmentId: id, at, field: 'customerInformed', from: null, to: input.customerInformed === true, by: actor.accountId });
    }
    await this.kv.setMany<unknown>([
      { key: keys.cmt(id), value: next },
      ...history.map((h, i) => ({ key: keys.hist(id, at, i + 1), value: h })),
    ]);
    return ok(next);
  }

  // ---------- Discovery candidates (F-03..F-13) ----------

  async listCandidates(state?: Candidate['reviewState']): Promise<Candidate[]> {
    return (await this.kv.list<Candidate>('cand:'))
      .map((r) => r.value)
      .filter((c) => (state ? c.reviewState === state : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  getCandidate(id: string): Promise<Candidate | undefined> {
    return this.kv.get<Candidate>(keys.cand(id));
  }

  /** Store new candidates; ones already seen (same source and quote) are skipped. Returns how many were added. */
  async saveCandidates(list: Candidate[]): Promise<number> {
    if (list.length === 0) return 0;
    const existing = new Set((await this.kv.list<Candidate>('cand:')).map((r) => r.value.id));
    const fresh = [...new Map(list.filter((c) => !existing.has(c.id)).map((c) => [c.id, c])).values()];
    if (fresh.length) await this.kv.setMany(fresh.map((c) => ({ key: keys.cand(c.id), value: c })));
    return fresh.length;
  }

  /**
   * A human decides on a candidate (F-11). Confirm creates the commitment with the quote as
   * evidence; edits may set account, title, due date and owner. Reject needs a reason.
   * Nothing is ever confirmed without this call (O10).
   */
  async reviewCandidate(
    id: string,
    decision: 'confirm' | 'reject' | 'ambiguous',
    input: { accountId?: string | null; title?: string; dueDate?: string | null; ownerAccountId?: string | null; reason?: string },
    actor: Actor,
    now: Date,
  ): Promise<Result<{ candidate: Candidate; commitment: Commitment | null }>> {
    const cand = await this.getCandidate(id);
    if (!cand) return fail('not_found', `Candidate ${id} not found.`);
    if (cand.reviewState === 'confirmed' || cand.reviewState === 'rejected') {
      return fail('conflict', `This candidate was already ${cand.reviewState}.`);
    }
    const at = now.toISOString();
    const reviewed = { ...cand, reviewedBy: actor.accountId, reviewedAt: at };

    if (decision === 'reject') {
      if (!input.reason?.trim()) return fail('validation', 'A reason is required to reject.');
      const next: Candidate = { ...reviewed, reviewState: 'rejected', rejectReason: input.reason.trim() };
      await this.kv.set(keys.cand(id), next);
      return ok({ candidate: next, commitment: null });
    }
    if (decision === 'ambiguous') {
      const next: Candidate = { ...reviewed, reviewState: 'ambiguous' };
      await this.kv.set(keys.cand(id), next);
      return ok({ candidate: next, commitment: null });
    }

    const accountId = input.accountId ?? cand.accountId;
    if (!accountId) return fail('validation', 'Choose the account this promise was made to.');
    const dueDate = input.dueDate === undefined ? cand.dueDate : input.dueDate;
    const created = await this.createCommitment(
      {
        accountId,
        title: (input.title ?? proposedTitle(cand.quote)).trim(),
        ownerAccountId: input.ownerAccountId ?? null,
        dueDate,
        dueDateSource: dueDate ? (dueDate === cand.dueDate ? 'stated' : 'estimated') : 'unknown',
        evidence: { sourceType: cand.sourceType === 'jira' || cand.sourceType === 'confluence' ? cand.sourceType : 'manual', sourceUrl: cand.sourceUrl, quote: cand.quote },
      },
      actor,
      now,
    );
    if (!created.ok) return created;
    const next: Candidate = { ...reviewed, accountId, reviewState: 'confirmed', commitmentId: created.data.id };
    await this.kv.set(keys.cand(id), next);
    return ok({ candidate: next, commitment: created.data });
  }

  // ---------- Evidence and history ----------

  async listEvidence(commitmentId: string): Promise<Evidence[]> {
    return (await this.kv.list<Evidence>(keys.evPrefix(commitmentId))).map((r) => r.value);
  }

  async evidenceCounts(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const { value } of await this.kv.list<Evidence>('ev:')) {
      counts.set(value.commitmentId, (counts.get(value.commitmentId) ?? 0) + 1);
    }
    return counts;
  }

  async addEvidence(
    commitmentId: string,
    input: Pick<Evidence, 'sourceType' | 'sourceUrl' | 'quote'> & { author?: string },
    actor: Actor,
    now: Date,
  ): Promise<Result<Evidence>> {
    if (!(await this.getCommitment(commitmentId))) return fail('not_found', `Commitment ${commitmentId} not found.`);
    const existing = await this.listEvidence(commitmentId);
    const n = existing.length + 1;
    const parsed = EvidenceSchema.safeParse({
      ...input,
      id: `${commitmentId}:${n}`,
      commitmentId,
      quote: cleanQuote(input.quote),
      capturedAt: now.toISOString(),
    });
    if (!parsed.success) return fail('validation', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const at = now.toISOString();
    await this.kv.setMany<unknown>([
      { key: keys.ev(commitmentId, n), value: parsed.data },
      { key: keys.hist(commitmentId, at, 50), value: { commitmentId, at, field: 'evidence', from: null, to: parsed.data.sourceUrl, by: actor.accountId } satisfies HistoryRow },
    ]);
    return ok(parsed.data);
  }

  async listHistory(commitmentId: string): Promise<HistoryRow[]> {
    return (await this.kv.list<HistoryRow>(keys.histPrefix(commitmentId))).map((r) => r.value);
  }

  // ---------- Signals ----------

  async listSignals(commitmentId?: string): Promise<RiskSignal[]> {
    return (await this.kv.list<RiskSignal>(commitmentId ? keys.sigPrefix(commitmentId) : 'sig:')).map((r) => r.value);
  }

  /**
   * Acknowledge a risk signal until the end of a chosen day (F-32): it stops counting toward
   * health and the attention list, then reappears. Needs a reason; at most 90 days ahead.
   * `until: null` clears an acknowledgement. Both write a history row on the commitment.
   */
  async acknowledgeSignal(
    signalId: string,
    until: string | null,
    reason: string | undefined,
    actor: Actor,
    now: Date,
  ): Promise<Result<RiskSignal>> {
    const m = /^sig:(.+):(R[1-9])$/.exec(signalId);
    if (!m) return fail('validation', 'Unknown signal id.');
    const [, cmtId, rule] = m as unknown as [string, string, string];
    const sig = await this.kv.get<RiskSignal>(keys.sig(cmtId, rule));
    if (!sig) return fail('not_found', 'That risk is no longer active.');
    const at = now.toISOString();
    let next: RiskSignal;
    if (until === null) {
      next = { ...sig };
      delete next.acknowledgedUntil;
      delete next.acknowledgedReason;
      delete next.acknowledgedBy;
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return fail('validation', 'until: expected YYYY-MM-DD.');
      if (!reason?.trim()) return fail('validation', 'A reason is required to acknowledge a risk.');
      const today = at.slice(0, 10);
      const days = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
      if (days < 0) return fail('validation', 'Pick today or a later date.');
      if (days > 90) return fail('validation', 'Acknowledge for 90 days at most.');
      next = { ...sig, acknowledgedUntil: `${until}T23:59:59.999Z`, acknowledgedReason: reason.trim(), acknowledgedBy: actor.accountId };
    }
    await this.kv.setMany<unknown>([
      { key: keys.sig(cmtId, rule), value: next },
      {
        key: keys.hist(cmtId, at, 1),
        value: {
          commitmentId: cmtId, at, field: 'riskAcknowledged', from: sig.acknowledgedUntil ?? null,
          to: until === null ? null : `${rule} until ${until}`, by: actor.accountId, reason: reason?.trim() || undefined,
        } satisfies HistoryRow,
      },
    ]);
    return ok(next);
  }

  /** Replace a commitment's stored signals, keeping acknowledgements that still apply. */
  async replaceSignals(commitmentId: string, fresh: RiskSignal[]): Promise<RiskSignal[]> {
    const previous = await this.listSignals(commitmentId);
    const merged = carryAcknowledgements(fresh, previous);
    const keep = new Set(merged.map((s) => s.id));
    const stale = previous.filter((s) => !keep.has(s.id)).map((s) => keys.sig(commitmentId, s.rule));
    if (stale.length) await this.kv.deleteMany(stale);
    if (merged.length) await this.kv.setMany(merged.map((s) => ({ key: keys.sig(commitmentId, s.rule), value: s })));
    return merged;
  }

  /**
   * Evaluate every rule for every commitment and persist the signals (F-30, on demand).
   * One read of each prefix and at most one batch write and one batch delete, so the
   * dashboard stays fast. A signal whose rule, reason and severity are unchanged keeps
   * its stored record (including evaluatedAt, i.e. when it first fired) and is not rewritten.
   */
  async evaluateAll(now: Date): Promise<{ signals: RiskSignal[]; commitments: Commitment[] }> {
    const [commitments, issues, counts, settings, stored] = await Promise.all([
      this.listCommitments(),
      this.listIssueSnapshots(),
      this.evidenceCounts(),
      this.getSettings(),
      this.listSignals(),
    ]);
    const previous = new Map(stored.map((s) => [s.id, s]));
    const signals: RiskSignal[] = [];
    const writes: Array<{ key: string; value: RiskSignal }> = [];
    for (const c of commitments) {
      const fresh = evaluateRisks(c, { issues, evidenceCount: counts.get(c.id) ?? 0 }, now, settings.rules);
      for (const s of carryAcknowledgements(fresh, stored)) {
        const prev = previous.get(s.id);
        if (prev && prev.reason === s.reason && prev.severity === s.severity) {
          signals.push(prev);
        } else {
          signals.push(s);
          writes.push({ key: keys.sig(s.commitmentId, s.rule), value: s });
        }
      }
    }
    const live = new Set(signals.map((s) => s.id));
    const stale = stored.filter((s) => !live.has(s.id)).map((s) => keys.sig(s.commitmentId, s.rule));
    await Promise.all([
      writes.length ? this.kv.setMany(writes) : undefined,
      stale.length ? this.kv.deleteMany(stale) : undefined,
    ]);
    return { signals, commitments };
  }

  /**
   * Apply system-driven lifecycle moves from the cached issue states (section C):
   * owned -> assigned -> in_delivery -> delivered, and delivered -> in_delivery if work
   * reopens. Each move writes a history row by "tally-system". Returns the moved IDs.
   */
  async applySystemStatuses(now: Date): Promise<string[]> {
    const [commitments, issues] = await Promise.all([this.listCommitments(), this.listIssueSnapshots()]);
    const at = now.toISOString();
    const writes: Array<{ key: string; value: unknown }> = [];
    const moved: string[] = [];
    for (const c of commitments) {
      const to = deriveSystemStatus(c, issues);
      if (!to) continue;
      moved.push(c.id);
      writes.push({ key: keys.cmt(c.id), value: { ...c, status: to, version: c.version + 1, updatedAt: at } satisfies Commitment });
      writes.push({
        key: keys.hist(c.id, at, 1),
        value: { commitmentId: c.id, at, field: 'status', from: c.status, to, by: 'tally-system' } satisfies HistoryRow,
      });
    }
    if (writes.length) await this.kv.setMany(writes);
    return moved;
  }

  // ---------- Customer update drafts (F-40, F-41) ----------

  async listDrafts(accountId?: string): Promise<UpdateDraft[]> {
    return (await this.kv.list<UpdateDraft>('draft:'))
      .map((r) => r.value)
      .filter((d) => (accountId ? d.accountId === accountId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getDraft(id: string): Promise<UpdateDraft | undefined> {
    return this.kv.get<UpdateDraft>(keys.draft(id));
  }

  /** Build a draft from stored, freshly evaluated fields only, and save it for review. */
  async createDraft(
    accountId: string,
    commitmentIds: string[] | undefined,
    actor: Actor,
    now: Date,
    source: UpdateDraft['source'] = 'ui',
  ): Promise<Result<UpdateDraft>> {
    const account = await this.getAccount(accountId);
    if (!account) return fail('not_found', `Account ${accountId} not found.`);
    const { signals, commitments } = await this.evaluateAll(now);
    let items = commitments.filter((c) => c.accountId === accountId);
    if (commitmentIds && commitmentIds.length > 0) {
      const unknown = commitmentIds.filter((id) => !items.some((c) => c.id === id));
      if (unknown.length) return fail('not_found', `Not commitments of ${account.name}: ${unknown.join(', ')}.`);
      items = items.filter((c) => commitmentIds.includes(c.id));
    }
    const built = draftUpdate(account, items, signals, now);
    if (built.used.length === 0) return fail('not_found', `${account.name} has no commitments to report on.`);
    const at = now.toISOString();
    const draft: UpdateDraft = {
      id: this.newId('upd'),
      accountId,
      commitmentIds: built.used,
      usedVersions: Object.fromEntries(items.filter((c) => built.used.includes(c.id)).map((c) => [c.id, c.version])),
      body: built.body,
      status: 'draft',
      source,
      version: 1,
      createdBy: actor.accountId,
      createdAt: at,
    };
    await this.kv.set(keys.draft(draft.id), draft);
    return ok(draft);
  }

  /** Commitments in the draft whose stored version moved since it was drafted. */
  async staleCommitments(d: UpdateDraft): Promise<string[]> {
    const now = await Promise.all(d.commitmentIds.map((id) => this.getCommitment(id)));
    return d.commitmentIds.filter((id, i) => !now[i] || now[i]!.version !== d.usedVersions[id]);
  }

  private async loadDraft(id: string, expectedVersion: number): Promise<Result<UpdateDraft>> {
    const d = await this.getDraft(id);
    if (!d) return fail('not_found', `Update ${id} not found.`);
    if (d.version !== expectedVersion) return fail('conflict', 'Changed by someone else. Reload to see the latest.');
    return ok(d);
  }

  /** Edit the wording while it is still a draft. Approved and sent text is frozen. */
  async editDraft(id: string, body: string, expectedVersion: number, actor: Actor, now: Date): Promise<Result<UpdateDraft>> {
    const loaded = await this.loadDraft(id, expectedVersion);
    if (!loaded.ok) return loaded;
    const d = loaded.data;
    if (d.status !== 'draft') return fail('validation', 'Only a draft can be edited. Approved and sent updates are frozen.');
    const text = body.replace(/\r\n/g, '\n').trim();
    if (!text) return fail('validation', 'body: the update cannot be empty.');
    if (text.length > DRAFT_MAX_BODY) return fail('validation', `body: at most ${DRAFT_MAX_BODY} characters.`);
    const next: UpdateDraft = { ...d, body: text, version: d.version + 1, editedBy: actor.accountId, editedAt: now.toISOString() };
    await this.kv.set(keys.draft(id), next);
    return ok(next);
  }

  /** Approve: a person vouches for the text. Refused if any commitment changed since drafting. */
  async approveDraft(id: string, expectedVersion: number, actor: Actor, now: Date): Promise<Result<UpdateDraft>> {
    const loaded = await this.loadDraft(id, expectedVersion);
    if (!loaded.ok) return loaded;
    const d = loaded.data;
    if (d.status !== 'draft') return fail('validation', `This update is already ${d.status}.`);
    const stale = await this.staleCommitments(d);
    if (stale.length) {
      return fail('conflict', `The facts changed since this was drafted (${stale.join(', ')}). Create a new draft.`);
    }
    const next: UpdateDraft = { ...d, status: 'approved', version: d.version + 1, approvedBy: actor.accountId, approvedAt: now.toISOString() };
    await this.kv.set(keys.draft(id), next);
    return ok(next);
  }

  /**
   * Record that a person sent the approved update (Tally never sends). Delivered commitments
   * it covers become communicated (section C: that move needs a sent update).
   */
  async markDraftSent(id: string, expectedVersion: number, actor: Actor, now: Date): Promise<Result<{ draft: UpdateDraft; communicated: string[] }>> {
    const loaded = await this.loadDraft(id, expectedVersion);
    if (!loaded.ok) return loaded;
    const d = loaded.data;
    if (d.status !== 'approved') return fail('validation', 'Approve the update before marking it sent.');
    const at = now.toISOString();
    const next: UpdateDraft = { ...d, status: 'sent', version: d.version + 1, sentBy: actor.accountId, sentAt: at };
    const writes: Array<{ key: string; value: unknown }> = [{ key: keys.draft(id), value: next }];
    const communicated: string[] = [];
    for (const cid of d.commitmentIds) {
      const c = await this.getCommitment(cid);
      if (!c || !canTransition(c.status, 'communicated', c, { hasSentUpdate: true }).ok) continue;
      communicated.push(cid);
      writes.push({ key: keys.cmt(cid), value: { ...c, status: 'communicated', version: c.version + 1, updatedAt: at } satisfies Commitment });
      writes.push({
        key: keys.hist(cid, at, 1),
        value: { commitmentId: cid, at, field: 'status', from: c.status, to: 'communicated', by: actor.accountId, reason: `Customer update ${id} sent` } satisfies HistoryRow,
      });
    }
    await this.kv.setMany(writes);
    return ok({ draft: next, communicated });
  }

  /** Discard an unsent update. Sent ones stay as the record of what the customer was told. */
  async discardDraft(id: string, expectedVersion: number): Promise<Result<{ id: string }>> {
    const loaded = await this.loadDraft(id, expectedVersion);
    if (!loaded.ok) return loaded;
    if (loaded.data.status === 'sent') return fail('validation', 'A sent update is kept as the record of what the customer was told.');
    await this.kv.delete(keys.draft(id));
    return ok({ id });
  }

  // ---------- Issue snapshot cache ----------

  async listIssueSnapshots(): Promise<IssueSnapshot[]> {
    return (await this.kv.list<IssueSnapshot>('issue:')).map((r) => r.value);
  }

  async saveIssueSnapshots(snapshots: IssueSnapshot[]): Promise<void> {
    await this.kv.setMany(snapshots.map((s) => ({ key: keys.issue(s.key), value: s })));
  }

  // ---------- Settings ----------

  async getSettings(): Promise<Settings> {
    const stored = await this.kv.get<Partial<Settings>>(keys.settings);
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      rules: RuleConfigSchema.parse({ ...DEFAULT_SETTINGS.rules, ...stored?.rules }),
      scanScope: { ...DEFAULT_SETTINGS.scanScope, ...stored?.scanScope },
      tierPriority: { ...DEFAULT_SETTINGS.tierPriority, ...stored?.tierPriority },
    };
  }

  async saveSettings(patch: Partial<Settings>): Promise<Result<Settings>> {
    const current = await this.getSettings();
    const next = { ...current, ...patch };
    const rules = RuleConfigSchema.safeParse(next.rules);
    if (!rules.success) return fail('validation', rules.error.issues.map((i) => `rules.${i.path.join('.')}: ${i.message}`).join('; '));
    next.rules = rules.data;
    await this.kv.set(keys.settings, next);
    return ok(next);
  }

  /** Every record Tally stores on this site, grouped by type (Settings > Data > Export). */
  async exportAll(now: Date): Promise<Record<string, unknown>> {
    const names: Record<string, string> = {
      'acct:': 'accounts', 'cmt:': 'commitments', 'ev:': 'evidence', 'hist:': 'history', 'sig:': 'riskSignals',
      'issue:': 'issueSnapshots', 'cand:': 'candidates', 'draft:': 'customerUpdates',
    };
    const out: Record<string, unknown> = { exportedAt: now.toISOString(), format: 'tally-export/1' };
    for (const prefix of ALL_PREFIXES) out[names[prefix] ?? prefix] = (await this.kv.list(prefix)).map((r) => r.value);
    out.settings = await this.getSettings();
    return out;
  }

  // ---------- Demo data and deletion ----------

  async isEmpty(): Promise<boolean> {
    return (await this.kv.list('acct:')).length === 0 && (await this.kv.list('cmt:')).length === 0;
  }

  /** Load the section P demo data. Refuses when data exists, so it never mixes with real records. */
  async seedDemo(now: Date, siteUrl?: string): Promise<Result<{ accounts: number; commitments: number; evidence: number }>> {
    if (!(await this.isEmpty())) return fail('conflict', 'Tally already has data. Reset it before loading demo data.');
    const demo = buildDemoData(now, siteUrl);
    const at = now.toISOString();
    await this.kv.setMany<unknown>([
      ...demo.accounts.map((a) => ({ key: keys.acct(a.id), value: a })),
      ...demo.commitments.map((c) => ({ key: keys.cmt(c.id), value: c })),
      ...demo.evidence.map((e) => ({ key: keys.ev(e.commitmentId, Number(e.id.split(':').pop())), value: e })),
      ...demo.issues.map((i) => ({ key: keys.issue(i.key), value: i })),
      ...demo.commitments.map((c) => ({
        key: keys.hist(c.id, at, 0),
        value: { commitmentId: c.id, at, field: 'seeded', from: null, to: c.title, by: 'tally-demo' } satisfies HistoryRow,
      })),
    ]);
    await this.saveSettings({ demoLoadedAt: at });
    await this.saveCandidates(
      demo.candidateSources.flatMap((src) =>
        extractCandidates(
          {
            sourceType: src.sourceUrl.includes('/wiki/') ? 'confluence' : 'jira',
            sourceUrl: src.sourceUrl,
            sourceTitle: src.sourceUrl.includes('/wiki/') ? decodeURIComponent(src.sourceUrl.split('/').pop() ?? 'Page') : src.sourceUrl.split('/').pop() ?? 'Issue',
            text: src.text,
            accountId: src.accountId,
          },
          demo.accounts,
          demo.commitments,
          now,
        ),
      ),
    );
    await this.evaluateAll(now);
    return ok({ accounts: demo.accounts.length, commitments: demo.commitments.length, evidence: demo.evidence.length });
  }

  /** Delete every record the app stores, settings included (Marketplace data-deletion path). */
  async deleteAll(): Promise<{ deleted: number }> {
    let deleted = 0;
    for (const prefix of ALL_PREFIXES) {
      const rows = await this.kv.list(prefix);
      if (rows.length) await this.kv.deleteMany(rows.map((r) => r.key));
      deleted += rows.length;
    }
    if (await this.kv.get(keys.settings)) {
      await this.kv.delete(keys.settings);
      deleted += 1;
    }
    return { deleted };
  }
}
