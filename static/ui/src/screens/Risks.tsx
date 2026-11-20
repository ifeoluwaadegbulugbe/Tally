// F7 Risks: signals grouped by rule with counts, a Rules drawer that prints every rule and
// its current thresholds in plain language, and Acknowledge (reason + until date, F-32).
import { useState } from 'react';
import type { RiskGroup, RiskItem } from '../../../../src/core/engine';
import type { RuleId } from '../../../../src/core/types';
import { Dialog, EmptyState, ErrorBanner, Field, HealthChip, JiraNotice, Link, SkeletonRows, formatDate, ownerName, rememberUsers } from '../components';
import { callResolver, useResolver } from '../useResolver';

interface RisksData {
  groups: RiskGroup[];
  acknowledged: RiskItem[];
  rules: Record<RuleId, string>;
  severity: Record<RuleId, number>;
  users: Record<string, string>;
  jiraNotice: string | null;
}

const RULE_NAME: Record<RuleId, string> = {
  R1: 'Overdue', R2: 'Due soon', R3: 'No owner', R4: 'No delivery work', R5: 'Blocked work',
  R6: 'Date mismatch', R7: 'Date moved', R8: 'No evidence', R9: 'Stale delivery',
};

const SEVERITY_LABEL = (n: number) => (n >= 5 ? 'Critical' : n === 4 ? 'At risk' : 'Watch');

export function RisksScreen({ me }: { me: string | undefined }) {
  const { data, error, loading, refetch } = useResolver<RisksData>('listRisks');
  const [drawer, setDrawer] = useState(false);
  const [ack, setAck] = useState<RiskItem | null>(null);
  const [showAcked, setShowAcked] = useState(false);

  if (error) return <ErrorBanner call={error.call} message={error.message} onRetry={refetch} />;
  if (!data) return loading ? <SkeletonRows /> : null;
  rememberUsers(data.users);
  const total = data.groups.reduce((n, g) => n + g.items.length, 0);

  async function clearAck(item: RiskItem) {
    const res = await callResolver('acknowledgeSignal', { signalId: item.signalId, until: null });
    if (res.ok) refetch();
  }

  return (
    <>
      <JiraNotice message={data.jiraNotice} />
      <div className="toolbar">
        <span className="muted">{total === 0 ? 'No active risks.' : `${total} active ${total === 1 ? 'risk' : 'risks'} across ${data.groups.length} ${data.groups.length === 1 ? 'rule' : 'rules'}.`}</span>
        <span className="spacer" />
        <button className="btn" onClick={() => setDrawer(true)}>Rules</button>
      </div>

      {total === 0 ? (
        <EmptyState title="Nothing at risk">
          <p className="muted">Every open commitment passes all nine rules.</p>
        </EmptyState>
      ) : (
        data.groups.map((g) => (
          <section key={g.rule} className="card risk-group">
            <div className="section-head">
              <h2>
                <span className="rule-id">{g.rule}</span> {RULE_NAME[g.rule]} <span className="count">{g.items.length}</span>
              </h2>
              <span className="muted small">{SEVERITY_LABEL(g.severity)} · severity {g.severity}</span>
            </div>
            <ul className="list">
              {g.items.map((i) => <RiskRow key={i.signalId} item={i} me={me} onAck={() => setAck(i)} />)}
            </ul>
          </section>
        ))
      )}

      {data.acknowledged.length > 0 && (
        <section className="card risk-group">
          <button className="btn btn-quiet" aria-expanded={showAcked} onClick={() => setShowAcked((v) => !v)}>
            {showAcked ? 'Hide' : 'Show'} acknowledged ({data.acknowledged.length})
          </button>
          {showAcked && (
            <ul className="list">
              {data.acknowledged.map((i) => (
                <li key={i.signalId} className="row">
                  <span className="rule-id">{i.rule}</span>
                  <div className="row-main">
                    <Link to={`/commitments/${i.commitmentId}`} className="link-plain strong">{i.title}</Link>
                    <div className="muted small">
                      {i.reason} · hidden until {formatDate(i.acknowledgedUntil)} by {ownerName(i.acknowledgedBy ?? null, me)}: “{i.acknowledgedReason}”
                    </div>
                  </div>
                  <button className="btn btn-quiet" onClick={() => clearAck(i)}>Show again</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {drawer && (
        <div className="overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <aside className="drawer card" role="dialog" aria-modal="true" aria-label="Risk rules">
            <div className="section-head">
              <h2>How Tally flags risk</h2>
              <button className="btn" onClick={() => setDrawer(false)} autoFocus>Close</button>
            </div>
            <p className="muted small">Rules, not predictions. A commitment's health is its most severe active rule: 5 Critical, 4 At risk, 2–3 Watch.</p>
            <ul className="list">
              {(Object.keys(data.rules) as RuleId[]).map((r) => (
                <li key={r} className="row">
                  <span className="rule-id">{r}</span>
                  <div className="row-main">
                    <div className="strong">{RULE_NAME[r]}</div>
                    <div className="small">{data.rules[r]}</div>
                  </div>
                  <span className="muted small">{SEVERITY_LABEL(data.severity[r])} ({data.severity[r]})</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}

      {ack && <AckDialog item={ack} onClose={() => setAck(null)} onDone={() => { setAck(null); refetch(); }} />}
    </>
  );
}

function RiskRow({ item: i, me, onAck }: { item: RiskItem; me: string | undefined; onAck: () => void }) {
  return (
    <li className="row">
      <HealthChip health={i.health} />
      <div className="row-main">
        <Link to={`/commitments/${i.commitmentId}`} className="link-plain strong">{i.title}</Link>
        <div className="muted small">{i.accountName} · {i.reason}</div>
      </div>
      <div className="row-meta">
        <div>{i.ownerAccountId ? ownerName(i.ownerAccountId, me) : <span className="unassigned">Unassigned</span>}</div>
        <div className="muted small">{formatDate(i.dueDate)}</div>
      </div>
      <button className="btn btn-quiet" onClick={onAck}>Acknowledge</button>
    </li>
  );
}

function AckDialog({ item, onClose, onDone }: { item: RiskItem; onClose: () => void; onDone: () => void }) {
  const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const [until, setUntil] = useState(inAWeek);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={`Acknowledge ${item.rule}: ${RULE_NAME[item.rule]}`} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await callResolver('acknowledgeSignal', { signalId: item.signalId, until, reason: reason.trim() });
        setBusy(false);
        if (res.ok) onDone();
        else setError(res.message);
      }}>
        <p className="muted">“{item.reason}” on <strong>{item.title}</strong> stops counting toward its health until the end of the chosen day, then comes back if it still applies.</p>
        <Field label="Why is this acceptable for now?"><input className="input" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer agreed to a short delay" /></Field>
        <Field label="Hide until" hint="Up to 90 days."><input className="input" type="date" required value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !reason.trim() || !until}>Acknowledge</button>
        </div>
      </form>
    </Dialog>
  );
}
