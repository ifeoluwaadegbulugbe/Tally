// Custom UI resolvers. Thin wrappers over src/core and src/storage; every resolver
// returns the H4 envelope { ok: true, data } | { ok: false, code, message }.
import Resolver from '@forge/resolver';
import { SEVERITY, accountRollups, buildDashboard, commitmentRows, describeRules, evaluateRisks, fail, groupRisks, healthOf, isOpen, ok } from '../core';
import type { CommitmentPatch, Result } from '../core';
import { ConfluenceClient, normaliseForMatch } from '../confluence/client';
import { forgeConfluenceHttp } from '../confluence/forge-http';
import { ISSUE_KEY, JiraClient, TALLY_DESCRIPTION_PREFIX } from '../jira/client';
import { forgeJiraHttp } from '../jira/forge-http';
import { GraphClient } from '../graph/client';
import { forgeGraphHttp } from '../graph/forge-http';
import { graphContext } from '../services/graph';
import { parseCursor, scanStep, startCursor } from '../services/scan';
import { syncIssues, visibleLink } from '../services/sync';
import { forgeKv } from '../storage/forge-kv';
import { Repo } from '../storage/repo';
import { logCall, logError } from './log';

const resolver = new Resolver();
const repo = new Repo(forgeKv);
const jira = new JiraClient(forgeJiraHttp);
const confluence = new ConfluenceClient(forgeConfluenceHttp);
const graph = new GraphClient(forgeGraphHttp);

/** Display names for account IDs; an empty map if Jira cannot be reached (UI falls back). */
async function userNames(ids: Array<string | null | undefined>): Promise<Record<string, string>> {
  const res = await jira.users(ids.filter((x): x is string => !!x));
  return res.ok ? res.data : {};
}

interface Ctx {
  accountId?: string;
  siteUrl?: string;
  cloudId?: string;
}

type Handler<T> = (
  payload: Record<string, unknown>,
  ctx: { actor: { accountId: string }; siteUrl?: string; cloudId?: string },
) => Promise<Result<T>> | Result<T>;

/** Wrap a resolver: require a user, turn thrown errors into an `internal` envelope. */
function define<T>(name: string, fn: Handler<T>) {
  resolver.define(name, async ({ payload, context }) => {
    const ctx = (context ?? {}) as Ctx;
    const started = Date.now();
    if (!ctx.accountId) {
      logCall(name, 'forbidden', 0);
      return fail('forbidden', 'Sign in to use Tally.');
    }
    try {
      const res = await fn((payload ?? {}) as Record<string, unknown>, { actor: { accountId: ctx.accountId }, siteUrl: ctx.siteUrl, cloudId: ctx.cloudId });
      logCall(name, res.ok ? 'ok' : res.code, Date.now() - started);
      return res;
    } catch (err) {
      logError(name, err);
      return fail('internal', `${name} failed. Try again.`);
    }
  });
}

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

// ---------- Settings and demo data ----------

define('getSettings', async () => {
  const [settings, empty, isAdmin] = await Promise.all([repo.getSettings(), repo.isEmpty(), jira.isAdmin()]);
  return ok({ ...settings, empty, isAdmin, storage: 'forge-kvs', described: describeRules(settings.rules) });
});

// Seed and delete-all are admin-only (H9): checked against Jira's global ADMINISTER permission.
define('seedDemoData', async (_p, { siteUrl }) => {
  if (!(await jira.isAdmin())) return fail('forbidden', 'Only Jira admins can load demo data.');
  return repo.seedDemo(new Date(), siteUrl);
});

define('resetDemoData', async () => {
  if (!(await jira.isAdmin())) return fail('forbidden', 'Only Jira admins can delete Tally data.');
  return ok(await repo.deleteAll());
});

// ---------- Settings (F10) ----------

const MCP_URL = 'https://mcp.atlassian.com/forge/f43c90aa-396f-4774-951c-4f62dc2cd3a9';

/** Live checks, each run as the viewing user; a failure shows its reason, never a blank. */
define('getConnections', async () => {
  const [j, c, g] = await Promise.all([jira.access(), confluence.searchPages(''), graph.ping()]);
  const row = (r: Result<unknown>) => (r.ok ? { ok: true as const, detail: null } : { ok: false as const, detail: r.message });
  return ok({
    jira: row(j),
    confluence: row(c),
    graph: row(g),
    isAdmin: j.ok && j.data.isAdmin,
    mcpUrl: MCP_URL,
  });
});

/** Rule thresholds, blocked status names and tier-to-priority mapping. Admins only. */
define('saveRuleSettings', async (p) => {
  if (!(await jira.isAdmin())) return fail('forbidden', 'Only Jira admins can change Tally rules.');
  const tiers = (p.tierPriority ?? {}) as Record<string, unknown>;
  const priorities = ['critical', 'high', 'normal'];
  for (const t of ['enterprise', 'growth', 'standard']) {
    if (!priorities.includes(String(tiers[t]))) return fail('validation', `tierPriority.${t}: expected critical, high or normal.`);
  }
  const res = await repo.saveSettings({
    rules: p.rules as never,
    tierPriority: { enterprise: tiers.enterprise, growth: tiers.growth, standard: tiers.standard } as never,
  });
  if (!res.ok) return res;
  return ok({ rules: res.data.rules, tierPriority: res.data.tierPriority, described: describeRules(res.data.rules) });
});

define('exportData', async () => {
  if (!(await jira.isAdmin())) return fail('forbidden', 'Only Jira admins can export Tally data.');
  return ok(await repo.exportAll(new Date()));
});

// ---------- Dashboard ----------

define<unknown>('getDashboard', async () => {
  if (await repo.isEmpty()) return ok({ empty: true as const, isAdmin: await jira.isAdmin() });
  const now = new Date();
  // The admin check is independent of the sync, so both Jira round trips run together.
  const [sync, isAdmin] = await Promise.all([syncIssues(repo, jira, now), jira.isAdmin()]);
  const [{ signals, commitments }, accounts] = await Promise.all([repo.evaluateAll(now), repo.listAccounts()]);
  const dashboard = buildDashboard(commitments, signals, now);
  return ok({
    empty: false as const,
    ...dashboard,
    accounts: Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    users: await userNames(dashboard.attention.map((r) => r.ownerAccountId)),
    jiraNotice: sync.error,
    isAdmin,
  });
});

// ---------- Accounts ----------

/** Evaluate risks once, then build rows; list views always show current health. */
async function currentRows(now: Date) {
  const sync = await syncIssues(repo, jira, now);
  const [{ signals, commitments }, accounts] = await Promise.all([repo.evaluateAll(now), repo.listAccounts()]);
  return { accounts, signals, rows: commitmentRows(commitments, accounts, signals, now), jiraNotice: sync.error };
}

define('listAccounts', async () => {
  const now = new Date();
  const { accounts, signals, rows } = await currentRows(now);
  return ok(accountRollups(accounts, rows, signals, now));
});

define('saveAccount', (p) => repo.saveAccount(p.account));

// ---------- Commitments ----------

define('listCommitments', async (p) => {
  const { rows, accounts, jiraNotice } = await currentRows(new Date());
  const accountId = str(p.accountId);
  const status = str(p.status);
  return ok({
    rows: rows
      .filter((r) => (accountId ? r.accountId === accountId : true))
      .filter((r) => (status ? r.status === status : true))
      .filter((r) => (p.ownerAccountId === null ? !r.ownerAccountId : str(p.ownerAccountId) ? r.ownerAccountId === p.ownerAccountId : true)),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    users: await userNames(rows.map((r) => r.ownerAccountId)),
    jiraNotice,
  });
});

define('getCommitment', async (p) => {
  const id = str(p.id);
  if (!id) return fail('validation', 'id is required.');
  if (!(await repo.getCommitment(id))) return fail('not_found', `Commitment ${id} not found.`);
  const now = new Date();
  const sync = await syncIssues(repo, jira, now);
  const commitment = (await repo.getCommitment(id))!; // re-read: the sync may have moved its status
  const [evidence, history, issues, account, settings] = await Promise.all([
    repo.listEvidence(id),
    repo.listHistory(id),
    repo.listIssueSnapshots(),
    repo.getAccount(commitment.accountId),
    repo.getSettings(),
  ]);
  const fresh = evaluateRisks(commitment, { issues, evidenceCount: evidence.length }, now, settings.rules);
  const signals = await repo.replaceSignals(id, fresh);
  const links = commitment.issueKeys.map((k) => visibleLink(k, issues, sync.unavailable));
  return ok({
    commitment,
    account: account ?? null,
    health: isOpen(commitment.status) ? healthOf(signals, now) : null,
    evidence,
    history: history.reverse(),
    signals,
    links,
    rules: describeRules(settings.rules),
    users: await userNames([commitment.ownerAccountId, ...history.map((h) => h.by), ...links.map((l) => l.issue?.assigneeAccountId)]),
    jiraNotice: sync.error,
  });
});

define('createCommitment', (p, { actor }) => repo.createCommitment(p.commitment, actor, new Date()));

define('updateCommitment', (p, { actor }) => {
  const id = str(p.id);
  if (!id || typeof p.expectedVersion !== 'number') return fail('validation', 'id and expectedVersion are required.');
  return repo.updateCommitment(id, (p.patch ?? {}) as CommitmentPatch, p.expectedVersion, actor, new Date(), str(p.reason));
});

define('transitionCommitment', (p, { actor }) => {
  const id = str(p.id);
  const action = p.action === 'cancel' || p.action === 'renegotiate' ? p.action : undefined;
  if (!id || !action || typeof p.expectedVersion !== 'number') return fail('validation', 'id, action and expectedVersion are required.');
  return repo.transitionCommitment(
    id,
    { action, reason: str(p.reason), newDueDate: str(p.newDueDate), customerInformed: p.customerInformed === true },
    p.expectedVersion,
    actor,
    new Date(),
  );
});

define('addEvidence', (p, { actor }) => {
  const id = str(p.commitmentId);
  if (!id) return fail('validation', 'commitmentId is required.');
  const e = (p.evidence ?? {}) as { sourceUrl?: unknown; quote?: unknown };
  return repo.addEvidence(id, { sourceType: 'manual', sourceUrl: String(e.sourceUrl ?? ''), quote: String(e.quote ?? '') }, actor, new Date());
});

/** The viewing user's Atlassian accountId, for "Assign to me". */
define('whoAmI', (_p, { actor }) => ok(actor));

// ---------- Jira (T08) ----------

define('searchIssues', async (p) => jira.searchIssues(str(p.text) ?? '', str(p.projectKey)));

define('searchUsers', async (p) => {
  const q = str(p.query);
  if (!q || q.trim().length < 2) return ok([]);
  return jira.searchUsers(q);
});

define('getIssueTypes', async (p) => {
  const key = str(p.projectKey);
  if (!key) return fail('validation', 'projectKey is required.');
  return jira.issueTypes(key.toUpperCase());
});

/** Link an issue the viewer can read (F-23); reads it first so the status shows at once. */
async function link(id: string, issueKey: string, expectedVersion: number, actor: { accountId: string }) {
  const key = issueKey.toUpperCase();
  if (!ISSUE_KEY.test(key)) return fail('validation', 'issueKey: expected a key like ABC-123.');
  const c = await repo.getCommitment(id);
  if (!c) return fail('not_found', `Commitment ${id} not found.`);
  if (c.issueKeys.includes(key)) return fail('conflict', `${key} is already linked.`);
  const read = await jira.readIssues([key]);
  if (!read.ok) return read;
  if (read.data.unavailable.includes(key)) return fail('not_found', `${key} does not exist or you cannot see it.`);
  await repo.saveIssueSnapshots(read.data.snapshots);
  const res = await repo.updateCommitment(id, { issueKeys: [...c.issueKeys, key] }, expectedVersion, actor, new Date());
  if (res.ok) await repo.applySystemStatuses(new Date());
  return res;
}

define('linkIssue', (p, { actor }) => {
  const id = str(p.id);
  const key = str(p.issueKey);
  if (!id || !key || typeof p.expectedVersion !== 'number') return fail('validation', 'id, issueKey and expectedVersion are required.');
  return link(id, key, p.expectedVersion, actor);
});

define('unlinkIssue', async (p, { actor }) => {
  const id = str(p.id);
  const key = str(p.issueKey);
  if (!id || !key || typeof p.expectedVersion !== 'number') return fail('validation', 'id, issueKey and expectedVersion are required.');
  const c = await repo.getCommitment(id);
  if (!c) return fail('not_found', `Commitment ${id} not found.`);
  return repo.updateCommitment(id, { issueKeys: c.issueKeys.filter((k) => k !== key) }, p.expectedVersion, actor, new Date());
});

/** Create a delivery issue the user confirmed in the dialog (F-24), then link it. */
define('createDeliveryIssue', async (p, { actor }) => {
  const id = str(p.id);
  const projectKey = str(p.projectKey)?.toUpperCase();
  const issueTypeId = str(p.issueTypeId);
  const summary = str(p.summary)?.trim();
  if (!id || !projectKey || !issueTypeId || !summary || typeof p.expectedVersion !== 'number') {
    return fail('validation', 'id, projectKey, issueTypeId, summary and expectedVersion are required.');
  }
  const c = await repo.getCommitment(id);
  if (!c) return fail('not_found', `Commitment ${id} not found.`);
  if (c.version !== p.expectedVersion) return fail('conflict', 'Changed by someone else. Reload to see the latest.');
  const account = await repo.getAccount(c.accountId);
  const created = await jira.createIssue({
    projectKey,
    issueTypeId,
    summary,
    dueDate: c.dueDate,
    description: `${TALLY_DESCRIPTION_PREFIX}${account ? ` for ${account.name}` : ''}: "${c.title}" (${c.id}).`,
  });
  if (!created.ok) return created;
  return link(id, created.data.key, c.version, actor);
});

// ---------- Confluence (T09) ----------

define('searchPages', async (p) => confluence.searchPages(str(p.text) ?? '', str(p.spaceKey)));

/** Page text as sentences for the quote picker; hints use the commitment's account name. */
define('getPageText', async (p) => {
  const pageId = str(p.pageId);
  if (!pageId) return fail('validation', 'pageId is required.');
  const accounts = await repo.listAccounts();
  return confluence.pageText(pageId, accounts.map((a) => a.name));
});

/**
 * Save a quote from a Confluence page as evidence (F-12). The page is re-read as the user and
 * the quote must appear in it, so evidence cannot be invented; the link is built from
 * Confluence's own response, never from the client.
 */
define('addConfluenceEvidence', async (p, { actor }) => {
  const id = str(p.commitmentId);
  const pageId = str(p.pageId);
  const quote = str(p.quote)?.trim();
  if (!id || !pageId || !quote) return fail('validation', 'commitmentId, pageId and quote are required.');
  if (quote.length > 300) return fail('validation', 'quote: at most 300 characters.');
  const page = await confluence.pageText(pageId);
  if (!page.ok) return page;
  const pageText = normaliseForMatch(page.data.sentences.map((x) => x.text).join(' '));
  if (!pageText.includes(normaliseForMatch(quote))) {
    return fail('validation', 'That quote is not on the page. Pick a sentence or shorten it, without rewording.');
  }
  return repo.addEvidence(id, { sourceType: 'confluence', sourceUrl: page.data.url, quote }, actor, new Date());
});

// ---------- Teamwork Graph (T14) ----------

/** Related work, the owner's recent pages and owner suggestions for one commitment. */
define('getGraphContext', async (p, { cloudId }) => {
  const id = str(p.commitmentId);
  if (!id) return fail('validation', 'commitmentId is required.');
  if (!cloudId) return fail('internal', 'Site ID unavailable in this context.');
  const commitment = await repo.getCommitment(id);
  if (!commitment) return fail('not_found', `Commitment ${id} not found.`);
  const res = await graphContext({ commitment, snapshots: await repo.listIssueSnapshots(), cloudId, graph, jira });
  if (!res.ok) return res;
  const ids = [...res.data.people.map((x) => x.accountId), ...res.data.suggestedOwners.map((x) => x.accountId)];
  return ok({ ...res.data, users: await userNames(ids) });
});

// ---------- Customer updates (T15: F-40, F-41) ----------

define('listUpdates', async (p) => {
  const [drafts, accounts] = await Promise.all([repo.listDrafts(str(p.accountId)), repo.listAccounts()]);
  return ok({
    drafts: drafts.map(({ body, ...d }) => ({ ...d, preview: body.split('\n').find((l) => l.startsWith('- '))?.slice(2, 120) ?? '' })),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    users: await userNames(drafts.flatMap((d) => [d.createdBy, d.approvedBy, d.sentBy])),
  });
});

/** One update with the facts it used, shown side by side (blueprint H5: draft next to facts). */
define('getUpdate', async (p) => {
  const id = str(p.id);
  if (!id) return fail('validation', 'id is required.');
  const draft = await repo.getDraft(id);
  if (!draft) return fail('not_found', `Update ${id} not found.`);
  const now = new Date();
  const [{ signals, commitments }, accounts] = await Promise.all([repo.evaluateAll(now), repo.listAccounts()]);
  const facts = commitmentRows(commitments.filter((c) => draft.commitmentIds.includes(c.id)), accounts, signals, now);
  const stale = draft.status === 'draft' ? await repo.staleCommitments(draft) : [];
  return ok({
    draft,
    account: accounts.find((a) => a.id === draft.accountId) ?? null,
    facts: draft.commitmentIds.map((cid) => facts.find((f) => f.id === cid) ?? { id: cid, missing: true as const }),
    stale,
    users: await userNames([draft.createdBy, draft.editedBy, draft.approvedBy, draft.sentBy, ...facts.map((f) => f.ownerAccountId)]),
  });
});

define('createUpdate', (p, { actor }) => {
  const accountId = str(p.accountId);
  if (!accountId) return fail('validation', 'accountId is required.');
  const ids = Array.isArray(p.commitmentIds) ? p.commitmentIds.map(String).filter(Boolean) : undefined;
  return repo.createDraft(accountId, ids, actor, new Date());
});

function draftCall(p: Record<string, unknown>): { id: string; expectedVersion: number } | null {
  const id = str(p.id);
  return id && typeof p.expectedVersion === 'number' ? { id, expectedVersion: p.expectedVersion } : null;
}

define('editUpdate', (p, { actor }) => {
  const c = draftCall(p);
  if (!c || typeof p.body !== 'string') return fail('validation', 'id, expectedVersion and body are required.');
  return repo.editDraft(c.id, p.body, c.expectedVersion, actor, new Date());
});

define('approveUpdate', (p, { actor }) => {
  const c = draftCall(p);
  if (!c) return fail('validation', 'id and expectedVersion are required.');
  return repo.approveDraft(c.id, c.expectedVersion, actor, new Date());
});

define('markUpdateSent', (p, { actor }) => {
  const c = draftCall(p);
  if (!c) return fail('validation', 'id and expectedVersion are required.');
  return repo.markDraftSent(c.id, c.expectedVersion, actor, new Date());
});

define('discardUpdate', (p) => {
  const c = draftCall(p);
  if (!c) return fail('validation', 'id and expectedVersion are required.');
  return repo.discardDraft(c.id, c.expectedVersion);
});

// ---------- Risks (T11) ----------

/** Risk signals grouped by rule (F7), the plain-language rules with current thresholds. */
define('listRisks', async () => {
  const now = new Date();
  const { rows, signals, jiraNotice } = await currentRows(now);
  const settings = await repo.getSettings();
  const grouped = groupRisks(rows, signals, now);
  const ids = [...grouped.groups.flatMap((g) => g.items), ...grouped.acknowledged].flatMap((i) => [i.ownerAccountId, i.acknowledgedBy]);
  return ok({ ...grouped, rules: describeRules(settings.rules), severity: SEVERITY, users: await userNames(ids), jiraNotice });
});

define('acknowledgeSignal', (p, { actor }) => {
  const signalId = str(p.signalId);
  if (!signalId) return fail('validation', 'signalId is required.');
  const until = p.until === null ? null : str(p.until);
  if (until === undefined) return fail('validation', 'until is required (a date, or null to clear).');
  return repo.acknowledgeSignal(signalId, until, str(p.reason), actor, new Date());
});

// ---------- Discovery inbox (T10) ----------

define('listCandidates', async (p) => {
  const state = str(p.state) as 'unreviewed' | 'confirmed' | 'rejected' | 'ambiguous' | undefined;
  const [candidates, accounts, settings] = await Promise.all([repo.listCandidates(state), repo.listAccounts(), repo.getSettings()]);
  return ok({
    candidates,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, jiraProjectKey: a.jiraProjectKey ?? null, confluenceSpaceKey: a.confluenceSpaceKey ?? null })),
    lastScanAt: settings.lastScanAt ?? null,
  });
});

define('inboxCount', async () => ok({ unreviewed: (await repo.listCandidates('unreviewed')).length }));

define('reviewCandidate', async (p, { actor }) => {
  const id = str(p.id);
  const decision = p.decision === 'confirm' || p.decision === 'reject' || p.decision === 'ambiguous' ? p.decision : undefined;
  if (!id || !decision) return fail('validation', 'id and decision are required.');
  const e = (p.edits ?? {}) as Record<string, unknown>;
  const dueDate = e.dueDate === null ? null : str(e.dueDate);
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return fail('validation', 'dueDate: expected YYYY-MM-DD.');
  return repo.reviewCandidate(
    id,
    decision,
    {
      accountId: str(e.accountId),
      title: str(e.title),
      dueDate: e.dueDate === undefined ? undefined : dueDate ?? null,
      ownerAccountId: str(e.ownerAccountId) ?? null,
      reason: str(p.reason),
    },
    actor,
    new Date(),
  );
});

/** Start or continue a scan; each call does one page and returns the next cursor (H8). */
define('scanSources', async (p, { siteUrl }) => {
  if (!siteUrl) return fail('internal', 'Site URL unavailable in this context.');
  const cursor = p.cursor === undefined
    ? startCursor(Array.isArray(p.projectKeys) ? p.projectKeys.map(String) : [], Array.isArray(p.spaceKeys) ? p.spaceKeys.map(String) : [])
    : parseCursor(p.cursor);
  if (!cursor) return fail('validation', 'Invalid scan cursor.');
  if (cursor.queue.length === 0) return fail('validation', 'Choose at least one Jira project or Confluence space.');
  const step = await scanStep(repo, jira, confluence, cursor, siteUrl.replace(/\/$/, ''), new Date());
  if (step.ok && step.data.cursor === null) await repo.saveSettings({ lastScanAt: new Date().toISOString() });
  return step;
});

export const handler = resolver.getDefinitions();
