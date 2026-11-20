// Customer updates (F-40, F-41). A draft is built from stored fields only and shown next to
// the facts it used. A person edits the wording, approves it, copies it into their own email
// or chat, and marks it sent. Copy stays disabled until approval. Tally never sends anything.
import { useEffect, useRef, useState } from 'react';
import type { CommitmentRow, UpdateDraft } from '../../../../src/core';
import {
  Dialog, EmptyState, ErrorBanner, Field, HealthChip, Link, STATUS_LABEL, SkeletonRows, StatusChip, formatDate, formatWhen, ownerName, rememberUsers,
} from '../components';
import { navigate } from '../router';
import type { Route } from '../router';
import { callResolver, useResolver } from '../useResolver';

type DraftRow = Omit<UpdateDraft, 'body'> & { preview: string };
interface ListData { drafts: DraftRow[]; accounts: Array<{ id: string; name: string }>; users: Record<string, string> }
interface Detail {
  draft: UpdateDraft;
  account: { id: string; name: string } | null;
  facts: Array<CommitmentRow | { id: string; missing: true }>;
  stale: string[];
  users: Record<string, string>;
}

const STATE: Record<UpdateDraft['status'], { label: string; chip: string }> = {
  draft: { label: 'Draft', chip: 'chip-watch' },
  approved: { label: 'Approved', chip: 'chip-delivered' },
  sent: { label: 'Sent', chip: 'chip-on_track' },
};

export function UpdatesScreen({ route, me }: { route: Route; me: string | undefined }) {
  const { data, error, loading, refetch } = useResolver<ListData>('listUpdates');
  const selected = route.segments[1] ?? null;
  const startFor = route.query.get('account');
  const [creating, setCreating] = useState<string | null>(startFor);
  useEffect(() => setCreating(startFor), [startFor]);

  if (error) return <ErrorBanner call={error.call} message={error.message} onRetry={refetch} />;
  if (loading || !data) return <SkeletonRows />;
  rememberUsers(data.users);
  const name = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? 'Unknown account';
  const current = selected ?? data.drafts[0]?.id ?? null;

  return (
    <>
      <div className="toolbar">
        <p className="muted small">Drafts use stored facts only. Approve before copying; Tally never sends anything.</p>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreating('')}>New draft</button>
      </div>
      {data.drafts.length === 0 ? (
        <EmptyState title="No customer updates yet">
          <p className="muted">Draft an update for an account. Tally writes it from the commitments it tracks, and a person approves it.</p>
          <button className="btn btn-primary" onClick={() => setCreating('')}>New draft</button>
        </EmptyState>
      ) : (
        <div className="inbox">
          <ul className="card inbox-list" aria-label="Customer updates">
            {data.drafts.map((d) => (
              <li key={d.id} className={`inbox-item clickable ${d.id === current ? 'cursor' : ''}`} tabIndex={0}
                onClick={() => navigate(`/updates/${d.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/updates/${d.id}`)}>
                <div className="inbox-meta">
                  <span className="strong">{name(d.accountId)}</span>
                  <span className={`chip ${STATE[d.status].chip}`}>{STATE[d.status].label}</span>
                </div>
                <div className="inbox-quote small">{d.preview}</div>
                <div className="muted small">
                  {d.status === 'sent' && d.sentAt ? `Sent ${formatWhen(d.sentAt)} by ${ownerName(d.sentBy ?? null, me)}` : `Drafted ${formatWhen(d.createdAt)}${d.source === 'agent' ? ' by Tally Agent' : ''}`}
                  {' · '}{d.commitmentIds.length} commitment{d.commitmentIds.length === 1 ? '' : 's'}
                </div>
              </li>
            ))}
          </ul>
          {current && <UpdatePane key={current} id={current} me={me} onChanged={refetch} />}
        </div>
      )}
      {creating !== null && (
        <NewDraftDialog accounts={data.accounts} initial={creating} onClose={() => { setCreating(null); if (startFor) navigate('/updates'); }}
          onCreated={(id) => { setCreating(null); refetch(); navigate(`/updates/${id}`); }} />
      )}
    </>
  );
}

function UpdatePane({ id, me, onChanged }: { id: string; me: string | undefined; onChanged: () => void }) {
  const { data, error, loading, refetch } = useResolver<Detail>('getUpdate', { id });
  const [body, setBody] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
  const [copied, setCopied] = useState<'ok' | 'manual' | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  if (error) return <ErrorBanner call={error.call} message={error.message} onRetry={refetch} />;
  if (loading || !data) return <div className="card"><SkeletonRows rows={4} /></div>;
  rememberUsers(data.users);
  const d = data.draft;
  const editing = d.status === 'draft';
  const text = body ?? d.body;
  const dirty = body !== null && body.trim() !== d.body;

  async function act(name: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setProblem(null);
    const res = await callResolver(name, { id: d.id, expectedVersion: d.version, ...extra });
    setBusy(false);
    if (!res.ok) { setProblem(res); return false; }
    setBody(null);
    refetch();
    onChanged();
    return true;
  }

  async function copy() {
    setCopied(null);
    try {
      await navigator.clipboard.writeText(d.body);
      setCopied('ok');
      return;
    } catch { /* the iframe may not allow the async clipboard; fall back below */ }
    const el = textRef.current;
    if (el) {
      el.focus();
      el.select();
      try { if (document.execCommand('copy')) { setCopied('ok'); return; } } catch { /* fall through */ }
    }
    setCopied('manual');
  }

  return (
    <section className="card review" aria-label="Update">
      <div className="section-head">
        <h2>{data.account?.name ?? 'Unknown account'}</h2>
        <span className={`chip ${STATE[d.status].chip}`}>{STATE[d.status].label}</span>
      </div>

      {problem && (problem.code === 'conflict'
        ? <div className="banner banner-warn" role="alert"><span>{problem.message}</span><button className="btn" onClick={() => { setProblem(null); setBody(null); refetch(); }}>Reload</button></div>
        : <ErrorBanner message={problem.message} />)}
      {editing && data.stale.length > 0 && (
        <div className="banner banner-warn" role="status">
          <span>Commitments changed since this was drafted ({data.stale.join(', ')}). It cannot be approved; create a new draft.</span>
        </div>
      )}

      <Field label={editing ? 'Message (edit the wording, keep the facts)' : 'Message'}>
        <textarea ref={textRef} className="input update-body" rows={12} value={text} readOnly={!editing}
          maxLength={5000} onChange={(e) => setBody(e.target.value)} aria-label="Update text" />
      </Field>

      <div className="form-actions wrap">
        {editing && (
          <>
            <button className="btn" disabled={busy || !dirty || !text.trim()} onClick={() => act('editUpdate', { body: text })}>Save edits</button>
            <button className="btn btn-primary" disabled={busy || dirty || data.stale.length > 0}
              title={dirty ? 'Save your edits first' : undefined} onClick={() => act('approveUpdate')}>Approve</button>
          </>
        )}
        <button className="btn" disabled={d.status === 'draft'} onClick={copy}
          title={d.status === 'draft' ? 'Approve the update before copying it' : undefined}>Copy text</button>
        {d.status === 'approved' && <button className="btn btn-primary" disabled={busy} onClick={() => act('markUpdateSent')}>Mark as sent</button>}
        {d.status !== 'sent' && (
          confirmDiscard
            ? <><span className="muted small">Discard this update?</span>
                <button className="btn btn-danger" disabled={busy} onClick={async () => { if (await act('discardUpdate')) navigate('/updates'); }}>Discard</button>
                <button className="btn" onClick={() => setConfirmDiscard(false)}>Keep</button></>
            : <button className="btn btn-danger-quiet" onClick={() => setConfirmDiscard(true)}>Discard</button>
        )}
      </div>
      {copied === 'ok' && <p className="muted small" role="status">Copied. Paste it into your email or chat.</p>}
      {copied === 'manual' && <p className="muted small" role="status">Your browser blocked copying here. The text is selected: press Ctrl+C (Cmd+C on Mac).</p>}
      {d.status === 'draft' && <p className="muted small">Copy is enabled once a person approves the update.</p>}
      {d.status === 'approved' && <p className="muted small">Send it yourself from your email or chat, then mark it sent. Delivered commitments it covers become Communicated.</p>}

      <h3 className="small strong facts-head">Facts used ({data.facts.length})</h3>
      <ul className="list">
        {data.facts.map((f) => 'missing' in f ? (
          <li key={f.id} className="row"><span className="muted">{f.id}: no longer in Tally</span></li>
        ) : (
          <li key={f.id} className="row">
            <div className="row-main">
              <div><Link to={`/commitments/${f.id}`}>{f.title}</Link></div>
              <div className="muted small">
                {f.id} · {STATUS_LABEL[f.status]} · {f.dueDate ? `due ${formatDate(f.dueDate)}` : 'no due date'} · {f.ownerAccountId ? ownerName(f.ownerAccountId, me) : 'Unassigned'}
              </div>
            </div>
            {['delivered', 'communicated', 'cancelled'].includes(f.status) ? <StatusChip status={f.status} /> : <HealthChip health={f.health} />}
          </li>
        ))}
      </ul>

      <dl className="audit small muted">
        <dt>Drafted</dt><dd>{formatWhen(d.createdAt)} by {d.source === 'agent' ? `Tally Agent for ${ownerName(d.createdBy, me)}` : ownerName(d.createdBy, me)}</dd>
        {d.editedAt && <><dt>Edited</dt><dd>{formatWhen(d.editedAt)} by {ownerName(d.editedBy ?? null, me)}</dd></>}
        {d.approvedAt && <><dt>Approved</dt><dd>{formatWhen(d.approvedAt)} by {ownerName(d.approvedBy ?? null, me)}</dd></>}
        {d.sentAt && <><dt>Sent</dt><dd>{formatWhen(d.sentAt)} by {ownerName(d.sentBy ?? null, me)}</dd></>}
      </dl>
    </section>
  );
}

function NewDraftDialog({ accounts, initial, onClose, onCreated }: {
  accounts: Array<{ id: string; name: string }>; initial: string; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [accountId, setAccountId] = useState(initial || accounts[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Dialog title="New customer update" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setProblem(null);
        const res = await callResolver<UpdateDraft>('createUpdate', { accountId });
        setBusy(false);
        if (res.ok) onCreated(res.data.id);
        else setProblem(res.message);
      }}>
        <Field label="Account" hint="The draft covers this account's commitments that are not cancelled.">
          <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        {problem && <p className="error-text" role="alert">{problem}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !accountId}>{busy ? 'Drafting…' : 'Draft update'}</button>
        </div>
      </form>
    </Dialog>
  );
}
