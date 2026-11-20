// Settings (F10): export contains every record type, rule settings validate, connection checks.
import { describe, expect, it } from 'vitest';
import { GraphClient } from '../src/graph/client';
import { JiraClient } from '../src/jira/client';
import { MemoryKv } from '../src/storage/kv';
import { Repo } from '../src/storage/repo';
import { NOW } from './helpers';

describe('settings', () => {
  it('export has every record type the app writes, plus settings', async () => {
    const repo = new Repo(new MemoryKv());
    await repo.seedDemo(NOW);
    await repo.createDraft('acct-acme', undefined, { accountId: 'u1' }, NOW);
    const out = await repo.exportAll(NOW);
    expect(out).toMatchObject({ format: 'tally-export/1', exportedAt: NOW.toISOString() });
    for (const k of ['accounts', 'commitments', 'evidence', 'history', 'riskSignals', 'issueSnapshots', 'candidates', 'customerUpdates', 'settings']) {
      expect(out).toHaveProperty(k);
    }
    expect((out.commitments as unknown[]).length).toBeGreaterThan(0);
    expect((out.customerUpdates as unknown[]).length).toBe(1);
  });

  it('rule thresholds are validated before saving', async () => {
    const repo = new Repo(new MemoryKv());
    const bad = await repo.saveSettings({ rules: { dueSoonDays: -1, noOwnerHours: 24, noDeliveryWorkDays: 3, staleDays: 7, blockedStatusNames: [] } });
    expect(!bad.ok && bad.code).toBe('validation');
    const good = await repo.saveSettings({ rules: { dueSoonDays: 5, noOwnerHours: 48, noDeliveryWorkDays: 3, staleDays: 10, blockedStatusNames: ['Blocked'] } });
    expect(good.ok && good.data.rules.dueSoonDays).toBe(5);
    expect((await repo.getSettings()).rules.staleDays).toBe(10);
  });
});

describe('connection checks', () => {
  const res = (status: number, body: unknown) => ({ status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });

  it('Jira access reports admin, and errors become envelopes', async () => {
    const yes = await new JiraClient(async () => res(200, { permissions: { ADMINISTER: { havePermission: true } } })).access();
    expect(yes.ok && yes.data.isAdmin).toBe(true);
    const no = await new JiraClient(async () => res(403, {})).access();
    expect(no.ok).toBe(false);
  });

  it('graph ping: ok on echo, upstream otherwise', async () => {
    expect((await new GraphClient(async () => ({ status: 200, json: async () => ({ data: { echo: 'ok' } }) })).ping()).ok).toBe(true);
    const err = await new GraphClient(async () => ({ status: 200, json: async () => ({ data: null, errors: [{ message: 'FEATURE_UNAVAILABLE' }] }) })).ping();
    expect(!err.ok && err.message).toContain('FEATURE_UNAVAILABLE');
    const down = await new GraphClient(async () => ({ status: 503, json: async () => ({}) })).ping();
    expect(!down.ok && down.code).toBe('upstream');
  });
});
