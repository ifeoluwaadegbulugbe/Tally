// Tally shell: left rail, top bar and routing (F shell). Routes:
//   /                       Dashboard (F1)
//   /accounts               Accounts (F2)
//   /commitments            Commitments (F4), ?view=mine|unassigned|at_risk|overdue&account=<id>
//   /commitments/<id>       Commitment detail (F5)
//   /updates[/<id>]         Customer updates (F-40, F-41), ?account=<id> to start a draft
//   /inbox, /risks, /updates  Discovery inbox (F6), Risks (F7), Customer updates (F-40, F-41)
//   /settings               Settings (F10)
import { Link } from './components';
import { useRoute } from './router';
import type { Route } from './router';
import { AccountsScreen } from './screens/Accounts';
import { CommitmentDetailScreen } from './screens/CommitmentDetail';
import { CommitmentsScreen } from './screens/Commitments';
import { DashboardScreen } from './screens/Dashboard';
import { InboxScreen } from './screens/Inbox';
import { RisksScreen } from './screens/Risks';
import { SettingsScreen } from './screens/Settings';
import { UpdatesScreen } from './screens/Updates';
import { useResolver } from './useResolver';

const NAV: Array<{ label: string; to: string }> = [
  { label: 'Dashboard', to: '/' },
  { label: 'Inbox', to: '/inbox' },
  { label: 'Accounts', to: '/accounts' },
  { label: 'Commitments', to: '/commitments' },
  { label: 'Risks', to: '/risks' },
  { label: 'Updates', to: '/updates' },
  { label: 'Settings', to: '/settings' },
];

function TallyMark() {
  // Four strokes and a diagonal: the tally-mark glyph from the design spec (G).
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round">
        <line x1="5" y1="4" x2="5" y2="20" />
        <line x1="10" y1="4" x2="10" y2="20" />
        <line x1="15" y1="4" x2="15" y2="20" />
        <line x1="20" y1="4" x2="20" y2="20" />
        <line x1="2" y1="17" x2="23" y2="7" />
      </g>
    </svg>
  );
}

function section(route: Route): string {
  return route.segments[0] ?? '';
}

function Screen({ route, me, onInboxChange }: { route: Route; me: string | undefined; onInboxChange: () => void }) {
  const [first, second] = route.segments;
  if (first === 'inbox') return <InboxScreen me={me} onCountChange={onInboxChange} />;
  if (first === 'risks') return <RisksScreen me={me} />;
  if (first === 'accounts') return <AccountsScreen />;
  if (first === 'settings') return <SettingsScreen />;
  if (first === 'updates') return <UpdatesScreen route={route} me={me} />;
  if (first === 'commitments' && second) return <CommitmentDetailScreen key={second} id={second} me={me} />;
  if (first === 'commitments') return <CommitmentsScreen route={route} me={me} />;
  return <DashboardScreen me={me} />;
}

const TITLES: Record<string, string> = { '': 'Dashboard', inbox: 'Discovery inbox', risks: 'Risks', accounts: 'Accounts', commitments: 'Commitments', updates: 'Customer updates', settings: 'Settings' };

export function App() {
  const route = useRoute();
  const { data: who } = useResolver<{ accountId: string }>('whoAmI');
  const me = who?.accountId;
  const inbox = useResolver<{ unreviewed: number }>('inboxCount');
  const current = route ? section(route) : '';
  const isDetail = route?.segments[0] === 'commitments' && !!route.segments[1];

  return (
    <div className="shell">
      <nav className="rail" aria-label="Tally">
        <div className="brand">
          <TallyMark /> <span>Tally</span>
        </div>
        {NAV.map((n) => {
          const active = n.to === '/' ? current === '' : current === n.to.slice(1);
          return (
            <Link key={n.label} to={n.to} className={`nav ${active ? 'active' : ''}`} current={active}>
              <span>{n.label}</span>
              {n.label === 'Inbox' && !!inbox.data?.unreviewed && <span className="nav-count" aria-label={`${inbox.data.unreviewed} to review`}>{inbox.data.unreviewed}</span>}
            </Link>
          );
        })}
      </nav>
      <main className="content">
        {!isDetail && (
          <header className="topbar">
            <h1>{TITLES[current] ?? 'Tally'}</h1>
          </header>
        )}
        {route ? <Screen route={route} me={me} onInboxChange={inbox.refetch} /> : <div className="card skeleton" />}
      </main>
    </div>
  );
}
