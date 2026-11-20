// F5 Commitment detail: evidence, delivery links, activity on the left; properties,
// risk signals ("Why?") and actions on the right. Every edit sends expectedVersion and
// shows a reload banner on conflict. Quotes render as plain text, never HTML.
import { useEffect, useState } from 'react';
import type { Account, Commitment, Evidence, Health, HistoryRow, IssueSnapshot, Priority, RiskSignal, RuleId } from '../../../../src/core';
import { isOpen } from '../../../../src/core/types';
import {
  Dialog, ErrorBanner, Field, IssueKey, JiraNotice, Link, STATUS_LABEL, SkeletonRows, StatusChip, formatDate, formatWhen, ownerName,
  SourceLink, rememberUsers,
} from '../components';
import { callResolver, useResolver } from '../useResolver';

interface Detail {
  commitment: Commitment;
  account: Account | null;
  health: Health | null;
  evidence: Evidence[];
  history: HistoryRow[];
  signals: RiskSignal[];
  links: Array<{ key: string; state: 'live' | 'demo' | 'unavailable'; issue: IssueSnapshot | null }>;
  rules: Record<RuleId, string>;
  users: Record<string, string>;
  jiraNotice: string | null;
}

const FIELD_LABEL: Record<string, string> = {
  created: 'Logged', seeded: 'Loaded as demo data', title: 'Title', ownerAccountId: 'Owner', dueDate: 'Due date',
  dueDateSource: 'Date source', priority: 'Priority', issueKeys: 'Linked issues', status: 'Status', evidence: 'Evidence added',
  customerInformed: 'Customer informed', riskAcknowledged: 'Risk acknowledged',
};

function describeChange(h: HistoryRow, me?: string): string {
  const v = (x: unknown) => {
    if (x === null || x === undefined || x === '') return 'none';
    if (h.field === 'ownerAccountId') return ownerName(x as string, me);
    if (h.field === 'dueDate') return formatDate(x as string, true);
    if (h.field === 'status') return STATUS_LABEL[x as keyof typeof STATUS_LABEL] ?? String(x);
    if (typeof x === 'boolean') return x ? 'yes' : 'no';
    return String(x);
  };
  if (h.field === 'created' || h.field === 'seeded' || h.field === 'evidence') return FIELD_LABEL[h.field]!;
  if (h.field === 'customerInformed') return `Customer informed: ${h.to ? 'yes' : 'no'}`;
  if (h.field === 'riskAcknowledged') return h.to ? `Risk acknowledged: ${String(h.to)}` : 'Risk acknowledgement cleared';
  return `${FIELD_LABEL[h.field] ?? h.field}: ${v(h.from)} → ${v(h.to)}`;
}

export function CommitmentDetailScreen({ id, me }: { id: string; me: string | undefined }) {
  const { data, error, loading, refetch } = useResolver<Detail>('getCommitment', { id });
  const [actionError, setActionError] = useState<{ code: string; message: string } | null>(null);
  const [dialog, setDialog] = useState<null | 'due' | 'renegotiate' | 'cancel' | 'evidence' | 'link' | 'create' | 'owner'>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [evidencePage, setEvidencePage] = useState<string | null>(null);

  if (error) return <ErrorBanner call={error.call} message={error.message} onRetry={refetch} />;
  if (loading || !data) return <SkeletonRows rows={6} />;

  rememberUsers(data.users);
  const c = data.commitment;
  const open = isOpen(c.status);
  const editable = open || c.status === 'delivered';

  async function update(patch: Partial<Commitment>, reason?: string) {
    setActionError(null);
    const res = await callResolver('updateCommitment', { id: c.id, patch, expectedVersion: c.version, reason });
    if (res.ok) refetch();
    else setActionError(res);
    return res.ok;
  }

  return (
    <>
      <div className="crumbs">
        <Link to="/commitments">Commitments</Link>
        {data.account && <> / <Link to={`/commitments?account=${data.account.id}`}>{data.account.name}</Link></>}
        <span className="muted"> / {c.id}</span>
      </div>

      <JiraNotice message={data.jiraNotice} />
      {actionError && (
        actionError.code === 'conflict' ? (
          <div className="banner banner-warn" role="alert">
            <span>Changed by someone else. Reload to see the latest.</span>
            <button className="btn" onClick={() => { setActionError(null); refetch(); }}>Reload</button>
          </div>
        ) : <ErrorBanner message={actionError.message} />
      )}

      <div className="detail">
        <div className="detail-main">
          {editingTitle !== null ? (
            <form className="title-edit" onSubmit={async (e) => { e.preventDefault(); if (await update({ title: editingTitle.trim() })) setEditingTitle(null); }}>
              <input className="input title-input" autoFocus maxLength={300} value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} aria-label="Title" />
              <button className="btn btn-primary" type="submit" disabled={!editingTitle.trim()}>Save</button>
              <button className="btn" type="button" onClick={() => setEditingTitle(null)}>Cancel</button>
            </form>
          ) : (
            <h1 className="detail-title">
              {c.title}
              {editable && <button className="btn btn-quiet" onClick={() => setEditingTitle(c.title)} aria-label="Edit title">Edit</button>}
            </h1>
          )}

          <section className="section">
            <div className="section-head">
              <h2>Evidence</h2>
              {editable && <button className="btn" onClick={() => setDialog('evidence')}>Add evidence</button>}
            </div>
            {data.evidence.length === 0 ? (
              <p className="muted">No source quote recorded. Add the words and link where this promise was made.</p>
            ) : (
              data.evidence.map((e) => (
                <figure key={e.id} className="evidence">
                  <blockquote>{e.quote}</blockquote>
                  <figcaption className="muted small">
                    <span className="source-type">{e.sourceType === 'jira' ? 'Jira' : e.sourceType === 'confluence' ? 'Confluence' : 'Manual'}</span>
                    {' · captured '}{formatDate(e.capturedAt, true)}
                    {' · '}<SourceLink url={e.sourceUrl} />
                  </figcaption>
                </figure>
              ))
            )}
          </section>

          <section className="section">
            <div className="section-head">
              <h2>Delivery work</h2>
              {editable && (
                <div className="btn-group">
                  <button className="btn" onClick={() => setDialog('link')}>Link issue</button>
                  <button className="btn" onClick={() => setDialog('create')}>Create issue</button>
                </div>
              )}
            </div>
            {data.links.length === 0 ? (
              <p className="muted">No Jira issue linked.</p>
            ) : (
              <ul className="list">
                {data.links.map(({ key, state, issue: i }) => (
                  <li key={key} className="row">
                    <IssueKey issueKey={key} />
                    <div className="row-main">
                      {state === 'unavailable' ? (
                        <span className="muted">No access, or the issue was deleted</span>
                      ) : (
                        <>
                          <div>{i!.summary}</div>
                          <div className="muted small">
                            {i!.assigneeAccountId ? ownerName(i!.assigneeAccountId, me) : 'Unassigned'}
                            {' · '}{i!.dueDate ? `due ${formatDate(i!.dueDate)}` : 'no due date'}
                            {state === 'demo' ? ' · demo snapshot' : ''}
                          </div>
                        </>
                      )}
                    </div>
                    {i && state !== 'unavailable' && (
                      <span className={`lozenge lozenge-${i.statusCategory}`}>{i.flagged ? '⚑ ' : ''}{i.statusName}</span>
                    )}
                    {editable && (
                      <button className="btn btn-quiet" aria-label={`Unlink ${key}`}
                        onClick={async () => {
                          setActionError(null);
                          const res = await callResolver('unlinkIssue', { id: c.id, issueKey: key, expectedVersion: c.version });
                          if (res.ok) refetch();
                          else setActionError(res);
                        }}>Unlink</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <GraphPanel c={c} me={me} editable={editable} linkKeys={c.issueKeys.join(',')}
            onAttachPage={(pageId) => { setEvidencePage(pageId); setDialog('evidence'); }}
            onLink={async (key) => {
              setActionError(null);
              const res = await callResolver('linkIssue', { id: c.id, issueKey: key, expectedVersion: c.version });
              if (res.ok) refetch();
              else setActionError(res);
            }}
            onOwner={async (accountId, name) => { if (name) rememberUsers({ [accountId]: name }); await update({ ownerAccountId: accountId }); }} />

          <section className="section">
            <h2>Activity</h2>
            <ol className="timeline">
              {data.history.map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <div>{describeChange(h, me)}</div>
                  <div className="muted small">
                    {formatWhen(h.at)} · {h.by === 'tally-demo' ? 'Tally demo' : ownerName(h.by, me)}
                    {h.reason ? ` · “${h.reason}”` : ''}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="detail-side">
          <section className="card props">
            <dl>
              <dt>Status</dt>
              <dd><StatusChip status={c.status} health={data.health} />{open && <span className="muted small"> {STATUS_LABEL[c.status]}</span>}</dd>
              <dt>Account</dt>
              <dd>{data.account ? <Link to={`/commitments?account=${data.account.id}`}>{data.account.name}</Link> : 'Unknown'}</dd>
              <dt>Owner</dt>
              <dd>
                {c.ownerAccountId ? ownerName(c.ownerAccountId, me) : <span className="unassigned">Unassigned</span>}
                {editable && (
                  <span className="inline-actions">
                    <button className="btn btn-quiet" onClick={() => setDialog('owner')}>Change</button>
                    {me && c.ownerAccountId !== me && <button className="btn btn-quiet" onClick={() => update({ ownerAccountId: me })}>Assign to me</button>}
                  </span>
                )}
              </dd>
              <dt>Due</dt>
              <dd>
                {formatDate(c.dueDate, true)}
                <span className="muted small"> · {c.dueDateSource === 'stated' ? 'stated by customer' : c.dueDateSource === 'estimated' ? 'estimated' : 'unknown'}</span>
                {editable && <button className="btn btn-quiet" onClick={() => setDialog('due')}>Change</button>}
              </dd>
              <dt>Priority</dt>
              <dd>
                {editable ? (
                  <select className="input" aria-label="Priority" value={c.priority} onChange={(e) => update({ priority: e.target.value as Priority })}>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                  </select>
                ) : c.priority}
                {!c.priorityOverridden && <span className="muted small"> from account tier</span>}
              </dd>
            </dl>
          </section>

          <section className="card">
            <h2>Risk signals</h2>
            {!open ? (
              <p className="muted">Not evaluated: this commitment is {STATUS_LABEL[c.status].toLowerCase()}.</p>
            ) : data.signals.length === 0 ? (
              <p className="muted">No rules fire. On track.</p>
            ) : (
              <ul className="signals">
                {[...data.signals].sort((a, b) => b.severity - a.severity).map((s) => (
                  <li key={s.id}>
                    <details>
                      <summary>
                        <span className="rule-id">{s.rule}</span> {s.reason}
                        <span className="muted small"> Why?</span>
                      </summary>
                      <p className="small">{data.rules[s.rule]}</p>
                      <p className="muted small">
                        Severity {s.severity} · first seen {formatWhen(s.evaluatedAt)}
                        {s.acknowledgedUntil ? ` · acknowledged until ${formatDate(s.acknowledgedUntil)}` : ''}
                      </p>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {c.status !== 'cancelled' && (
            <section className="card actions">
              <Link to={`/updates?account=${c.accountId}`} className="btn">Draft customer update</Link>
            </section>
          )}

          {open && (
            <section className="card actions">
              <button className="btn" onClick={() => setDialog('renegotiate')}>Renegotiate</button>
              <button className="btn btn-danger-quiet" onClick={() => setDialog('cancel')}>Cancel commitment</button>
            </section>
          )}
        </aside>
      </div>

      {dialog === 'due' && (
        <DueDateDialog c={c} onClose={() => setDialog(null)}
          onSave={async (dueDate, source, reason) => { if (await update({ dueDate, dueDateSource: source }, reason)) setDialog(null); }} />
      )}
      {(dialog === 'renegotiate' || dialog === 'cancel') && (
        <TransitionDialog c={c} action={dialog} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refetch(); }} />
      )}
      {dialog === 'link' && (
        <LinkIssueDialog c={c} projectKey={data.account?.jiraProjectKey} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refetch(); }} />
      )}
      {dialog === 'create' && (
        <CreateIssueDialog c={c} projectKey={data.account?.jiraProjectKey} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refetch(); }} />
      )}
      {dialog === 'owner' && (
        <OwnerDialog onClose={() => setDialog(null)}
          onPick={async (accountId, name) => { rememberUsers({ [accountId]: name }); if (await update({ ownerAccountId: accountId })) setDialog(null); }}
          onClear={c.ownerAccountId ? async () => { if (await update({ ownerAccountId: null })) setDialog(null); } : undefined} />
      )}
      {dialog === 'evidence' && (
        <EvidenceDialog commitmentId={c.id} spaceKey={data.account?.confluenceSpaceKey} initialPageId={evidencePage ?? undefined}
          onClose={() => { setDialog(null); setEvidencePage(null); }} onDone={() => { setDialog(null); setEvidencePage(null); refetch(); }} />
      )}
    </>
  );
}

function DueDateDialog({ c, onClose, onSave }: {
  c: Commitment;
  onClose: () => void;
  onSave: (dueDate: string | null, source: Commitment['dueDateSource'], reason: string) => Promise<void>;
}) {
  const [dueDate, setDueDate] = useState(c.dueDate ?? '');
  const [source, setSource] = useState<Commitment['dueDateSource']>(c.dueDate ? c.dueDateSource : 'stated');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const needsReason = !!c.dueDate && dueDate !== c.dueDate;
  return (
    <Dialog title="Change due date" onClose={onClose}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSave(dueDate || null, dueDate ? source : 'unknown', reason.trim()); setBusy(false); }}>
        <div className="field-row">
          <Field label="Due date"><input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          <Field label="Date source">
            <select className="input" value={source} disabled={!dueDate} onChange={(e) => setSource(e.target.value as Commitment['dueDateSource'])}>
              <option value="stated">Stated by customer</option>
              <option value="estimated">Estimated</option>
            </select>
          </Field>
        </div>
        {needsReason && (
          <Field label="Reason" hint="Kept in the activity history. If the customer agreed a new date, use Renegotiate instead.">
            <input className="input" required value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || (needsReason && !reason.trim())}>Save</button>
        </div>
      </form>
    </Dialog>
  );
}

function TransitionDialog({ c, action, onClose, onDone }: { c: Commitment; action: 'renegotiate' | 'cancel'; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [informed, setInformed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = action === 'cancel';
  return (
    <Dialog title={cancel ? 'Cancel commitment' : 'Renegotiate'} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await callResolver('transitionCommitment', {
          id: c.id, action, reason: reason.trim(), expectedVersion: c.version,
          ...(cancel ? { customerInformed: informed } : { newDueDate }),
        });
        setBusy(false);
        if (res.ok) onDone();
        else setError(res.message);
      }}>
        <p className="muted">{cancel ? 'The promise will no longer be tracked. This is recorded in the history.' : 'Record a new date agreed with the customer. The old date stays in the history.'}</p>
        {!cancel && <Field label="New due date"><input className="input" type="date" required value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} /></Field>}
        <Field label="Reason"><input className="input" required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {cancel && (
          <label className="check"><input type="checkbox" checked={informed} onChange={(e) => setInformed(e.target.checked)} /> The customer has been informed</label>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Back</button>
          <button type="submit" className={`btn ${cancel ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !reason.trim() || (!cancel && !newDueDate)}>
            {cancel ? 'Cancel commitment' : 'Save new date'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function EvidenceDialog({ commitmentId, spaceKey, initialPageId, onClose, onDone }: {
  commitmentId: string; spaceKey?: string; initialPageId?: string; onClose: () => void; onDone: () => void;
}) {
  const [tab, setTab] = useState<'confluence' | 'manual'>('confluence');
  return (
    <Dialog title="Add evidence" onClose={onClose}>
      <div className="views" role="tablist" aria-label="Evidence source">
        <button role="tab" aria-selected={tab === 'confluence'} className={`view-tab ${tab === 'confluence' ? 'active' : ''}`} onClick={() => setTab('confluence')}>From Confluence</button>
        <button role="tab" aria-selected={tab === 'manual'} className={`view-tab ${tab === 'manual' ? 'active' : ''}`} onClick={() => setTab('manual')}>Link and quote</button>
      </div>
      {tab === 'confluence'
        ? <ConfluenceEvidence commitmentId={commitmentId} spaceKey={spaceKey} initialPageId={initialPageId} onClose={onClose} onDone={onDone} />
        : <ManualEvidence commitmentId={commitmentId} onClose={onClose} onDone={onDone} />}
    </Dialog>
  );
}

interface PageHit { id: string; title: string; spaceName: string | null; excerpt: string; url: string }
interface PageText { id: string; title: string; url: string; sentences: Array<{ text: string; likelyPromise: boolean }> }

/** Search a page, open it, pick the sentence (or part of it) that holds the promise. */
function ConfluenceEvidence({ commitmentId, spaceKey, initialPageId, onClose, onDone }: {
  commitmentId: string; spaceKey?: string; initialPageId?: string; onClose: () => void; onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [onlySpace, setOnlySpace] = useState(!!spaceKey);
  const [page, setPage] = useState<PageText | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [quote, setQuote] = useState('');
  const [onlyLikely, setOnlyLikely] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { results, error: searchError } = useSearch<PageHit>('searchPages', { text, ...(onlySpace && spaceKey ? { spaceKey } : {}) }, !page);

  async function open(id: string) {
    setLoadingPage(true);
    setError(null);
    const res = await callResolver<PageText>('getPageText', { pageId: id });
    setLoadingPage(false);
    if (res.ok) {
      setPage(res.data);
      setOnlyLikely(res.data.sentences.some((x) => x.likelyPromise));
    } else setError(res.message);
  }

  // Opened from the graph panel's "Attach as evidence": go straight to the quote picker.
  useEffect(() => {
    if (initialPageId) void open(initialPageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPageId]);

  async function save() {
    if (!page) return;
    setBusy(true);
    setError(null);
    const res = await callResolver('addConfluenceEvidence', { commitmentId, pageId: page.id, quote: quote.trim() });
    setBusy(false);
    if (res.ok) onDone();
    else setError(res.message);
  }

  if (!page) {
    return (
      <div className="form">
        <Field label="Search pages by title or text">
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Acme account plan" />
        </Field>
        {spaceKey && (
          <label className="check"><input type="checkbox" checked={onlySpace} onChange={(e) => setOnlySpace(e.target.checked)} /> Only space {spaceKey}</label>
        )}
        {(searchError || error) && <p className="error-text" role="alert">{error ?? searchError}</p>}
        <ul className="list picker">
          {loadingPage ? <li className="muted small">Opening page…</li> :
            results === null ? <li className="muted small">Searching…</li> :
            results.length === 0 ? <li className="muted small">No pages found.</li> :
            results.map((r) => (
              <li key={r.id} className="row clickable" tabIndex={0} onClick={() => open(r.id)} onKeyDown={(e) => e.key === 'Enter' && open(r.id)}>
                <div className="row-main">
                  <div className="strong">{r.title}</div>
                  <div className="muted small">{r.spaceName ? `${r.spaceName} · ` : ''}{r.excerpt}</div>
                </div>
                <span className="link small">Open</span>
              </li>
            ))}
        </ul>
        <div className="form-actions"><button className="btn" onClick={onClose}>Cancel</button></div>
      </div>
    );
  }

  const shown = page.sentences.filter((x) => !onlyLikely || x.likelyPromise);
  return (
    <div className="form">
      <div className="section-head">
        <div className="strong">{page.title}</div>
        <button className="btn btn-quiet" onClick={() => { setPage(null); setQuote(''); }}>Other page</button>
      </div>
      <label className="check"><input type="checkbox" checked={onlyLikely} onChange={(e) => setOnlyLikely(e.target.checked)} /> Only sentences that look like promises</label>
      <ul className="list picker sentences">
        {shown.length === 0 ? <li className="muted small">No matching sentences. Clear the filter to see the whole page.</li> :
          shown.map((x, i) => (
            <li key={i} className={`row clickable ${quote === x.text ? 'cursor' : ''}`} tabIndex={0}
              onClick={() => { setQuote(x.text); setError(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { setQuote(x.text); setError(null); } }}>
              <div className="row-main sentence">{x.text}</div>
              {x.likelyPromise && <span className="chip chip-watch">Likely promise</span>}
            </li>
          ))}
      </ul>
      <Field label="Quote" hint="Pick a sentence above. You may shorten it, but the words must be on the page.">
        <textarea className="input" rows={3} maxLength={300} value={quote} onChange={(e) => { setQuote(e.target.value); setError(null); }} />
      </Field>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !quote.trim()} onClick={save}>{busy ? 'Saving…' : 'Add evidence'}</button>
      </div>
    </div>
  );
}

function ManualEvidence({ commitmentId, onClose, onDone }: { commitmentId: string; onClose: () => void; onDone: () => void }) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [quote, setQuote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      const res = await callResolver('addEvidence', { commitmentId, evidence: { sourceUrl: sourceUrl.trim(), quote: quote.trim() } });
      setBusy(false);
      if (res.ok) onDone();
      else setError(res.message);
    }}>
      <Field label="Link to the source" hint="A Jira issue, email thread or any URL where the promise was made.">
        <input className="input" type="url" required value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Quote" hint="The exact words, up to 300 characters. Email addresses are masked.">
        <textarea className="input" rows={4} required maxLength={600} value={quote} onChange={(e) => setQuote(e.target.value)} />
      </Field>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !sourceUrl.trim() || !quote.trim()}>Add evidence</button>
      </div>
    </form>
  );
}

/** Debounced resolver search used by the issue and user pickers. */
function useSearch<T>(name: string, payload: Record<string, unknown>, enabled: boolean) {
  const [results, setResults] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(payload);
  useEffect(() => {
    if (!enabled) { setResults(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const res = await callResolver<T[]>(name, payload);
      if (!live) return;
      if (res.ok) { setResults(res.data); setError(null); } else { setResults([]); setError(res.message); }
    }, 300);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key, enabled]);
  return { results, error };
}

function LinkIssueDialog({ c, projectKey, onClose, onDone }: { c: Commitment; projectKey?: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [onlyProject, setOnlyProject] = useState(!!projectKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { results, error: searchError } = useSearch<IssueSnapshot>(
    'searchIssues', { text, ...(onlyProject && projectKey ? { projectKey } : {}) }, true,
  );
  async function pick(key: string) {
    setBusy(key);
    setError(null);
    const res = await callResolver('linkIssue', { id: c.id, issueKey: key, expectedVersion: c.version });
    setBusy(null);
    if (res.ok) onDone();
    else setError(res.message);
  }
  return (
    <Dialog title="Link a Jira issue" onClose={onClose}>
      <div className="form">
        <Field label="Search by key or text">
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="ACME-42 or SSO" />
        </Field>
        {projectKey && (
          <label className="check"><input type="checkbox" checked={onlyProject} onChange={(e) => setOnlyProject(e.target.checked)} /> Only project {projectKey}</label>
        )}
        {(searchError || error) && <p className="error-text" role="alert">{error ?? searchError}</p>}
        <ul className="list picker">
          {results === null ? <li className="muted small">Searching…</li> :
            results.length === 0 ? <li className="muted small">No issues found.</li> :
            results.map((i) => {
              const linked = c.issueKeys.includes(i.key);
              return (
                <li key={i.key} className="row">
                  <span className="key-chip">{i.key}</span>
                  <div className="row-main">{i.summary}</div>
                  <span className={`lozenge lozenge-${i.statusCategory}`}>{i.statusName}</span>
                  <button className="btn" disabled={linked || !!busy} onClick={() => pick(i.key)}>
                    {linked ? 'Linked' : busy === i.key ? 'Linking…' : 'Link'}
                  </button>
                </li>
              );
            })}
        </ul>
        <div className="form-actions"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </Dialog>
  );
}

function CreateIssueDialog({ c, projectKey, onClose, onDone }: { c: Commitment; projectKey?: string; onClose: () => void; onDone: () => void }) {
  const [project, setProject] = useState(projectKey ?? '');
  const [types, setTypes] = useState<Array<{ id: string; name: string }> | null>(null);
  const [typeId, setTypeId] = useState('');
  const [summary, setSummary] = useState(c.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const key = project.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]+$/.test(key)) { setTypes(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const res = await callResolver<Array<{ id: string; name: string }>>('getIssueTypes', { projectKey: key });
      if (!live) return;
      if (res.ok) {
        setTypes(res.data);
        setTypeId((res.data.find((x) => x.name === 'Task') ?? res.data[0])?.id ?? '');
        setError(null);
      } else { setTypes([]); setError(res.message); }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [project]);

  return (
    <Dialog title="Create a delivery issue" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await callResolver('createDeliveryIssue', {
          id: c.id, projectKey: project.trim().toUpperCase(), issueTypeId: typeId, summary: summary.trim(), expectedVersion: c.version,
        });
        setBusy(false);
        if (res.ok) onDone();
        else setError(res.message);
      }}>
        <p className="muted">Creates the issue in Jira as you, then links it here.{c.dueDate ? ` Its due date is set to ${formatDate(c.dueDate, true)}.` : ''}</p>
        <div className="field-row">
          <Field label="Project key"><input className="input" required value={project} onChange={(e) => setProject(e.target.value)} placeholder="ACME" /></Field>
          <Field label="Issue type">
            <select className="input" value={typeId} disabled={!types?.length} onChange={(e) => setTypeId(e.target.value)}>
              {!types && <option value="">Enter a project</option>}
              {types?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Summary"><input className="input" required maxLength={250} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !typeId || !summary.trim()}>{busy ? 'Creating…' : 'Create and link'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function OwnerDialog({ onClose, onPick, onClear }: {
  onClose: () => void;
  onPick: (accountId: string, name: string) => Promise<void>;
  onClear?: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const { results, error } = useSearch<{ accountId: string; displayName: string; avatarUrl?: string }>(
    'searchUsers', { query }, query.trim().length >= 2,
  );
  return (
    <Dialog title="Choose an owner" onClose={onClose}>
      <div className="form">
        <Field label="Search people" hint="Type at least two letters of a name or email.">
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        {error && <p className="error-text" role="alert">{error}</p>}
        <ul className="list picker">
          {query.trim().length < 2 ? null : results === null ? <li className="muted small">Searching…</li> :
            results.length === 0 ? <li className="muted small">No people found.</li> :
            results.map((u) => (
              <li key={u.accountId} className="row">
                {/* Initials, not the Jira avatar URL: external images would need an egress permission. */}
                <span className="avatar" aria-hidden="true">{u.displayName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                <div className="row-main">{u.displayName}</div>
                <button className="btn" onClick={() => onPick(u.accountId, u.displayName)}>Assign</button>
              </li>
            ))}
        </ul>
        <div className="form-actions">
          {onClear && <button className="btn" onClick={onClear}>Unassign</button>}
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------- Teamwork Graph context (T14) ----------

interface GraphRelated {
  kind: 'PARENT' | 'CHILD' | 'BLOCKS' | 'BLOCKED_BY' | 'LINKED';
  key: string; summary: string; url: string | null; statusName: string | null; done: boolean;
  assigneeAccountId: string | null; assigneeName: string | null; linked: boolean;
}
interface GraphContextData {
  status: 'ok' | 'unavailable' | 'no_issues' | 'demo_only';
  reason: string | null;
  issues: Array<{ key: string; related: GraphRelated[]; error: string | null }>;
  people: Array<{ accountId: string; role: 'owner' | 'assignee'; pages: Array<{ pageId: string; title: string; url: string | null; lastUpdatedAt: string | null }>; error: string | null }>;
  suggestedOwners: Array<{ accountId: string; name: string | null; why: string }>;
  demoKeys: string[];
  users: Record<string, string>;
}

const KIND_LABEL: Record<GraphRelated['kind'], string> = {
  PARENT: 'Parent', CHILD: 'Child', BLOCKS: 'Blocks', BLOCKED_BY: 'Blocked by', LINKED: 'Linked',
};

/**
 * Related work and pages from the Teamwork Graph. Loads after the page itself, and never
 * leaves a blank panel: a failed call shows "Graph unavailable" with the reason (blueprint K).
 */
function GraphPanel({ c, me, editable, linkKeys, onAttachPage, onLink, onOwner }: {
  c: Commitment; me: string | undefined; editable: boolean; linkKeys: string;
  onAttachPage: (pageId: string) => void;
  onLink: (key: string) => Promise<void>;
  onOwner: (accountId: string, name: string | null) => Promise<void>;
}) {
  const { data, error, loading, refetch } = useResolver<GraphContextData>('getGraphContext', { commitmentId: c.id, linkKeys });
  if (data) rememberUsers(data.users);
  const name = (id: string, fallback?: string | null) => (data?.users[id] || !fallback ? ownerName(id, me) : fallback);

  return (
    <section className="section" aria-label="Teamwork Graph context">
      <div className="section-head">
        <h2>Related context</h2>
        <span className="muted small">from the Teamwork Graph</span>
      </div>
      {loading ? (
        <SkeletonRows rows={2} />
      ) : error ? (
        <div className="banner banner-warn" role="status">
          <span>Graph unavailable: {error.message}</span>
          <button className="btn" onClick={refetch}>Retry</button>
        </div>
      ) : !data ? null : data.status === 'no_issues' || data.status === 'demo_only' ? (
        <p className="muted">{data.reason}</p>
      ) : data.status === 'unavailable' ? (
        <div className="banner banner-warn" role="status">
          <span>Graph unavailable: {data.reason}</span>
          <button className="btn" onClick={refetch}>Retry</button>
        </div>
      ) : (
        <>
          {data.suggestedOwners.length > 0 && (
            <div className="graph-block">
              <h3 className="small strong">Suggested owners</h3>
              <ul className="list">
                {data.suggestedOwners.map((s) => (
                  <li key={s.accountId} className="row">
                    <div className="row-main">
                      <div>{name(s.accountId, s.name)}</div>
                      <div className="muted small">{s.why}</div>
                    </div>
                    {editable && <button className="btn btn-quiet" onClick={() => onOwner(s.accountId, s.name)}>Make owner</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.issues.map((i) => (
            <div key={i.key} className="graph-block">
              <h3 className="small strong">Work related to <IssueKey issueKey={i.key} /></h3>
              {i.error ? (
                <p className="muted small">Graph unavailable for {i.key}: {i.error}</p>
              ) : i.related.length === 0 ? (
                <p className="muted small">The graph has no parent, child, blocking or linked work for {i.key}.</p>
              ) : (
                <ul className="list">
                  {i.related.map((r) => (
                    <li key={`${r.kind}-${r.key}`} className="row">
                      <span className="chip">{KIND_LABEL[r.kind]}</span>
                      <IssueKey issueKey={r.key} />
                      <div className="row-main">
                        <div>{r.summary}</div>
                        <div className="muted small">{r.assigneeAccountId ? name(r.assigneeAccountId, r.assigneeName) : 'Unassigned'}</div>
                      </div>
                      {r.statusName && <span className={`lozenge lozenge-${r.done ? 'done' : 'in_progress'}`}>{r.statusName}</span>}
                      {editable && (r.linked
                        ? <span className="muted small">Linked</span>
                        : <button className="btn btn-quiet" onClick={() => onLink(r.key)}>Link</button>)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {data.people.map((p) => (
            <div key={p.accountId} className="graph-block">
              <h3 className="small strong">Recent pages by {name(p.accountId)} <span className="muted">({p.role})</span></h3>
              {p.error ? (
                <p className="muted small">Graph unavailable: {p.error}</p>
              ) : p.pages.length === 0 ? (
                <p className="muted small">No Confluence pages created in the last 180 days.</p>
              ) : (
                <ul className="list">
                  {p.pages.map((pg) => (
                    <li key={pg.pageId} className="row">
                      <span className="chip">Page</span>
                      <div className="row-main">
                        <div>{pg.url ? <a className="link" href={pg.url} target="_blank" rel="noreferrer noopener">{pg.title}</a> : pg.title}</div>
                        {pg.lastUpdatedAt && <div className="muted small">updated {formatDate(pg.lastUpdatedAt, true)}</div>}
                      </div>
                      {editable && <button className="btn btn-quiet" onClick={() => onAttachPage(pg.pageId)}>Attach as evidence</button>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {data.demoKeys.length > 0 && <p className="muted small">Skipped demo issues {data.demoKeys.join(', ')}: they are not in the graph.</p>}
        </>
      )}
    </section>
  );
}
