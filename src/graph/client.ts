// Teamwork Graph client (blueprint K, T14). Calls Atlassian's curated graph queries through
// requestTeamworkGraph, which always runs as the viewing user, so the graph's own permissions
// apply. Curated queries need no registration; raw Cypher is unavailable to new apps.
// Verified on the demo site (2026-11-15) against the live schema at /gateway/api/graphql/twg/schema:
//   jiraWorkItemHierarchy(id, kinds: [PARENT|CHILD|BLOCKS|BLOCKED_BY|LINKED], first)
//   atlassianUserContent(userId, roles: [CREATED|MENTIONED|WATCHES], since, first)
// Operation names must look like `company_operation` or the gateway rejects the call.
import { fail, ok } from '../core/types';
import type { Result } from '../core/types';

export interface GraphResponse {
  status: number;
  json(): Promise<unknown>;
}
export type GraphHttp = (query: string, variables: Record<string, unknown>) => Promise<GraphResponse>;

export const RELATION_KINDS = ['PARENT', 'CHILD', 'BLOCKS', 'BLOCKED_BY', 'LINKED'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export interface RelatedWork {
  kind: RelationKind;
  key: string;
  summary: string;
  url: string | null;
  statusName: string | null;
  done: boolean;
  assigneeAccountId: string | null;
  assigneeName: string | null;
}

export interface GraphPage {
  pageId: string;
  title: string;
  url: string | null;
  lastUpdatedAt: string | null;
}

/** The ARI the graph uses for a Jira issue (confirmed against live results). */
export const issueAri = (cloudId: string, issueId: string) => `ari:cloud:jira:${cloudId}:issue/${issueId}`;
export const userAri = (accountId: string) => `ari:cloud:identity::user/${accountId}`;

const PER_KIND = 10;

const WORK_ITEM = '... on JiraWorkItem { key summary webUrl status { name statusCategory { key } } assignee { ... on AtlassianUser { accountId name } } }';

export const RELATED_WORK_QUERY = `query tally_relatedWork($id: ID!) { ${RELATION_KINDS.map(
  (k) => `${k.toLowerCase()}: jiraWorkItemHierarchy(id: $id, kinds: [${k}], first: ${PER_KIND}) { edges { node { __typename ${WORK_ITEM} } } }`,
).join(' ')} }`;

export const USER_PAGES_QUERY =
  'query tally_ownerPages($userId: ID!, $since: String!) { atlassianUserContent(userId: $userId, roles: [CREATED], since: $since, first: 10) ' +
  '{ edges { node { __typename ... on ConfluencePage { pageId title webUrl lastUpdatedAt } } } } }';

type Edge = { node?: Record<string, unknown> | null } | null;
type Conn = { edges?: Edge[] | null } | null | undefined;
type GqlBody = { data?: Record<string, Conn> | null; errors?: Array<{ message?: string }> };

const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export class GraphClient {
  constructor(private readonly http: GraphHttp) {}

  /** POST one query; partial data with field errors still counts, a null data block does not. */
  private async run(name: string, query: string, variables: Record<string, unknown>): Promise<Result<Record<string, Conn>>> {
    let res: GraphResponse;
    try {
      res = await this.http(query, variables);
    } catch {
      return fail('upstream', `Teamwork Graph ${name} could not be reached.`);
    }
    if (res.status === 401 || res.status === 403) return fail('forbidden', 'Teamwork Graph refused access for this user.');
    if (res.status !== 200) return fail('upstream', `Teamwork Graph ${name} failed (HTTP ${res.status}).`);
    const body = (await res.json().catch(() => ({}))) as GqlBody;
    if (!body.data) {
      const msg = body.errors?.[0]?.message ?? 'no data returned';
      return fail('upstream', `Teamwork Graph ${name} failed: ${msg.slice(0, 160)}`);
    }
    return ok(body.data);
  }

  /** Settings > Connections: does the Teamwork Graph answer for this user? */
  async ping(): Promise<Result<true>> {
    let res: GraphResponse;
    try {
      res = await this.http('query tally_pingCheck { echo(myString: "ok") }', {});
    } catch {
      return fail('upstream', 'Teamwork Graph could not be reached.');
    }
    if (res.status !== 200) return fail(res.status === 401 || res.status === 403 ? 'forbidden' : 'upstream', `Teamwork Graph answered HTTP ${res.status}.`);
    const body = (await res.json().catch(() => ({}))) as { data?: { echo?: string } | null; errors?: Array<{ message?: string }> };
    return body.data?.echo === 'ok' ? ok(true) : fail('upstream', `Teamwork Graph: ${body.errors?.[0]?.message?.slice(0, 160) ?? 'no answer'}`);
  }

  /** Parent, child, blocking and linked work for one Jira issue, in one round trip. */
  async relatedWork(issueAriValue: string): Promise<Result<RelatedWork[]>> {
    const res = await this.run('related work', RELATED_WORK_QUERY, { id: issueAriValue });
    if (!res.ok) return res;    const out: RelatedWork[] = [];
    for (const kind of RELATION_KINDS) {
      for (const edge of res.data[kind.toLowerCase()]?.edges ?? []) {
        const n = edge?.node;
        if (!n || n.__typename !== 'JiraWorkItem' || !s(n.key)) continue;
        const status = (n.status ?? null) as { name?: unknown; statusCategory?: { key?: unknown } } | null;
        const assignee = (n.assignee ?? null) as { accountId?: unknown; name?: unknown } | null;
        out.push({
          kind,
          key: s(n.key)!,
          summary: s(n.summary) ?? '',
          url: s(n.webUrl),
          statusName: s(status?.name),
          done: status?.statusCategory?.key === 'done',
          assigneeAccountId: s(assignee?.accountId),
          assigneeName: s(assignee?.name),
        });
      }
    }
    return ok(out);
  }

  /** Confluence pages a person created recently (the "context from the owner" fallback). */
  async pagesBy(accountId: string, sinceDays = 180): Promise<Result<GraphPage[]>> {
    const res = await this.run('owner pages', USER_PAGES_QUERY, { userId: userAri(accountId), since: `P${sinceDays}D` });
    if (!res.ok) return res;
    const out: GraphPage[] = [];
    for (const edge of res.data.atlassianUserContent?.edges ?? []) {
      const n = edge?.node;
      if (!n || n.__typename !== 'ConfluencePage' || !s(n.pageId) || !s(n.title)) continue;
      out.push({ pageId: s(n.pageId)!, title: s(n.title)!, url: s(n.webUrl), lastUpdatedAt: s(n.lastUpdatedAt) });
    }
    return ok(out);
  }
}
