// F4 Commitments: filterable, sortable table with saved views, keyboard navigation
// (j/k to move, Enter to open, c to add), 25 rows per page, and the New commitment dialog (F-01).
import { useEffect, useMemo, useState } from 'react';
import type { CommitmentRow, Health, Status } from '../../../../src/core';
import { compareHealth } from '../../../../src/core/risk';
import { matchesView } from '../../../../src/core/engine';
import {
  Dialog, EmptyState, ErrorBanner, Field, HEALTH, IssueKey, JiraNotice, STATUS_LABEL, SkeletonRows, StatusChip, formatDate, ownerName, rememberUsers,
} from '../components';
import { navigate } from '../router';
import type { Route } from '../router';
import { callResolver, useResolver } from '../useResolver';

interface ListData {
  rows: CommitmentRow[];
  accounts: Array<{ id: string; name: string }>;
  users: Record<string, string>;
  jiraNotice: string | null;
}

type View = '' | 'mine' | 'unassigned' | 'at_risk' | 'overdue';
type SortKey = 'id' | 'title' | 'accountName' | 'owner' | 'dueDate' | 'status' | 'health';

const PAGE = 25;
const OPEN: Status[] = ['confirmed', 'assigned', 'in_delivery', 'renegotiated'];
const today = () => new Date().toISOString().slice(0, 10);

export function CommitmentsScreen({ route, me }: { route: Route; me: string | undefined }) {
  const { data, error, loading, refetch } = useResolver<ListData>('listCommitments');
  rememberUsers(data?.users);
  const [account, setAccount] = useState(route.query.get('account') ?? '');
  const [view, setView] = useState<View>((route.query.get('view') as View) ?? '');
  const [status, setStatus] = useState<Status | '' | 'open'>('open');
  const [health, setHealth] = useState<Health | ''>('');
  const [text, setText] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'health', dir: -1 });
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [creating, setCreating] = useState(false);

  // Follow query changes (e.g. clicking a dashboard KPI or an account row).
  useEffect(() => {
    setAccount(route.query.get('account') ?? '');
    setView((route.query.get('view') as View) ?? '');
  }, [route.path, route.query.toString()]);

  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    const list = (data?.rows ?? [])
      .filter((r) => (account ? r.accountId === account : true))
      .filter((r) => (status === 'open' ? OPEN.includes(r.status) : status ? r.status === status : true))
      .filter((r) => (health ? r.health === health && OPEN.includes(r.status) : true))
      .filter((r) => (t ? `${r.title} ${r.id} ${r.accountName}`.toLowerCase().includes(t) : true))
      // Same rule as the dashboard KPIs (core matchesView), so counts always agree.
      .filter((r) => (view ? matchesView(r, view, me, today()) : true));
    const val = (r: CommitmentRow): string | number => {
      switch (sort.key) {
        case 'health': return OPEN.includes(r.status) ? compareHealth(r.health, 'on_track') : -1;
        case 'owner': return ownerName(r.ownerAccountId, me);
        case 'dueDate': return r.dueDate ?? '9999';
        default: return String(r[sort.key]);
      }
    };
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')) * sort.dir;
    });
  }, [data, account, status, health, text, view, sort, me]);

  useEffect(() => { setPage(0); setCursor(0); }, [account, status, health, text, view]);
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));

  // Keyboard: j/k move, Enter opens, c creates. Ignored while typing in a field or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (creating || ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || e.metaKey || e.ctrlKey) return;
      if (e.key === 'j') setCursor((c) => Math.min(c + 1, pageRows.length - 1));
      else if (e.key === 'k') setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === 'Enter' && pageRows[cursor]) navigate(`/commitments/${pageRows[cursor]!.id}`);
      else if (e.key === 'c') { e.preventDefault(); setCreating(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pageRows, cursor, creating]);

  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const Th = ({ k, children, className }: { k: SortKey; children: string; className?: string }) => (
    <th className={className} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="th-btn" onClick={() => sortBy(k)}>{children}{sort.key === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button>
    </th>
  );

  const views: Array<[View, string]> = [['', 'All'], ['mine', 'Mine'], ['unassigned', 'Unassigned'], ['at_risk', 'At risk'], ['overdue', 'Overdue']];

  return (
    <>
      <div className="views" role="tablist" aria-label="Saved views">
        {views.map(([v, label]) => (
          <button key={label} role="tab" aria-selected={view === v} className={`view-tab ${view === v ? 'active' : ''}`}
            onClick={() => navigate(`/commitments${v ? `?view=${v}` : ''}${account ? `${v ? '&' : '?'}account=${account}` : ''}`)}>
            {label}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input className="input" placeholder="Search commitments" aria-label="Search commitments" value={text} onChange={(e) => setText(e.target.value)} />
        <select className="input" aria-label="Filter by account" value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">All accounts</option>
          {(data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="input" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as Status | '' | 'open')}>
          <option value="open">Open</option>
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="input" aria-label="Filter by health" value={health} onChange={(e) => setHealth(e.target.value as Health | '')}>
          <option value="">Any health</option>
          {(Object.keys(HEALTH) as Health[]).map((h) => <option key={h} value={h}>{HEALTH[h].label}</option>)}
        </select>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)} title="Shortcut: c">New commitment</button>
      </div>

      <JiraNotice message={data?.jiraNotice} />
      {error ? (
        <ErrorBanner call={error.call} message={error.message} onRetry={refetch} />
      ) : loading || !data ? (
        <SkeletonRows />
      ) : data.rows.length === 0 ? (
        <EmptyState title="No commitments yet">
          <p className="muted">Log a promise made to a customer, or load demo data from the Dashboard.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={data.accounts.length === 0}>New commitment</button>
          {data.accounts.length === 0 && <p className="muted small">Create an account first.</p>}
        </EmptyState>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <Th k="title">Commitment</Th><Th k="accountName">Account</Th><Th k="owner">Owner</Th>
                <Th k="dueDate">Due</Th><Th k="health">Health</Th><th>Linked issues</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => (
                <tr key={r.id} className={`clickable ${i === cursor ? 'cursor' : ''}`} tabIndex={0}
                  onClick={() => navigate(`/commitments/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/commitments/${r.id}`)}>
                  <td data-label="Commitment">
                    <div className="strong">{r.title}</div>
                    <div className="muted small">
                      <span className="mono">{r.id}</span>
                      {r.topReason && OPEN.includes(r.status) ? ` · ${r.topReason}` : ''}
                    </div>
                  </td>
                  <td data-label="Account">{r.accountName}</td>
                  <td data-label="Owner">{r.ownerAccountId ? ownerName(r.ownerAccountId, me) : <span className="unassigned">Unassigned</span>}</td>
                  <td data-label="Due">{formatDate(r.dueDate)}</td>
                  <td data-label="Health"><StatusChip status={r.status} health={r.health} /></td>
                  <td data-label="Linked issues">
                    {r.issueKeys.length ? r.issueKeys.map((k) => <IssueKey key={k} issueKey={k} />) : <span className="muted">None</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="muted center">No commitments match these filters.</td></tr>}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="pager">
              <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span className="muted small">Page {page + 1} of {pages} · {rows.length} commitments</span>
              <button className="btn" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
      {creating && data && (
        <NewCommitmentDialog
          accounts={data.accounts}
          defaultAccount={account}
          me={me}
          onClose={() => setCreating(false)}
          onSaved={(id) => { setCreating(false); navigate(`/commitments/${id}`); }}
        />
      )}
    </>
  );
}

function NewCommitmentDialog(props: {
  accounts: Array<{ id: string; name: string }>;
  defaultAccount: string;
  me: string | undefined;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [accountId, setAccountId] = useState(props.defaultAccount || props.accounts[0]?.id || '');
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState<'' | 'me'>('');
  const [dueDate, setDueDate] = useState('');
  const [dueDateSource, setSource] = useState<'stated' | 'estimated'>('stated');
  const [sourceUrl, setSourceUrl] = useState('');
  const [quote, setQuote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await callResolver<{ id: string }>('createCommitment', {
      commitment: {
        accountId,
        title: title.trim(),
        ownerAccountId: owner === 'me' && props.me ? props.me : null,
        dueDate: dueDate || null,
        dueDateSource: dueDate ? dueDateSource : 'unknown',
        ...(sourceUrl.trim() && quote.trim() ? { evidence: { sourceType: 'manual', sourceUrl: sourceUrl.trim(), quote: quote.trim() } } : {}),
      },
    });
    setBusy(false);
    if (res.ok) props.onSaved(res.data.id);
    else setError(res.message);
  }

  const halfEvidence = !!sourceUrl.trim() !== !!quote.trim();

  return (
    <Dialog title="New commitment" onClose={props.onClose}>
      <form onSubmit={save} className="form">
        <Field label="Account">
          <select className="input" required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {props.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="What was promised"><input className="input" required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Support SSO before their rollout" /></Field>
        <Field label="Owner" hint="Picking any Jira user arrives with the Jira integration.">
          <select className="input" value={owner} onChange={(e) => setOwner(e.target.value as '' | 'me')}>
            <option value="">Unassigned</option>
            <option value="me" disabled={!props.me}>Me</option>
          </select>
        </Field>
        <div className="field-row">
          <Field label="Due date (optional)" hint="Unknown dates are allowed but flagged."><input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          <Field label="Date source">
            <select className="input" value={dueDateSource} disabled={!dueDate} onChange={(e) => setSource(e.target.value as 'stated' | 'estimated')}>
              <option value="stated">Stated by customer</option>
              <option value="estimated">Estimated</option>
            </select>
          </Field>
        </div>
        <Field label="Evidence link (optional)"><input className="input" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" /></Field>
        <Field label="Evidence quote (optional)" hint="The exact words, up to 300 characters. Email addresses are masked.">
          <textarea className="input" rows={3} maxLength={600} value={quote} onChange={(e) => setQuote(e.target.value)} />
        </Field>
        {halfEvidence && <p className="muted small">Add both a link and a quote to save evidence.</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={props.onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !title.trim() || !accountId || halfEvidence}>{busy ? 'Saving…' : 'Log commitment'}</button>
        </div>
      </form>
    </Dialog>
  );
}

