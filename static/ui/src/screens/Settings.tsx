// F10 Settings: live connection checks, the Rovo agent and MCP server, risk rule thresholds
// (admins edit, everyone reads), and data: export, load demo data, delete everything.
import { view } from '@forge/bridge';
import { useEffect, useState } from 'react';
import type { Priority, RuleConfig, RuleId, Tier } from '../../../../src/core';
import { ErrorBanner, Field, SkeletonRows } from '../components';
import { callResolver, useResolver } from '../useResolver';

interface SettingsData {
  rules: RuleConfig;
  tierPriority: Record<Tier, Priority>;
  described: Record<RuleId, string>;
  empty: boolean;
  isAdmin: boolean;
  demoLoadedAt: string | null;
}
interface Check { ok: boolean; detail: string | null }
interface Connections { jira: Check; confluence: Check; graph: Check; isAdmin: boolean; mcpUrl: string }

export function SettingsScreen() {
  const settings = useResolver<SettingsData>('getSettings');
  // The delete confirmation asks for this site's host name, so it cannot be done by accident.
  const [siteHost, setSiteHost] = useState<string | undefined>();
  useEffect(() => {
    view.getContext()
      .then((ctx) => { const url = (ctx as { siteUrl?: string }).siteUrl; if (url) setSiteHost(new URL(url).host); })
      .catch(() => undefined);
  }, []);
  return (
    <div className="settings">
      <ConnectionsCard />
      {settings.error ? <ErrorBanner call={settings.error.call} message={settings.error.message} onRetry={settings.refetch} />
        : settings.loading || !settings.data ? <SkeletonRows rows={4} />
        : (
          <>
            <RulesCard data={settings.data} onSaved={settings.refetch} />
            <DataCard data={settings.data} siteHost={siteHost} onChanged={settings.refetch} />
          </>
        )}
    </div>
  );
}

function Status({ check, label }: { check: Check; label: string }) {
  return (
    <li className="row">
      <div className="row-main">
        <div className="strong">{label}</div>
        {check.detail && <div className="muted small">{check.detail}</div>}
      </div>
      <span className={`chip ${check.ok ? 'chip-on_track' : 'chip-critical'}`}>
        <span aria-hidden="true">{check.ok ? '✓' : '!'}</span> {check.ok ? 'Connected' : 'Not reachable'}
      </span>
    </li>
  );
}

function ConnectionsCard() {
  const { data, error, loading, refetch } = useResolver<Connections>('getConnections');
  const [copied, setCopied] = useState(false);
  return (
    <section className="card section" aria-labelledby="conn-h">
      <div className="section-head">
        <h2 id="conn-h">Connections</h2>
        <button className="btn btn-quiet" onClick={refetch}>Check again</button>
      </div>
      <p className="muted small">Each check runs as you, so it shows what Tally can reach with your permissions.</p>
      {error ? <ErrorBanner call={error.call} message={error.message} onRetry={refetch} />
        : loading || !data ? <SkeletonRows rows={3} />
        : (
          <ul className="list">
            <Status label="Jira (issues, people)" check={data.jira} />
            <Status label="Confluence (pages for evidence and scans)" check={data.confluence} />
            <Status label="Teamwork Graph (related work)" check={data.graph} />
            <li className="row">
              <div className="row-main">
                <div className="strong">Rovo agent and MCP server</div>
                <div className="muted small">
                  Installed with Tally. Find "Tally Agent" in Rovo chat. Other AI tools connect to the MCP server below once an
                  admin turns on "Expose tools to MCP-compatible apps" for Tally in Atlassian Administration (Apps, Connected apps).
                </div>
                <div className="mcp-url">
                  <code className="mono">{data.mcpUrl}</code>
                  <button className="btn btn-quiet" onClick={async () => {
                    try { await navigator.clipboard.writeText(data.mcpUrl); setCopied(true); } catch { setCopied(false); }
                  }}>{copied ? 'Copied' : 'Copy'}</button>
                </div>
              </div>
            </li>
          </ul>
        )}
    </section>
  );
}

const RULE_FIELDS: Array<{ key: keyof Omit<RuleConfig, 'blockedStatusNames'>; label: string; unit: string; min: number }> = [
  { key: 'dueSoonDays', label: 'Due soon window', unit: 'days', min: 0 },
  { key: 'noOwnerHours', label: 'Unowned for', unit: 'hours', min: 1 },
  { key: 'noDeliveryWorkDays', label: 'No delivery work after', unit: 'days', min: 1 },
  { key: 'staleDays', label: 'No Jira activity for', unit: 'days', min: 1 },
];
const TIERS: Tier[] = ['enterprise', 'growth', 'standard'];

function RulesCard({ data, onSaved }: { data: SettingsData; onSaved: () => void }) {
  const [rules, setRules] = useState(data.rules);
  const [blocked, setBlocked] = useState(data.rules.blockedStatusNames.join(', '));
  const [tiers, setTiers] = useState(data.tierPriority);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const locked = !data.isAdmin;

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await callResolver('saveRuleSettings', {
      rules: { ...rules, blockedStatusNames: blocked.split(',').map((s) => s.trim()).filter(Boolean) },
      tierPriority: tiers,
    });
    setBusy(false);
    if (res.ok) { setMsg({ ok: true, text: 'Saved. Risk signals use the new values from the next refresh.' }); onSaved(); }
    else setMsg({ ok: false, text: res.message });
  }

  return (
    <section className="card section" aria-labelledby="rules-h">
      <h2 id="rules-h">Risk rules</h2>
      <p className="muted small">{locked ? 'Only Jira admins can change these. Current values:' : 'Thresholds the nine rules use. Changes apply to every commitment.'}</p>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="field-row">
          {RULE_FIELDS.map((f) => (
            <Field key={f.key} label={`${f.label} (${f.unit})`}>
              <input className="input" type="number" min={f.min} max={365} step={1} required disabled={locked}
                value={rules[f.key]} onChange={(e) => setRules({ ...rules, [f.key]: Number(e.target.value) })} />
            </Field>
          ))}
        </div>
        <Field label="Jira statuses that count as blocked" hint="Comma separated, matched by name.">
          <input className="input" disabled={locked} value={blocked} onChange={(e) => setBlocked(e.target.value)} />
        </Field>
        <div className="field-row">
          {TIERS.map((t) => (
            <Field key={t} label={`Priority for ${t} accounts`}>
              <select className="input" disabled={locked} value={tiers[t]} onChange={(e) => setTiers({ ...tiers, [t]: e.target.value as Priority })}>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
              </select>
            </Field>
          ))}
        </div>
        {msg && <p className={msg.ok ? 'muted small' : 'error-text'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
        {!locked && <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save rules'}</button></div>}
      </form>
      <details className="rules-text">
        <summary className="small">How each rule reads with these values</summary>
        <ul className="list">
          {(Object.keys(data.described) as RuleId[]).map((id) => (
            <li key={id} className="row small"><span className="rule-id">{id}</span><span className="row-main">{data.described[id]}</span></li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function DataCard({ data, siteHost, onChanged }: { data: SettingsData; siteHost?: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const confirmWord = siteHost ?? 'DELETE';

  async function run(name: 'seedDemoData' | 'resetDemoData' | 'exportData') {
    setBusy(name);
    setMsg(null);
    const res = await callResolver<unknown>(name);
    setBusy(null);
    if (!res.ok) { setMsg({ ok: false, text: res.message }); return; }
    if (name === 'exportData') {
      const json = JSON.stringify(res.data, null, 2);
      setExported(json);
      try {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `tally-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch { /* the iframe may block downloads; the text box below still has it */ }
      setMsg({ ok: true, text: 'Export ready. If the download did not start, copy the JSON below.' });
      return;
    }
    setDeleting(false);
    setTyped('');
    setMsg({ ok: true, text: name === 'seedDemoData' ? 'Demo data loaded.' : 'All Tally data on this site was deleted.' });
    onChanged();
  }

  if (!data.isAdmin) {
    return (
      <section className="card section" aria-labelledby="data-h">
        <h2 id="data-h">Data</h2>
        <p className="muted small">Tally stores its records inside Atlassian (Forge storage) on this site. Jira admins can export or delete them here.</p>
      </section>
    );
  }

  return (
    <section className="card section" aria-labelledby="data-h">
      <h2 id="data-h">Data</h2>
      <p className="muted small">Tally stores commitments, quotes, history and updates inside Atlassian (Forge storage) on this site. Nothing leaves Atlassian.</p>
      <div className="actions">
        <button className="btn" disabled={!!busy} onClick={() => run('exportData')}>{busy === 'exportData' ? 'Exporting…' : 'Export all as JSON'}</button>
        {data.empty && <button className="btn btn-primary" disabled={!!busy} onClick={() => run('seedDemoData')}>{busy === 'seedDemoData' ? 'Loading…' : 'Load demo data'}</button>}
        {!data.empty && !deleting && <button className="btn btn-danger-quiet" onClick={() => setDeleting(true)}>Delete all data</button>}
      </div>
      {deleting && (
        <form className="form danger-zone" onSubmit={(e) => { e.preventDefault(); if (typed.trim() === confirmWord) void run('resetDemoData'); }}>
          <Field label={`Type ${confirmWord} to delete every Tally record on this site`} hint="This cannot be undone. Export first if you need a copy.">
            <input className="input" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => { setDeleting(false); setTyped(''); }}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={typed.trim() !== confirmWord || !!busy}>{busy === 'resetDemoData' ? 'Deleting…' : 'Delete everything'}</button>
          </div>
        </form>
      )}
      {msg && <p className={msg.ok ? 'muted small' : 'error-text'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      {exported && (
        <Field label="Export (JSON)">
          <textarea className="input mono" rows={8} readOnly value={exported} onFocus={(e) => e.currentTarget.select()} />
        </Field>
      )}
    </section>
  );
}
