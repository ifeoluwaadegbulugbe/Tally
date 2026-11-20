// F2 Accounts: table with rollups, search, tier/health filters, New account dialog.
import { useMemo, useState } from 'react';
import type { AccountRollup, Health, Tier } from '../../../../src/core';
import { Dialog, EmptyState, ErrorBanner, Field, HEALTH, HealthChip, SkeletonRows, formatDate } from '../components';
import { navigate } from '../router';
import { callResolver, useResolver } from '../useResolver';

const TIERS: Tier[] = ['enterprise', 'growth', 'standard'];
const tierLabel = (t: Tier) => t[0]!.toUpperCase() + t.slice(1);

export function AccountsScreen() {
  const { data, error, loading, refetch } = useResolver<AccountRollup[]>('listAccounts');
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState<Tier | ''>('');
  const [health, setHealth] = useState<Health | ''>('');
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () =>
      (data ?? [])
        .filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()))
        .filter((a) => (tier ? a.tier === tier : true))
        .filter((a) => (health ? a.health === health : true)),
    [data, search, tier, health],
  );

  const header = (
    <div className="toolbar">
      <input className="input" placeholder="Search accounts" aria-label="Search accounts" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select className="input" aria-label="Filter by tier" value={tier} onChange={(e) => setTier(e.target.value as Tier | '')}>
        <option value="">All tiers</option>
        {TIERS.map((t) => <option key={t} value={t}>{tierLabel(t)}</option>)}
      </select>
      <select className="input" aria-label="Filter by health" value={health} onChange={(e) => setHealth(e.target.value as Health | '')}>
        <option value="">Any health</option>
        {(Object.keys(HEALTH) as Health[]).map((h) => <option key={h} value={h}>{HEALTH[h].label}</option>)}
      </select>
      <span className="spacer" />
      <button className="btn btn-primary" onClick={() => setCreating(true)}>New account</button>
    </div>
  );

  let body;
  if (error) body = <ErrorBanner call={error.call} message={error.message} onRetry={refetch} />;
  else if (loading || !data) body = <SkeletonRows />;
  else if (data.length === 0)
    body = (
      <EmptyState title="No accounts yet">
        <p className="muted">An account is a customer or prospect your team has made promises to.</p>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>New account</button>
      </EmptyState>
    );
  else
    body = (
      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              <th>Account</th><th>Tier</th><th className="num">Open</th><th className="num">At risk</th>
              <th className="num">Overdue</th><th>Next due</th><th>Renewal</th><th>Health</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="clickable" tabIndex={0}
                onClick={() => navigate(`/commitments?account=${a.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/commitments?account=${a.id}`)}>
                <td data-label="Account" className="strong">{a.name}</td>
                <td data-label="Tier">{tierLabel(a.tier)}</td>
                <td data-label="Open" className="num">{a.open}</td>
                <td data-label="At risk" className="num">{a.atRisk}</td>
                <td data-label="Overdue" className="num">{a.overdue}</td>
                <td data-label="Next due">{a.nextDue ? formatDate(a.nextDue) : '—'}</td>
                <td data-label="Renewal">{a.renewalDate ? formatDate(a.renewalDate, true) : '—'}</td>
                <td data-label="Health">{a.open ? <HealthChip health={a.health} /> : <span className="muted">No open items</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="muted center">No accounts match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    );

  return (
    <>
      {header}
      {body}
      {creating && <NewAccountDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refetch(); }} />}
    </>
  );
}

function NewAccountDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [tier, setTier] = useState<Tier>('growth');
  const [renewalDate, setRenewalDate] = useState('');
  const [jiraProjectKey, setJira] = useState('');
  const [confluenceSpaceKey, setSpace] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await callResolver('saveAccount', {
      account: {
        name: name.trim(),
        tier,
        renewalDate: renewalDate || null,
        ...(jiraProjectKey.trim() ? { jiraProjectKey: jiraProjectKey.trim().toUpperCase() } : {}),
        ...(confluenceSpaceKey.trim() ? { confluenceSpaceKey: confluenceSpaceKey.trim() } : {}),
      },
    });
    setBusy(false);
    if (res.ok) onSaved();
    else setError(res.message);
  }

  return (
    <Dialog title="New account" onClose={onClose}>
      <form onSubmit={save} className="form">
        <Field label="Name"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Tier" hint="Sets the default priority of its commitments.">
          <select className="input" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
            {TIERS.map((t) => <option key={t} value={t}>{tierLabel(t)}</option>)}
          </select>
        </Field>
        <Field label="Renewal date (optional)"><input className="input" type="date" value={renewalDate} onChange={(e) => setRenewalDate(e.target.value)} /></Field>
        <Field label="Jira project key (optional)" hint="Used when scanning for promises."><input className="input" value={jiraProjectKey} onChange={(e) => setJira(e.target.value)} placeholder="ACME" /></Field>
        <Field label="Confluence space key (optional)"><input className="input" value={confluenceSpaceKey} onChange={(e) => setSpace(e.target.value)} placeholder="CS" /></Field>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Create account'}</button>
        </div>
      </form>
    </Dialog>
  );
}
