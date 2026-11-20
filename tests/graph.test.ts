// Teamwork Graph (T14): client parsing, error paths, and the per-commitment context
// (blueprint test plan: "Graph: success, empty and error paths").
import { describe, expect, it } from 'vitest';
import { GraphClient, RELATED_WORK_QUERY, USER_PAGES_QUERY, issueAri } from '../src/graph/client';
import type { GraphHttp } from '../src/graph/client';
import { JiraClient } from '../src/jira/client';
import { graphContext } from '../src/services/graph';
import { cmt, issue } from './helpers';

const CLOUD = 'cloud-1';
const resp = (status: number, body: unknown = {}) => ({ status, json: async () => body });
const wi = (key: string, extra: Record<string, unknown> = {}) => ({
  node: { __typename: 'JiraWorkItem', key, summary: `${key} summary`, webUrl: `https://x/browse/${key}`, status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, assignee: null, ...extra },
});
const page = (pageId: string, title: string) => ({ node: { __typename: 'ConfluencePage', pageId, title, webUrl: `https://x/wiki/${pageId}`, lastUpdatedAt: '2026-11-01T10:00:00Z' } });
const conn = (edges: unknown[]) => ({ edges });

function related(map: Partial<Record<string, unknown[]>>) {
  return { data: { parent: conn(map.parent ?? []), child: conn(map.child ?? []), blocks: conn(map.blocks ?? []), blocked_by: conn(map.blocked_by ?? []), linked: conn(map.linked ?? []) } };
}

describe('GraphClient', () => {
  it('uses operation names the gateway accepts (company_operation)', () => {
    expect(RELATED_WORK_QUERY).toMatch(/^query tally_relatedWork\(/);
    expect(USER_PAGES_QUERY).toMatch(/^query tally_ownerPages\(/);
    expect(issueAri(CLOUD, '10137')).toBe('ari:cloud:jira:cloud-1:issue/10137');
  });

  it('parses related work across kinds, with status and assignee', async () => {
    const http: GraphHttp = async (_q, v) => {
      expect(v).toEqual({ id: issueAri(CLOUD, '1') });
      return resp(200, related({
        parent: [wi('MC-42')],
        blocks: [wi('MC-9', { status: { name: 'Done', statusCategory: { key: 'done' } }, assignee: { accountId: 'u9', name: 'Nia' } })],
        linked: [null, { node: { __typename: 'ExternalThing' } }],
      }));
    };
    const r = await new GraphClient(http).relatedWork(issueAri(CLOUD, '1'));
    expect(r.ok && r.data).toEqual([
      expect.objectContaining({ kind: 'PARENT', key: 'MC-42', done: false, assigneeAccountId: null }),
      expect.objectContaining({ kind: 'BLOCKS', key: 'MC-9', done: true, statusName: 'Done', assigneeAccountId: 'u9', assigneeName: 'Nia' }),
    ]);
  });

  it('empty graph is ok with an empty list', async () => {
    let calls = 0;
    const r = await new GraphClient(async () => { calls++; return resp(200, related({})); }, 0).relatedWork('x');
    expect(r.ok && r.data).toEqual([]);
    expect(calls).toBe(2); // an all-empty answer is asked once more
  });

  it('an all-empty answer is retried once and the second answer is used', async () => {
    let calls = 0;
    const http: GraphHttp = async () => (++calls === 1 ? resp(200, related({})) : resp(200, related({ parent: [wi('TD-1')], blocked_by: [wi('TD-3')] })));
    const r = await new GraphClient(http, 0).relatedWork(issueAri(CLOUD, '66401'));
    expect(r.ok && r.data.map((x) => `${x.kind}:${x.key}`)).toEqual(['PARENT:TD-1', 'BLOCKED_BY:TD-3']);
    expect(calls).toBe(2);
  });

  it('a non-empty first answer is not asked again', async () => {
    let calls = 0;
    const r = await new GraphClient(async () => { calls++; return resp(200, related({ child: [wi('TD-2')] })); }, 0).relatedWork('x');
    expect(r.ok && r.data.length).toBe(1);
    expect(calls).toBe(1);
  });

  it('error paths: GraphQL errors with no data, HTTP failures, thrown calls', async () => {
    const gql = await new GraphClient(async () => resp(200, { data: null, errors: [{ message: 'FEATURE_UNAVAILABLE' }] })).relatedWork('x');
    expect(!gql.ok && gql.code).toBe('upstream');
    expect(!gql.ok && gql.message).toContain('FEATURE_UNAVAILABLE');
    const denied = await new GraphClient(async () => resp(403)).pagesBy('u1');
    expect(!denied.ok && denied.code).toBe('forbidden');
    const down = await new GraphClient(async () => resp(502)).pagesBy('u1');
    expect(!down.ok && down.code).toBe('upstream');
    const thrown = await new GraphClient(async () => { throw new Error('boom'); }).pagesBy('u1');
    expect(!thrown.ok && thrown.code).toBe('upstream');
  });

  it('pagesBy keeps only Confluence pages and passes the user ARI', async () => {
    const http: GraphHttp = async (_q, v) => {
      expect(v).toEqual({ userId: 'ari:cloud:identity::user/u1', since: 'P180D' });
      return resp(200, { data: { atlassianUserContent: conn([page('11', 'Acme plan'), wi('MC-1'), page('12', '')]) } });
    };
    const r = await new GraphClient(http).pagesBy('u1');
    expect(r.ok && r.data).toEqual([{ pageId: '11', title: 'Acme plan', url: 'https://x/wiki/11', lastUpdatedAt: '2026-11-01T10:00:00Z' }]);
  });
});

/** A graph that answers per issue ARI / user ARI from fixtures. */
function fakeGraph(byIssue: Record<string, unknown>, byUser: Record<string, unknown[]> = {}) {
  const calls: string[] = [];
  const http: GraphHttp = async (q, v) => {
    if (q === RELATED_WORK_QUERY) {
      calls.push(String(v.id));
      const body = byIssue[String(v.id)];
      return body === 'fail' ? resp(500) : resp(200, body ?? related({}));
    }
    const id = String(v.userId).split('/').pop()!;
    calls.push(String(v.userId));
    return resp(200, { data: { atlassianUserContent: conn(byUser[id] ?? []) } });
  };
  return { graph: new GraphClient(http, 0), calls };
}
const noJira = new JiraClient(async () => { throw new Error('Jira should not be called'); });

describe('graphContext', () => {
  it('no linked issue: asks the user to link one, no graph calls', async () => {
    const { graph, calls } = fakeGraph({});
    const r = await graphContext({ commitment: cmt({ issueKeys: [] }), snapshots: [], cloudId: CLOUD, graph, jira: noJira });
    expect(r.ok && r.data.status).toBe('no_issues');
    expect(calls).toEqual([]);
  });

  it('demo-only links are skipped with a clear reason', async () => {
    const { graph, calls } = fakeGraph({});
    const r = await graphContext({ commitment: cmt({ issueKeys: ['DEMO-21'] }), snapshots: [issue({ key: 'DEMO-21', source: 'demo' })], cloudId: CLOUD, graph, jira: noJira });
    expect(r.ok && r.data).toMatchObject({ status: 'demo_only', demoKeys: ['DEMO-21'] });
    expect(calls).toEqual([]);
  });

  it('success: related work (marks already-linked), owner pages, no suggestions when owned', async () => {
    const { graph } = fakeGraph(
      { [issueAri(CLOUD, '100')]: related({ parent: [wi('MC-42')], linked: [wi('MC-8'), wi('MC-7')] }) },
      { u1: [page('11', 'Acme plan')] },
    );
    const r = await graphContext({
      commitment: cmt({ ownerAccountId: 'u1', issueKeys: ['MC-7', 'MC-8'] }),
      snapshots: [issue({ key: 'MC-7', id: '100', source: 'jira' }), issue({ key: 'MC-8', id: '101', source: 'jira' })],
      cloudId: CLOUD, graph, jira: noJira,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe('ok');
    const mc7 = r.data.issues.find((i) => i.key === 'MC-7')!;
    expect(mc7.related.map((x) => [x.key, x.linked])).toEqual([['MC-42', false], ['MC-8', true]]); // MC-7 itself dropped
    expect(r.data.people[0]).toMatchObject({ accountId: 'u1', role: 'owner', pages: [{ pageId: '11' }] });
    expect(r.data.suggestedOwners).toEqual([]);
  });

  it('use case 2: suggests owners from assignees when the commitment has none', async () => {
    const { graph } = fakeGraph({ [issueAri(CLOUD, '100')]: related({ child: [wi('MC-9', { assignee: { accountId: 'u9', name: 'Nia' } })] }) });
    const r = await graphContext({
      commitment: cmt({ ownerAccountId: null, issueKeys: ['MC-7'] }),
      snapshots: [issue({ key: 'MC-7', id: '100', assigneeAccountId: 'u7', source: 'jira' })],
      cloudId: CLOUD, graph, jira: noJira,
    });
    expect(r.ok && r.data.suggestedOwners).toEqual([
      { accountId: 'u7', name: null, why: 'Assignee of MC-7' },
      { accountId: 'u9', name: 'Nia', why: 'Assignee of MC-9, related to MC-7' },
    ]);
    expect(r.ok && r.data.people.map((p) => p.role)).toEqual(['assignee']);
  });

  it('never asks the graph about made-up demo owners', async () => {
    const { graph, calls } = fakeGraph({});
    await graphContext({
      commitment: cmt({ ownerAccountId: 'demo-priya', issueKeys: ['MC-7'] }),
      snapshots: [issue({ key: 'MC-7', id: '100', assigneeAccountId: 'tally-system', source: 'jira' })],
      cloudId: CLOUD, graph, jira: noJira,
    });
    expect(calls.filter((x) => x.includes('identity'))).toEqual([]);
  });

  it('error: every graph call failing gives "unavailable" with the reason, never a crash', async () => {
    const { graph } = fakeGraph({ [issueAri(CLOUD, '100')]: 'fail' });
    const r = await graphContext({
      commitment: cmt({ ownerAccountId: null, issueKeys: ['MC-7'] }),
      snapshots: [issue({ key: 'MC-7', id: '100', source: 'jira' })],
      cloudId: CLOUD, graph, jira: noJira,
    });
    expect(r.ok && r.data.status).toBe('unavailable');
    expect(r.ok && r.data.reason).toMatch(/HTTP 500/);
  });

  it('reads the issue id from Jira when an older snapshot lacks it', async () => {
    const { graph, calls } = fakeGraph({});
    const jira = new JiraClient(async (path) => ({
      status: 200,
      headers: { get: () => null },
      text: async () => '',
      json: async () => (path === '/rest/api/3/field' ? [] : { issues: [{ id: '555', key: 'MC-7', fields: { summary: 's', status: { name: 'To Do', statusCategory: { key: 'new' } } } }], issueErrors: [] }),
    }));
    const r = await graphContext({ commitment: cmt({ issueKeys: ['MC-7'] }), snapshots: [issue({ key: 'MC-7', source: 'jira' })], cloudId: CLOUD, graph, jira });
    expect(r.ok && r.data.status).toBe('ok');
    expect(calls[0]).toBe(issueAri(CLOUD, '555'));
  });
});
