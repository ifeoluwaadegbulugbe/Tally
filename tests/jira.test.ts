import { beforeEach, describe, expect, it } from 'vitest';
import { JiraClient, toSnapshot } from '../src/jira/client';
import type { HttpResponse, JiraHttp } from '../src/jira/client';
import { syncIssues, visibleLink } from '../src/services/sync';
import { MemoryKv } from '../src/storage/kv';
import { Repo } from '../src/storage/repo';
import { NOW } from './helpers';

function res(status: number, body: unknown = {}, headers: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: { get: (n) => headers[n] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const FIELDS = [{ id: 'customfield_10021', name: 'Flagged' }, { id: 'summary', name: 'Summary' }];
const issue = (key: string, cat: string, o: Record<string, unknown> = {}) => ({
  key,
  fields: {
    summary: `Issue ${key}`,
    status: { name: cat === 'done' ? 'Done' : cat === 'new' ? 'To Do' : 'In Progress', statusCategory: { key: cat } },
    assignee: { accountId: 'u-assignee' },
    duedate: '2026-12-01',
    updated: '2026-11-09T10:00:00.000+0000',
    ...o,
  },
});

/** Fake Jira with a fixed set of issues the "viewer" can see. */
function fakeJira(visible: Record<string, ReturnType<typeof issue>>, calls: string[] = []): JiraHttp {
  return async (path, init) => {
    calls.push(`${init?.method ?? 'GET'} ${path.split('?')[0]}`);
    if (path === '/rest/api/3/field') return res(200, FIELDS);
    if (path === '/rest/api/3/issue/bulkfetch') {
      const { issueIdsOrKeys } = JSON.parse(init!.body!) as { issueIdsOrKeys: string[] };
      return res(200, { issues: issueIdsOrKeys.filter((k) => visible[k]).map((k) => visible[k]), issueErrors: [] });
    }
    if (path.startsWith('/rest/api/3/mypermissions')) return res(200, { permissions: { ADMINISTER: { havePermission: true } } });
    return res(404);
  };
}

describe('toSnapshot', () => {
  it('maps status category, flagged field and dates', () => {
    const s = toSnapshot(issue('AB-1', 'indeterminate', { customfield_10021: [{ value: 'Impediment' }] }), 'customfield_10021');
    expect(s).toMatchObject({ key: 'AB-1', statusCategory: 'in_progress', flagged: true, dueDate: '2026-12-01', source: 'jira' });
    expect(s.updated).toBe('2026-11-09T10:00:00.000Z');
    expect(toSnapshot(issue('AB-2', 'new', { customfield_10021: null }), 'customfield_10021').flagged).toBe(false);
  });
});

describe('JiraClient', () => {
  it('reads issues in bulk and reports missing or forbidden keys as unavailable', async () => {
    const jira = new JiraClient(fakeJira({ 'AB-1': issue('AB-1', 'done') }));
    const r = await jira.readIssues(['AB-1', 'AB-404', 'not a key']);
    expect(r.ok && r.data.snapshots.map((s) => s.key)).toEqual(['AB-1']);
    expect(r.ok && r.data.unavailable).toEqual(['AB-404']);
  });
  it('O16: a 403 becomes a forbidden error, not a crash', async () => {
    const jira = new JiraClient(async (path) => (path === '/rest/api/3/field' ? res(200, FIELDS) : res(403)));
    const r = await jira.readIssues(['AB-1']);
    expect(!r.ok && r.code).toBe('forbidden');
  });
  it('retries once on 429', async () => {
    let n = 0;
    const jira = new JiraClient(async (path) => {
      if (path === '/rest/api/3/field') return res(200, FIELDS);
      n++;
      return n === 1 ? res(429, {}, { 'Retry-After': '0' }) : res(200, { issues: [], issueErrors: [] });
    });
    expect((await jira.readIssues(['AB-1'])).ok).toBe(true);
    expect(n).toBe(2);
  });
  it('passes Jira error messages through as validation errors', async () => {
    const jira = new JiraClient(async (path) =>
      path === '/rest/api/3/field' ? res(200, FIELDS) : res(400, { errorMessages: ['Field duedate cannot be set.'] }),
    );
    const r = await jira.createIssue({ projectKey: 'A', issueTypeId: '1', summary: 's', dueDate: '2026-12-01', description: 'd' });
    expect(!r.ok && r.code).toBe('validation');
    expect(!r.ok && r.message).toContain('Field duedate cannot be set.');
  });
  it('builds bounded JQL for key, text and empty searches', async () => {
    const seen: string[] = [];
    const jira = new JiraClient(async (path) => {
      if (path === '/rest/api/3/field') return res(200, FIELDS);
      seen.push(new URLSearchParams(path.split('?')[1]).get('jql')!);
      return res(200, { issues: [] });
    });
    await jira.searchIssues('acme-42');
    await jira.searchIssues('sso "rollout"', 'ACME');
    await jira.searchIssues('');
    expect(seen).toEqual([
      'key = "ACME-42" ORDER BY updated DESC',
      'project = "ACME" AND text ~ "sso  rollout *" ORDER BY updated DESC',
      'updated >= -30d ORDER BY updated DESC',
    ]);
  });
  it('ignores null entries Jira returns for unknown accounts', async () => {
    const jira = new JiraClient(async () => res(200, { values: [null, { accountId: 'u1', displayName: 'Dana' }] }));
    const r = await jira.users(['u1', 'u-gone']);
    expect(r.ok && r.data).toEqual({ u1: 'Dana' });
  });
  it('skips demo ids when resolving user names', async () => {
    const calls: string[] = [];
    const jira = new JiraClient(fakeJira({}, calls));
    const r = await jira.users(['demo-dana', 'tally-demo', 'tally-system']);
    expect(r.ok && r.data).toEqual({});
    expect(calls).toEqual([]);
  });
});

describe('syncIssues', () => {
  let repo: Repo;
  beforeEach(async () => {
    repo = new Repo(new MemoryKv());
    await repo.seedDemo(NOW);
  });

  it('keeps demo snapshots for issues that do not exist on the site', async () => {
    const r = await syncIssues(repo, new JiraClient(fakeJira({})), NOW);
    expect(r.error).toBeNull();
    expect(r.unavailable).toContain('DEMO-21');
    const cache = await repo.listIssueSnapshots();
    expect(cache.find((i) => i.key === 'DEMO-21')?.source).toBe('demo');
    expect(visibleLink('DEMO-21', cache, r.unavailable).state).toBe('demo');
  });

  it('live status moves the lifecycle: all linked issues Done -> delivered', async () => {
    const r = await syncIssues(repo, new JiraClient(fakeJira({ 'DEMO-21': issue('DEMO-21', 'done') })), NOW);
    expect(r.moved).toContain('c-nw-ehr');
    expect((await repo.getCommitment('c-nw-ehr'))?.status).toBe('delivered');
    const hist = await repo.listHistory('c-nw-ehr');
    expect(hist.some((h) => h.field === 'status' && h.to === 'delivered' && h.by === 'tally-system')).toBe(true);
  });

  it('O18: an issue deleted after linking shows as unavailable, not cached content', async () => {
    const live = await syncIssues(repo, new JiraClient(fakeJira({ 'DEMO-21': issue('DEMO-21', 'indeterminate') })), NOW);
    expect(live.unavailable).not.toContain('DEMO-21');
    const after = await syncIssues(repo, new JiraClient(fakeJira({})), NOW);
    const cache = await repo.listIssueSnapshots();
    expect(visibleLink('DEMO-21', cache, after.unavailable)).toMatchObject({ state: 'unavailable', issue: null });
  });

  it('a Jira outage returns a notice and leaves data untouched', async () => {
    const r = await syncIssues(repo, new JiraClient(async (p) => (p === '/rest/api/3/field' ? res(200, FIELDS) : res(503))), NOW);
    expect(r.error).toMatch(/Jira bulk read failed \(503\)/);
    expect((await repo.getCommitment('c-nw-ehr'))?.status).toBe('in_delivery');
  });
});

describe('Forge route adapter', () => {
  it('turns client paths into Forge routes, keeping the encoded query', async () => {
    const { toRoute } = await import('../src/jira/forge-http');
    const params = new URLSearchParams({ jql: 'key = "AB-1" ORDER BY updated DESC', maxResults: '20' });
    expect(toRoute(`/rest/api/3/search/jql?${params}`).value).toBe(`/rest/api/3/search/jql?${params}`);
    expect(toRoute('/rest/api/3/issue/bulkfetch').value).toBe('/rest/api/3/issue/bulkfetch');
    expect(toRoute('/rest/api/3/issue/createmeta/AB/issuetypes').value).toBe('/rest/api/3/issue/createmeta/AB/issuetypes');
  });
  it('rejects paths outside the Jira REST API and normalises traversal', async () => {
    const { toRoute } = await import('../src/jira/forge-http');
    expect(() => toRoute('/wiki/rest/api/content')).toThrow();
    expect(() => toRoute('/rest/api/3/../../admin')).toThrow();
    expect(() => toRoute('//evil.example/rest/api/3/x')).toThrow();
  });
});
