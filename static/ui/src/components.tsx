// Shared UI pieces: chips, banners, states, dialog, fields, links.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Health, Status } from '../../../src/core/types';
import { DEMO_USERS } from '../../../src/core/demo';
import { router } from '@forge/bridge';
import { navigate } from './router';

export const HEALTH: Record<Health, { label: string; icon: string }> = {
  on_track: { label: 'On track', icon: '✓' },
  watch: { label: 'Watch', icon: '◷' },
  at_risk: { label: 'At risk', icon: '⚠' },
  critical: { label: 'Critical', icon: '!' },
};

export const STATUS_LABEL: Record<Status, string> = {
  confirmed: 'Confirmed',
  assigned: 'Assigned',
  in_delivery: 'In delivery',
  delivered: 'Delivered',
  communicated: 'Communicated',
  renegotiated: 'Renegotiated',
  cancelled: 'Cancelled',
};

export function HealthChip({ health }: { health: Health }) {
  const h = HEALTH[health];
  return (
    <span className={`chip chip-${health}`}>
      <span aria-hidden="true">{h.icon}</span> {h.label}
    </span>
  );
}

export function StatusChip({ status, health }: { status: Status; health?: Health | null }) {
  if (status === 'delivered' || status === 'communicated') {
    return <span className="chip chip-delivered"><span aria-hidden="true">✓✓</span> {STATUS_LABEL[status]}</span>;
  }
  if (status === 'cancelled') {
    return <span className="chip chip-cancelled"><span aria-hidden="true">⊘</span> Cancelled</span>;
  }
  return health ? <HealthChip health={health} /> : <span className="chip">{STATUS_LABEL[status]}</span>;
}

// Display names from Jira, merged as screens receive them (resolvers return a `users` map).
const knownUsers: Record<string, string> = {};
export function rememberUsers(map: Record<string, string> | undefined): void {
  if (map) Object.assign(knownUsers, map);
}

export function ownerName(id: string | null, me?: string): string {
  if (!id) return 'Unassigned';
  if (id === me) return 'You';
  if (id === 'tally-system') return 'Tally (from Jira)';
  return knownUsers[id] ?? DEMO_USERS[id] ?? 'Jira user';
}

/** Opens a Jira issue in a new tab (relative to the site, via the Forge bridge). */
export function IssueKey({ issueKey }: { issueKey: string }) {
  return (
    <a
      href={`/browse/${issueKey}`}
      className="key-chip key-link"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void router.open(`/browse/${issueKey}`);
      }}
    >
      {issueKey}
    </a>
  );
}

/** Non-blocking notice when Jira could not be reached; data shown is the last known state. */
export function JiraNotice({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div className="banner banner-warn" role="status">
      <span>Live Jira status unavailable ({message}). Showing the last known state.</span>
    </div>
  );
}

/**
 * Calendar dates (YYYY-MM-DD, e.g. due dates) are shown as written, in UTC so they never
 * shift a day. Full timestamps (e.g. capturedAt) are moments, shown in the viewer's time zone.
 */
export function formatDate(iso: string | null | undefined, withYear = false): string {
  if (!iso) return 'No date';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) };
  if (iso.length <= 10) return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
  return new Date(iso).toLocaleDateString(undefined, opts);
}

export function formatWhen(ts: string): string {
  return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** In-app link: navigates through the Jira-synced history. */
export function Link({ to, children, className, current }: { to: string; children: ReactNode; className?: string; current?: boolean }) {
  return (
    <a
      href={to}
      className={className ?? 'link'}
      aria-current={current ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function ErrorBanner({ call, message, onRetry }: { call?: string; message: string; onRetry?: () => void }) {
  return (
    <div className="banner" role="alert">
      <span>{call ? `${call}: ` : ''}{message}</span>
      {onRetry && <button className="btn" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="row skeleton-row" />)}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card empty">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog: focus moves to the first field, Tab stays inside, Escape or a click on the
 * backdrop closes it, and focus returns to the control that opened it.
 */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={ref}>
        <h2 id="dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

/** "Open source" link for evidence and candidates; text pasted into Rovo chat has no web source. */
export function SourceLink({ url }: { url: string }) {
  if (!/^https?:\/\//i.test(url)) return <span className="muted">Pasted into Rovo chat</span>;
  return <a className="link" href={url} target="_blank" rel="noreferrer noopener">Open source</a>;
}
