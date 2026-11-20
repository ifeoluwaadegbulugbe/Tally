// F1 Dashboard: KPI cards (each opens the matching Commitments view), needs-attention
// list, next 14 days, recently delivered, and the demo data controls.
import { useState } from 'react';
import type { Dashboard } from '../../../../src/core';
import { HealthChip, JiraNotice, Link, formatDate, ownerName, rememberUsers } from '../components';
import { navigate } from '../router';
import { callResolver, useResolver } from '../useResolver';

type DashboardData =
  | { empty: true; isAdmin: boolean }
  | (Dashboard & { empty: false; accounts: Record<string, string>; users: Record<string, string>; jiraNotice: string | null; isAdmin: boolean });

function DemoControls({ empty, onDone }: { empty: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two-step confirm inline: browser dialogs can be blocked inside the Forge iframe.
  const [confirming, setConfirming] = useState(false);

  async function run(name: 'seedDemoData' | 'resetDemoData') {
    setConfirming(false);
    setBusy(true);
    setError(null);
    const res = await callResolver(name);
    setBusy(false);
    if (res.ok) onDone();
    else setError(res.message);
  }

  return (
    <div className="demo-controls">
      {empty ? (
        <button className="btn btn-primary" disabled={busy} onClick={() => run('seedDemoData')}>
          {busy ? 'Loading…' : 'Load demo data'}
        </button>
      ) : confirming ? (
        <>
          <span className="error-text">Delete every Tally record on this site? This cannot be undone.</span>
          <button className="btn btn-danger" onClick={() => run('resetDemoData')}>Delete</button>
          <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
        </>
      ) : (
        <button className="btn" disabled={busy} onClick={() => setConfirming(true)}>
          {busy ? 'Deleting…' : 'Delete all data'}
        </button>
      )}
      {error && <span className="error-text" role="alert">{error}</span>}
    </div>
  );
}

export function DashboardScreen({ me }: { me: string | undefined }) {
  const { data, error, loading, refetch } = useResolver<DashboardData>('getDashboard');

  if (error) {
    return (
      <div className="banner" role="alert">
        <span>Could not load the dashboard ({error.call}: {error.message})</span>
        <button className="btn" onClick={refetch}>Retry</button>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div aria-busy="true">
        <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="card kpi skeleton" />)}</div>
        <div className="card">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="row skeleton-row" />)}</div>
      </div>
    );
  }

  if (data.empty) {
    return (
      <div className="card empty">
        <h2>No commitments yet</h2>
        <p className="muted">Scan your projects or load demo data to see how Tally tracks customer promises.</p>
        {data.isAdmin ? <DemoControls empty onDone={refetch} /> : <p className="muted small">Ask a Jira admin to load demo data, or log a commitment from Commitments.</p>}
      </div>
    );
  }
  rememberUsers(data.users);

  const kpis = [
    { label: 'Open', value: data.counts.open, to: '/commitments' },
    { label: 'At risk', value: data.counts.atRisk, to: '/commitments?view=at_risk' },
    { label: 'Overdue', value: data.counts.overdue, to: '/commitments?view=overdue' },
    { label: 'No owner', value: data.counts.noOwner, to: '/commitments?view=unassigned' },
  ];

  return (
    <>
      <JiraNotice message={data.jiraNotice} />
      <div className="kpis">
        {kpis.map((k) => (
          <button key={k.label} className="card kpi kpi-btn" onClick={() => navigate(k.to)} aria-label={`${k.value} ${k.label}: open list`}>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-label">{k.label}</div>
          </button>
        ))}
      </div>
      <div className="cols">
        <section className="card">
          <h2>Needs attention</h2>
          {data.attention.length === 0 ? (
            <p className="muted">Nothing needs attention.</p>
          ) : (
            <ul className="list">
              {data.attention.map((r) => (
                <li key={r.commitmentId} className="row clickable" tabIndex={0}
                  onClick={() => navigate(`/commitments/${r.commitmentId}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/commitments/${r.commitmentId}`)}>
                  <HealthChip health={r.health} />
                  <div className="row-main">
                    <div className="row-title">{r.title}</div>
                    <div className="muted small">{data.accounts[r.accountId] ?? r.accountId} · {r.reason}</div>
                  </div>
                  <div className="row-meta">
                    <div>{r.ownerAccountId ? ownerName(r.ownerAccountId, me) : <span className="unassigned">Unassigned</span>}</div>
                    <div className="muted small">{formatDate(r.dueDate)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Due in the next 14 days</h2>
          {data.upcoming.length === 0 ? <p className="muted">Nothing due.</p> : (
            <ul className="list">
              {data.upcoming.map((u) => (
                <li key={u.id} className="row compact">
                  <div className="row-main">
                    <Link to={`/commitments/${u.id}`} className="row-title link-plain">{u.title}</Link>
                    <div className="muted small">{data.accounts[u.accountId] ?? u.accountId}</div>
                  </div>
                  <div className="muted small">{formatDate(u.dueDate)}</div>
                </li>
              ))}
            </ul>
          )}
          <h2 className="spaced">Recently delivered</h2>
          {data.delivered.length === 0 ? <p className="muted">Nothing delivered yet.</p> : (
            <ul className="list">
              {data.delivered.map((d) => (
                <li key={d.id} className="row compact">
                  <span className="chip chip-delivered"><span aria-hidden="true">✓✓</span> Delivered</span>
                  <Link to={`/commitments/${d.id}`} className="row-main link-plain">{d.title}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {data.isAdmin && (
        <footer className="footer">
          <DemoControls empty={false} onDone={refetch} />
        </footer>
      )}
    </>
  );
}
