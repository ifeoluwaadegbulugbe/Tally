// Graph context for one commitment (blueprint K, use cases 1 and 2). For each linked Jira issue
// it asks the Teamwork Graph for parent, child, blocking and linked work; it lists Confluence
// pages recently created by the people doing the work ("context from the owner", the documented
// fallback, because the graph has no issue-to-page relationship); and, when the commitment has
// no owner, it suggests people from the delivery work. Suggestions only: a person decides.
import { ok } from '../core/types';
import type { Commitment, IssueSnapshot, Result } from '../core/types';
import { issueAri } from '../graph/client';
import type { GraphClient, GraphPage, RelatedWork } from '../graph/client';
import type { JiraClient } from '../jira/client';

export const GRAPH_LIMITS = { issues: 3, people: 2, pagesPerPerson: 5, suggestions: 5 };

export interface IssueContext {
  key: string;
  related: Array<RelatedWork & { linked: boolean }>;
  error: string | null;
}
export interface PersonPages {
  accountId: string;
  role: 'owner' | 'assignee';
  pages: GraphPage[];
  error: string | null;
}
export interface GraphContext {
  /** ok: at least one graph call answered. unavailable: every call failed (reason says why). */
  status: 'ok' | 'unavailable' | 'no_issues' | 'demo_only';
  reason: string | null;
  issues: IssueContext[];
  people: PersonPages[];
  suggestedOwners: Array<{ accountId: string; name: string | null; why: string }>;
  /** Linked issues skipped because they are demo snapshots, not real Jira issues. */
  demoKeys: string[];
}

export async function graphContext(args: {
  commitment: Commitment;
  snapshots: IssueSnapshot[];
  cloudId: string;
  graph: GraphClient;
  jira: JiraClient;
}): Promise<Result<GraphContext>> {
  const { commitment: c, snapshots, cloudId, graph, jira } = args;
  const byKey = new Map(snapshots.map((s) => [s.key, s]));
  const empty = { issues: [], people: [], suggestedOwners: [], demoKeys: [] as string[] };
  if (c.issueKeys.length === 0) {
    return ok({ status: 'no_issues', reason: 'Link a Jira issue to see related work from the Teamwork Graph.', ...empty });
  }
  const demoKeys = c.issueKeys.filter((k) => byKey.get(k)?.source === 'demo');
  const liveKeys = c.issueKeys.filter((k) => byKey.get(k)?.source !== 'demo').slice(0, GRAPH_LIMITS.issues);
  if (liveKeys.length === 0) {
    return ok({ status: 'demo_only', reason: 'Demo issues are not in the Teamwork Graph. Link a real Jira issue to see graph context.', ...empty, demoKeys });
  }

  // Older cached snapshots carry no numeric id; read those issues again (as the user).
  const ids = new Map<string, string>();
  const live = liveKeys.map((k) => byKey.get(k)).filter((s): s is IssueSnapshot => !!s);
  for (const s of live) if (s.id) ids.set(s.key, s.id);
  const missing = liveKeys.filter((k) => !ids.has(k));
  const fresh: IssueSnapshot[] = [];
  if (missing.length > 0) {
    const read = await jira.readIssues(missing);
    if (read.ok) for (const s of read.data.snapshots) { fresh.push(s); if (s.id) ids.set(s.key, s.id); }
  }

  const linked = new Set(c.issueKeys);
  const issueResults = await Promise.all(
    liveKeys.map(async (key): Promise<IssueContext> => {
      const id = ids.get(key);
      if (!id) return { key, related: [], error: 'You cannot see this issue, or it was deleted.' };
      const res = await graph.relatedWork(issueAri(cloudId, id));
      if (!res.ok) return { key, related: [], error: res.message };
      const seen = new Set<string>();
      const related = res.data.filter((r) => r.key !== key && !seen.has(`${r.kind}:${r.key}`) && seen.add(`${r.kind}:${r.key}`));
      return { key, related: related.map((r) => ({ ...r, linked: linked.has(r.key) })), error: null };
    }),
  );

  // People: the commitment owner, then assignees of the linked issues.
  const assignees = [...live, ...fresh].map((s) => s.assigneeAccountId).filter((x): x is string => !!x);
  // Demo data uses made-up account ids (demo-*, tally-*); the graph cannot know them.
  const real = (id: string) => !/^(demo|tally)-/.test(id);
  const people: Array<{ accountId: string; role: 'owner' | 'assignee' }> = [];
  if (c.ownerAccountId && real(c.ownerAccountId)) people.push({ accountId: c.ownerAccountId, role: 'owner' });
  for (const a of assignees.filter(real)) if (!people.some((p) => p.accountId === a)) people.push({ accountId: a, role: 'assignee' });
  const peopleResults = await Promise.all(
    people.slice(0, GRAPH_LIMITS.people).map(async (p): Promise<PersonPages> => {
      const res = await graph.pagesBy(p.accountId);
      return res.ok
        ? { ...p, pages: res.data.slice(0, GRAPH_LIMITS.pagesPerPerson), error: null }
        : { ...p, pages: [], error: res.message };
    }),
  );

  // Use case 2: suggest owners from the delivery work, only when nobody owns the promise.
  const suggestedOwners: GraphContext['suggestedOwners'] = [];
  if (!c.ownerAccountId) {
    const add = (accountId: string, name: string | null, why: string) => {
      if (suggestedOwners.length < GRAPH_LIMITS.suggestions && !suggestedOwners.some((x) => x.accountId === accountId)) {
        suggestedOwners.push({ accountId, name, why });
      }
    };
    for (const s of [...live, ...fresh]) if (s.assigneeAccountId) add(s.assigneeAccountId, null, `Assignee of ${s.key}`);
    for (const i of issueResults) {
      for (const r of i.related) if (r.assigneeAccountId) add(r.assigneeAccountId, r.assigneeName, `Assignee of ${r.key}, related to ${i.key}`);
    }
  }

  const calls = [...issueResults.map((i) => i.error), ...peopleResults.map((p) => p.error)];
  const anyOk = calls.some((e) => e === null);
  return ok({
    status: anyOk ? 'ok' : 'unavailable',
    reason: anyOk ? null : calls.find((e) => e) ?? 'Teamwork Graph did not answer.',
    issues: issueResults,
    people: peopleResults,
    suggestedOwners,
    demoKeys,
  });
}
