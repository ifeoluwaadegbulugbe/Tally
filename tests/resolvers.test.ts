/// <reference types="node" />
// Permissions (O32, H9) through the real resolver definitions: Forge modules are replaced by an
// in-memory store and a fake Jira whose ADMINISTER answer each test sets. Every admin-only
// resolver must refuse a non-admin on the server, not just hide a button.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Handler = (req: { payload?: unknown; context?: unknown }) => Promise<{ ok: boolean; code?: string; data?: unknown; message?: string }>;
const state = vi.hoisted(() => ({ defs: {} as Record<string, Handler>, isAdmin: false }));

vi.mock('@forge/resolver', () => ({
  default: class {
    define(name: string, fn: Handler) { state.defs[name] = fn; }
    getDefinitions() { return state.defs; }
  },
}));
vi.mock('../src/storage/forge-kv', async () => {
  const { MemoryKv } = await import('../src/storage/kv');
  return { forgeKv: new MemoryKv() };
});
vi.mock('../src/jira/forge-http', () => ({
  forgeJiraHttp: async (path: string) => {
    const body = path.startsWith('/rest/api/3/mypermissions')
      ? { permissions: { ADMINISTER: { havePermission: state.isAdmin } } }
      : path === '/rest/api/3/field' ? [] : { issues: [], issueErrors: [] };
    return { status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
  },
}));
vi.mock('../src/confluence/forge-http', () => ({
  forgeConfluenceHttp: async () => ({ status: 200, headers: { get: () => null }, json: async () => ({ results: [] }), text: async () => '' }),
}));
vi.mock('../src/graph/forge-http', () => ({
  forgeGraphHttp: async () => ({ status: 200, json: async () => ({ data: { echo: 'ok' } }) }),
}));

const USER = { accountId: 'u-basic', siteUrl: 'https://example.atlassian.net', cloudId: 'cloud-1' };
const call = (name: string, payload: Record<string, unknown> = {}, context: unknown = USER) => state.defs[name]!({ payload, context });

beforeEach(async () => {
  await import('../src/resolvers');
  state.isAdmin = true;
  await call('resetDemoData');
  await call('seedDemoData');
  state.isAdmin = false;
});

describe('O32: non-admin users', () => {
  it('can use the everyday screens', async () => {
    for (const name of ['getDashboard', 'listCommitments', 'listAccounts', 'listRisks', 'listCandidates', 'listUpdates', 'getSettings', 'getConnections']) {
      const r = await call(name);
      expect(r.ok, `${name}: ${r.message}`).toBe(true);
    }
    const s = await call('getSettings');
    expect((s.data as { isAdmin: boolean }).isAdmin).toBe(false);
  });

  it('are refused admin-only actions by the server', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['seedDemoData', {}],
      ['resetDemoData', {}],
      ['exportData', {}],
      ['saveRuleSettings', { rules: { dueSoonDays: 9, noOwnerHours: 24, noDeliveryWorkDays: 3, staleDays: 7, blockedStatusNames: [] }, tierPriority: { enterprise: 'high', growth: 'normal', standard: 'normal' } }],
    ];
    for (const [name, payload] of cases) {
      const r = await call(name, payload);
      expect(r.ok, name).toBe(false);
      expect(r.code, name).toBe('forbidden');
    }
    // Nothing changed: data is still there and the rule kept its default.
    const s = await call('getSettings');
    expect((s.data as { empty: boolean; rules: { dueSoonDays: number } })).toMatchObject({ empty: false, rules: { dueSoonDays: 3 } });
  });

  it('admins can do them', async () => {
    state.isAdmin = true;
    const saved = await call('saveRuleSettings', { rules: { dueSoonDays: 5, noOwnerHours: 24, noDeliveryWorkDays: 3, staleDays: 7, blockedStatusNames: ['Blocked'] }, tierPriority: { enterprise: 'critical', growth: 'normal', standard: 'normal' } });
    expect(saved.ok).toBe(true);
    const exported = await call('exportData');
    expect(exported.ok && (exported.data as { commitments: unknown[] }).commitments.length).toBeGreaterThan(0);
    const bad = await call('saveRuleSettings', { rules: {}, tierPriority: { enterprise: 'urgent', growth: 'normal', standard: 'normal' } });
    expect(bad.code).toBe('validation');
  });
});

describe('every resolver needs a signed-in user', () => {
  it('refuses calls without an accountId', async () => {
    for (const name of Object.keys(state.defs)) {
      const r = await call(name, {}, { siteUrl: USER.siteUrl });
      expect(r, name).toMatchObject({ ok: false, code: 'forbidden' });
    }
  });
});

describe('resolver errors are envelopes, never throws', () => {
  it('missing ids give validation or not_found', async () => {
    expect((await call('getCommitment')).code).toBe('validation');
    expect((await call('getCommitment', { id: 'nope' })).code).toBe('not_found');
    expect((await call('getUpdate', { id: 'nope' })).code).toBe('not_found');
    expect((await call('getGraphContext', { commitmentId: 'nope' })).code).toBe('not_found');
  });
});

describe('O33: the UI never renders stored text as HTML', () => {
  it('no dangerouslySetInnerHTML or innerHTML anywhere in the UI source', () => {
    const dir = join(__dirname, '..', 'static', 'ui', 'src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (/\.(tsx?|jsx?)$/.test(e.name)) files.push(join(d, e.name));
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=/);
  });
});
