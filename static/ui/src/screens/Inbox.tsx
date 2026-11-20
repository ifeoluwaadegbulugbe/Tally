// F6 Discovery inbox: scan control with progress, candidate list, review pane.
// A candidate never becomes a commitment without a person pressing Confirm here (O10).
import { useEffect, useMemo, useState } from 'react';
import type { Candidate } from '../../../../src/core/scan';
import { proposedTitle } from '../../../../src/core/scan';
import { EmptyState, ErrorBanner, Field, Link, SkeletonRows, SourceLink, formatDate, formatWhen } from '../components';
import { callResolver, useResolver } from '../useResolver';

interface InboxData {
  candidates: Candidate[];
  accounts: Array<{ id: string; name: string; jiraProjectKey: string | null; confluenceSpaceKey: string | null }>;
  lastScanAt: string | null;
}

type State = Candidate['reviewState'];

const CLASS_LABEL: Record<Candidate['suggestedClass'], { label: string; chip: string; help: string }> = {
  confirmed: { label: 'Commitment', chip: 'chip-on_track', help: 'Specific action, party and date.' },
  possible: { label: 'Possible', chip: 'chip-watch', help: 'Looks like a promise, but the owner or date is vague.' },
  suggestion: { label: 'Discussion', chip: 'chip-cancelled', help: 'An idea or option, not a promise to the customer.' },
  ambiguous: { label: 'Ambiguous', chip: 'chip-at_risk', help: 'Cannot tell who is promising or to whom.' },
};

const STATES: Array<[State, string]> = [['unreviewed', 'To review'], ['ambiguous', 'Ambiguous'], ['confirmed', 'Confirmed'], ['rejected', 'Rejected']];

export function InboxScreen({ me, onCountChange }: { me: string | undefined; onCountChange: () => void }) {
  const { data, error, loading, refetch } = useResolver<InboxData>('listCandidates');
  const [state, setState] = useState<State>('unreviewed');
  const [selected, setSelected] = useState<string | null>(null);

  const list = useMemo(() => (data?.candidates ?? []).filter((c) => c.reviewState === state), [data, state]);
  useEffect(() => {
    if (!list.find((c) => c.id === selected)) setSelected(list[0]?.id ?? null);
  }, [list, selected]);
  const current = list.find((c) => c.id === selected) ?? null;
  const counts = useMemo(() => {
    const m: Record<State, number> = { unreviewed: 0, ambiguous: 0, confirmed: 0, rejected: 0 };
    for (const c of data?.candidates ?? []) m[c.reviewState]++;
    return m;
  }, [data]);

  const reload = () => { refetch(); onCountChange(); };

  if (error) return <ErrorBanner call={error.call} message={error.message} onRetry={refetch} />;
  // Skeleton only before the first load: refetches keep the scan control and its result line mounted.
  if (!data) return loading ? <SkeletonRows /> : null;

  return (
    <>
      <ScanControl accounts={data.accounts} lastScanAt={data.lastScanAt} onFinished={reload} />
      <div className="views" role="tablist" aria-label="Review state">
        {STATES.map(([s, label]) => (
          <button key={s} role="tab" aria-selected={state === s} className={`view-tab ${state === s ? 'active' : ''}`} onClick={() => setState(s)}>
            {label} <span className="count">{counts[s]}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <EmptyState title={state === 'unreviewed' ? 'Inbox clear' : 'Nothing here'}>
          <p className="muted">
            {state === 'unreviewed'
              ? `No candidates waiting.${data.lastScanAt ? ` Last scan ${formatWhen(data.lastScanAt)}.` : ' Run a scan above to find promises in Jira and Confluence.'}`
              : 'No candidates in this state.'}
          </p>
        </EmptyState>
      ) : (
        <div className="inbox">
          <ul className="card inbox-list" aria-label="Candidates">
            {list.map((c) => (
              <li key={c.id} className={`inbox-item clickable ${c.id === selected ? 'cursor' : ''}`} tabIndex={0}
                onClick={() => setSelected(c.id)} onKeyDown={(e) => e.key === 'Enter' && setSelected(c.id)}>
                <div className="inbox-meta">
                  <span className={`chip ${CLASS_LABEL[c.suggestedClass].chip}`}>{CLASS_LABEL[c.suggestedClass].label}</span>
                  <span className="muted small">{c.sourceType === 'jira' ? 'Jira' : c.sourceType === 'confluence' ? 'Confluence' : 'Suggested by Tally Agent'}</span>
                </div>
                <div className="inbox-quote">{c.quote.length > 120 ? `${c.quote.slice(0, 117)}…` : c.quote}</div>
                <div className="muted small">{data.accounts.find((a) => a.id === c.accountId)?.name ?? 'No account yet'}</div>
              </li>
            ))}
          </ul>
          {current && <ReviewPane key={current.id} c={current} accounts={data.accounts} me={me} onDone={reload} />}
        </div>
      )}
    </>
  );
}

function ReviewPane({ c, accounts, me, onDone }: { c: Candidate; accounts: InboxData['accounts']; me: string | undefined; onDone: () => void }) {
  const [accountId, setAccountId] = useState(c.accountId ?? '');
  const [title, setTitle] = useState(proposedTitle(c.quote));
  const [dueDate, setDueDate] = useState(c.dueDate ?? '');
  const [owner, setOwner] = useState<'' | 'me'>('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const open = c.reviewState === 'unreviewed' || c.reviewState === 'ambiguous';

  async function decide(decision: 'confirm' | 'reject' | 'ambiguous') {
    setBusy(true);
    setError(null);
    const res = await callResolver<{ commitment: { id: string } | null }>('reviewCandidate', {
      id: c.id,
      decision,
      reason: reason.trim() || undefined,
      edits: { accountId: accountId || undefined, title: title.trim(), dueDate: dueDate || null, ownerAccountId: owner === 'me' ? me : undefined },
    });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    if (decision === 'confirm' && res.data.commitment) setCreated(res.data.commitment.id);
    else onDone();
  }

  if (created) {
    return (
      <section className="card review">
        <h2>Commitment created</h2>
        <p className="muted">It is now tracked with this quote as evidence.</p>
        <div className="form-actions">
          <Link to={`/commitments/${created}`} className="btn">Open commitment</Link>
          <button className="btn btn-primary" onClick={onDone}>Next candidate</button>
        </div>
      </section>
    );
  }

  return (
    <section className="card review" aria-label="Review candidate">
      <figure className="evidence">
        <blockquote>{c.quote}</blockquote>
        <figcaption className="muted small">
          {c.sourceTitle}{/^https?:/i.test(c.sourceUrl) ? <> · <SourceLink url={c.sourceUrl} /></> : null} · found {formatDate(c.createdAt, true)}
        </figcaption>
      </figure>
      <p className="small">
        <span className={`chip ${CLASS_LABEL[c.suggestedClass].chip}`}>{CLASS_LABEL[c.suggestedClass].label}</span>{' '}
        <span className="muted">Suggested by {c.suggestedBy === 'agent' ? 'Tally Agent' : 'Tally rules'}: {c.reason} {CLASS_LABEL[c.suggestedClass].help}</span>
      </p>
      {c.duplicateOf.length > 0 && (
        <div className="banner banner-warn" role="status">
          <span>Possible duplicate of {c.duplicateOf.map((d) => <Link key={d.id} to={`/commitments/${d.id}`}>{d.id}</Link>)} (similarity {Math.round(c.duplicateOf[0]!.score * 100)}%).</span>
        </div>
      )}
      {c.reviewState === 'rejected' && <p className="muted">Rejected: {c.rejectReason}</p>}
      {c.reviewState === 'confirmed' && c.commitmentId && <p>Confirmed as <Link to={`/commitments/${c.commitmentId}`}>{c.commitmentId}</Link>.</p>}
      {open && (
        <div className="form">
          <Field label="Account">
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Choose an account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Commitment"><input className="input" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="field-row">
            <Field label="Due date" hint={c.dueDate ? 'Taken from the quote.' : 'Not stated in the quote.'}>
              <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Owner">
              <select className="input" value={owner} onChange={(e) => setOwner(e.target.value as '' | 'me')}>
                <option value="">Unassigned</option>
                <option value="me" disabled={!me}>Me</option>
              </select>
            </Field>
          </div>
          {rejecting && (
            <Field label="Why reject?"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Internal discussion, not a promise" /></Field>
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="form-actions wrap">
            {rejecting ? (
              <>
                <button className="btn" onClick={() => setRejecting(false)}>Back</button>
                <button className="btn btn-danger" disabled={busy || !reason.trim()} onClick={() => decide('reject')}>Reject</button>
              </>
            ) : (
              <>
                <button className="btn btn-danger-quiet" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
                {c.reviewState !== 'ambiguous' && <button className="btn" disabled={busy} onClick={() => decide('ambiguous')}>Mark ambiguous</button>}
                <button className="btn btn-primary" disabled={busy || !accountId || !title.trim()} onClick={() => decide('confirm')}>
                  {busy ? 'Saving…' : 'Confirm commitment'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ScanControl({ accounts, lastScanAt, onFinished }: { accounts: InboxData['accounts']; lastScanAt: string | null; onFinished: () => void }) {
  const defaults = useMemo(() => ({
    projects: [...new Set(accounts.map((a) => a.jiraProjectKey).filter(Boolean))].join(', '),
    spaces: [...new Set(accounts.map((a) => a.confluenceSpaceKey).filter(Boolean))].join(', '),
  }), [accounts]);
  const [projects, setProjects] = useState(defaults.projects);
  const [spaces, setSpaces] = useState(defaults.spaces);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ scanned: number; added: number; capped: boolean; skipped: string[]; done: boolean; current: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const split = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    setRunning(true);
    setError(null);
    setProgress({ scanned: 0, added: 0, capped: false, skipped: [], done: false, current: null });
    let payload: Record<string, unknown> = { projectKeys: split(projects), spaceKeys: split(spaces) };
    // Each call scans one page; loop until the server returns no cursor (H8).
    for (let i = 0; i < 40; i++) {
      const res = await callResolver<{ cursor: unknown; scanned: number; added: number; capped: boolean; skipped: string[]; current: string | null }>('scanSources', payload);
      if (!res.ok) { setError(res.message); break; }
      setProgress({ ...res.data, done: res.data.cursor === null });
      if (res.data.cursor === null) break;
      payload = { cursor: res.data.cursor };
    }
    setRunning(false);
    onFinished();
  }

  return (
    <section className="card scan">
      <div className="field-row">
        <Field label="Jira projects" hint="Keys, comma separated."><input className="input" value={projects} onChange={(e) => setProjects(e.target.value)} placeholder="DEMO" /></Field>
        <Field label="Confluence spaces" hint="Keys, comma separated."><input className="input" value={spaces} onChange={(e) => setSpaces(e.target.value)} placeholder="CS" /></Field>
        <div className="scan-action">
          <button className="btn btn-primary" disabled={running || (!projects.trim() && !spaces.trim())} onClick={run}>{running ? 'Scanning…' : 'Scan now'}</button>
        </div>
      </div>
      <p className="muted small" role="status" aria-live="polite">
        {progress
          ? `${progress.done ? 'Done.' : `Scanning${progress.current ? ` ${progress.current}` : ''}…`} Scanned ${progress.scanned} items, ${progress.added} new candidates.`
            + (progress.capped ? ' Stopped at the limit (50 candidates or 200 items); review these, then scan again.' : '')
            + (progress.skipped.length ? ` Skipped (not found or no access): ${progress.skipped.join(', ')}.` : '')
          : lastScanAt ? `Last scan ${formatWhen(lastScanAt)}.` : 'Tally reads the chosen projects and spaces as you and only keeps sentences that look like promises.'}
      </p>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
