// Jira REST client (blueprint H7). Every call runs as the viewing user, so Jira's own
// permissions apply. The HTTP function is injected: production passes the Forge adapter
// (forge-http.ts), tests pass a fake. Failures map to the H4 error codes with the call named.
import { fail, ok } from '../core/types';
import type { IssueSnapshot, Result } from '../core/types';

export interface HttpResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export type JiraHttp = (path: string, init?: { method?: string; body?: string }) => Promise<HttpResponse>;

export const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
/** Start of the description Tally writes on issues it creates; the scan ignores such text. */
export const TALLY_DESCRIPTION_PREFIX = 'Delivers a customer commitment tracked in Tally';
const BASE_FIELDS = ['summary', 'status', 'assignee', 'duedate', 'updated'];

export interface JiraUser {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
}

export interface IssueRead {
  /** Issues the user can read, as snapshots ready for the risk engine. */
  snapshots: IssueSnapshot[];
  /** Keys Jira refused or could not find for this user (deleted or no permission). */
  unavailable: string[];
}

type JiraIssue = {
  id?: string;
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: { accountId?: string } | null;
    duedate?: string | null;
    updated?: string;
    [custom: string]: unknown;
  };
};

const CATEGORY: Record<string, IssueSnapshot['statusCategory']> = {
  new: 'todo',
  indeterminate: 'in_progress',
  done: 'done',
};

export function toSnapshot(issue: JiraIssue, flaggedField: string | null): IssueSnapshot {
  const f = issue.fields;
  const flaggedValue = flaggedField ? f[flaggedField] : null;
  return {
    key: issue.key,
    ...(issue.id ? { id: String(issue.id) } : {}),
    summary: f.summary ?? '',
    statusName: f.status?.name ?? 'Unknown',
    statusCategory: CATEGORY[f.status?.statusCategory?.key ?? ''] ?? 'todo',
    // Jira Software's "Flagged" field holds [{ value: 'Impediment' }] when set.
    flagged: Array.isArray(flaggedValue) ? flaggedValue.length > 0 : !!flaggedValue,
    dueDate: f.duedate ?? null,
    updated: f.updated ? new Date(f.updated).toISOString() : new Date(0).toISOString(),
    assigneeAccountId: f.assignee?.accountId ?? null,
    accessible: true,
    source: 'jira',
  };
}

export class JiraClient {
  private flaggedField: string | null | undefined;

  constructor(private readonly http: JiraHttp) {}

  /** One request with a single retry on 429 (honouring Retry-After up to 3 s). */
  private async call<T>(name: string, path: string, init?: { method?: string; body?: unknown }): Promise<Result<T>> {
    const req = { method: init?.method ?? 'GET', ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}) };
    let res = await this.http(path, req);
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers.get('Retry-After') ?? '1'), 3) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      res = await this.http(path, req);
    }
    if (res.status === 401 || res.status === 403) return fail('forbidden', `Jira ${name}: no access.`);
    if (res.status === 404) return fail('not_found', `Jira ${name}: not found.`);
    if (res.status >= 400) {
      let detail = '';
      try {
        const body = (await res.json()) as { errorMessages?: string[]; errors?: Record<string, string> };
        detail = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].join(' ').slice(0, 200);
      } catch {
        /* non-JSON error body */
      }
      return fail(res.status === 400 ? 'validation' : 'upstream', `Jira ${name} failed (${res.status})${detail ? `: ${detail}` : ''}.`);
    }
    if (res.status === 204) return ok(undefined as T);
    return ok((await res.json()) as T);
  }

  /** Id of Jira Software's "Flagged" field, looked up once per instance (null if absent). */
  async flaggedFieldId(): Promise<string | null> {
    if (this.flaggedField !== undefined) return this.flaggedField;
    const res = await this.call<Array<{ id: string; name: string }>>('fields', '/rest/api/3/field');
    this.flaggedField = res.ok ? (res.data.find((f) => f.name === 'Flagged')?.id ?? null) : null;
    return this.flaggedField;
  }

  private async fields(): Promise<string[]> {
    const flagged = await this.flaggedFieldId();
    return flagged ? [...BASE_FIELDS, flagged] : BASE_FIELDS;
  }

  /** Search by key or text for the issue picker (up to 20). */
  async searchIssues(text: string, projectKey?: string): Promise<Result<IssueSnapshot[]>> {
    const q = text.trim();
    const clauses: string[] = [];
    if (projectKey) clauses.push(`project = "${projectKey.replace(/"/g, '')}"`);
    if (ISSUE_KEY.test(q.toUpperCase())) clauses.push(`key = "${q.toUpperCase()}"`);
    else if (q) clauses.push(`text ~ "${q.replace(/["\\]/g, ' ')}*"`);
    // /search/jql rejects unbounded queries, so an empty search means "recently updated".
    if (clauses.length === 0) clauses.push('updated >= -30d');
    const jql = `${clauses.join(' AND ')} ORDER BY updated DESC`;
    const params = new URLSearchParams({ jql, maxResults: '20', fields: (await this.fields()).join(',') });
    const res = await this.call<{ issues: JiraIssue[] }>('search', `/rest/api/3/search/jql?${params}`);
    if (!res.ok) return res;
    const flagged = await this.flaggedFieldId();
    return ok(res.data.issues.map((i) => toSnapshot(i, flagged)));
  }

  /** Read many issues in one call; missing or forbidden keys come back as unavailable. */
  async readIssues(keys: string[]): Promise<Result<IssueRead>> {
    const unique = [...new Set(keys.filter((k) => ISSUE_KEY.test(k)))];
    if (unique.length === 0) return ok({ snapshots: [], unavailable: [] });
    const flagged = await this.flaggedFieldId();
    const snapshots: IssueSnapshot[] = [];
    const unavailable: string[] = [];
    for (let i = 0; i < unique.length; i += 100) {
      const batch = unique.slice(i, i + 100);
      const res = await this.call<{ issues: JiraIssue[]; issueErrors?: Array<{ issueIdsOrKeys?: string[] }> }>(
        'bulk read',
        '/rest/api/3/issue/bulkfetch',
        { method: 'POST', body: { issueIdsOrKeys: batch, fields: await this.fields() } },
      );
      if (!res.ok) return res;
      const found = new Set<string>();
      for (const issue of res.data.issues) {
        found.add(issue.key);
        snapshots.push(toSnapshot(issue, flagged));
      }
      unavailable.push(...batch.filter((k) => !found.has(k)));
    }
    return ok({ snapshots, unavailable });
  }

  /**
   * One page of a project for the discovery scan: summary, description and comments as ADF,
   * newest first. `nextPageToken` continues the scan (search/jql pagination).
   */
  async scanProjectPage(
    projectKey: string,
    nextPageToken?: string,
  ): Promise<Result<{ issues: Array<{ key: string; summary: string; description: unknown; comments: unknown[] }>; nextPageToken: string | null }>> {
    const params = new URLSearchParams({
      jql: `project = "${projectKey.replace(/"/g, '')}" ORDER BY updated DESC`,
      maxResults: '20',
      fields: 'summary,description,comment',
    });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const res = await this.call<{
      issues: Array<{ key: string; fields: { summary?: string; description?: unknown; comment?: { comments?: Array<{ body?: unknown }> } } }>;
      nextPageToken?: string;
      isLast?: boolean;
    }>('scan', `/rest/api/3/search/jql?${params}`);
    if (!res.ok) return res;
    return ok({
      issues: res.data.issues.map((i) => ({
        key: i.key,
        summary: i.fields.summary ?? '',
        description: i.fields.description ?? null,
        comments: (i.fields.comment?.comments ?? []).map((c) => c.body ?? null),
      })),
      nextPageToken: res.data.isLast ? null : (res.data.nextPageToken ?? null),
    });
  }

  async issueTypes(projectKey: string): Promise<Result<Array<{ id: string; name: string }>>> {
    const res = await this.call<{ issueTypes?: Array<{ id: string; name: string; subtask?: boolean }> }>(
      'issue types',
      `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`,
    );
    if (!res.ok) return res;
    return ok((res.data.issueTypes ?? []).filter((t) => !t.subtask).map(({ id, name }) => ({ id, name })));
  }

  /** Create a delivery issue as the user (F-24). Description is plain ADF text. */
  async createIssue(input: {
    projectKey: string;
    issueTypeId: string;
    summary: string;
    dueDate: string | null;
    description: string;
  }): Promise<Result<{ key: string }>> {
    return this.call<{ key: string }>('create issue', '/rest/api/3/issue', {
      method: 'POST',
      body: {
        fields: {
          project: { key: input.projectKey },
          issuetype: { id: input.issueTypeId },
          summary: input.summary.slice(0, 250),
          ...(input.dueDate ? { duedate: input.dueDate } : {}),
          description: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: input.description }] }],
          },
        },
      },
    });
  }

  async searchUsers(query: string): Promise<Result<JiraUser[]>> {
    const params = new URLSearchParams({ query: query.trim(), maxResults: '10' });
    const res = await this.call<Array<{ accountId: string; displayName: string; accountType?: string; active?: boolean; avatarUrls?: Record<string, string> }>>(
      'user search',
      `/rest/api/3/user/search?${params}`,
    );
    if (!res.ok) return res;
    return ok(
      res.data
        .filter((u) => u.accountType === 'atlassian' && u.active !== false)
        .map((u) => ({ accountId: u.accountId, displayName: u.displayName, avatarUrl: u.avatarUrls?.['24x24'] })),
    );
  }

  /** Display names for account IDs (up to 200), for owners and history. */
  async users(accountIds: string[]): Promise<Result<Record<string, string>>> {
    // Tally's own actors ("tally-demo", "tally-system") and demo owners are not Jira users.
    const ids = [...new Set(accountIds.filter((id) => id && !id.startsWith('demo-') && !id.startsWith('tally-')))];
    const names: Record<string, string> = {};
    for (let i = 0; i < ids.length; i += 50) {
      const params = new URLSearchParams();
      for (const id of ids.slice(i, i + 50)) params.append('accountId', id);
      params.set('maxResults', '50');
      const res = await this.call<{ values?: Array<{ accountId: string; displayName: string } | null> }>('users', `/rest/api/3/user/bulk?${params}`);
      if (!res.ok) return res;
      // Jira can return null entries for unknown or deleted accounts.
      for (const u of res.data.values ?? []) if (u?.accountId) names[u.accountId] = u.displayName;
    }
    return ok(names);
  }

  /** True when the user holds Jira's global ADMINISTER permission (H9 admin-only actions). */
  /** One cheap call that proves Jira answers for this user; also says whether they are an admin. */
  async access(): Promise<Result<{ isAdmin: boolean }>> {
    const res = await this.call<{ permissions: Record<string, { havePermission: boolean }> }>(
      'permissions',
      '/rest/api/3/mypermissions?permissions=ADMINISTER',
    );
    return res.ok ? ok({ isAdmin: res.data.permissions.ADMINISTER?.havePermission === true }) : res;
  }

  async isAdmin(): Promise<boolean> {
    const res = await this.access();
    return res.ok && res.data.isAdmin;
  }
}
