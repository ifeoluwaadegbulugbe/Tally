// Demo data (blueprint section P), built relative to `now` so the demo always shows
// the intended states. Fictional companies and people only. Issue keys assume a Jira
// project DEMO and a Confluence space CS created on the demo site; the storage seed
// replaces these snapshots with live Jira data once the issues exist.
import { addDays, toISODate } from './dates';
import type { Account, Commitment, Evidence, IssueSnapshot } from './types';

export const DEMO_USERS: Record<string, string> = {
  'demo-dana': 'Dana',
  'demo-sam': 'Sam',
  'demo-priya': 'Priya',
  'demo-lee': 'Lee',
  'demo-marco': 'Marco',
};

export interface DemoData {
  accounts: Account[];
  commitments: Commitment[];
  evidence: Evidence[];
  issues: IssueSnapshot[];
  /** Raw source text for the discovery inbox demo: one per class. */
  candidateSources: Array<{ accountId: string; sourceUrl: string; text: string }>;
}

export function buildDemoData(now: Date, siteUrl = 'https://example.atlassian.net'): DemoData {
  const today = toISODate(now);
  const d = (n: number) => addDays(today, n);
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const page = (title: string) => `${siteUrl}/wiki/spaces/CS/pages/${encodeURIComponent(title)}`;
  const issue = (key: string) => `${siteUrl}/browse/${key}`;

  const accounts: Account[] = [
    { id: 'acct-acme', name: 'Acme Retail', tier: 'enterprise', renewalDate: d(80), jiraProjectKey: 'DEMO', confluenceSpaceKey: 'CS' },
    { id: 'acct-northwind', name: 'Northwind Health', tier: 'enterprise', renewalDate: d(45), jiraProjectKey: 'DEMO', confluenceSpaceKey: 'CS' },
    { id: 'acct-brightfield', name: 'Brightfield Labs', tier: 'growth', renewalDate: d(150), jiraProjectKey: 'DEMO', confluenceSpaceKey: 'CS' },
  ];

  const base = (
    id: string,
    accountId: string,
    title: string,
    o: Partial<Commitment> & Pick<Commitment, 'status'>,
  ): Commitment => ({
    id,
    accountId,
    title,
    ownerAccountId: null,
    dueDate: null,
    dueDateSource: 'stated',
    confirmedDueDate: o.dueDate ?? null,
    priority: accountId === 'acct-brightfield' ? 'normal' : 'high',
    priorityOverridden: false,
    issueKeys: [],
    version: 1,
    createdAt: ago(10),
    updatedAt: ago(1),
    createdBy: 'demo-dana',
    confirmedAt: ago(10),
    assignedAt: o.ownerAccountId ? ago(8) : null,
    ...o,
  });

  const commitments: Commitment[] = [
    // Acme Retail
    base('c-acme-sso', 'acct-acme', 'Support SSO before their rollout', {
      status: 'confirmed', dueDate: d(5), confirmedAt: ago(2), createdAt: ago(2), updatedAt: ago(2),
    }), // R3 no owner
    base('c-acme-migration', 'acct-acme', 'Send migration plan by Friday', {
      status: 'delivered', ownerAccountId: 'demo-dana', dueDate: d(-6), issueKeys: ['DEMO-11'], updatedAt: ago(7),
    }),
    base('c-acme-onboarding', 'acct-acme', 'Provide onboarding for 20 users', {
      status: 'in_delivery', ownerAccountId: 'demo-sam', dueDate: d(3), issueKeys: ['DEMO-14'],
    }), // R2 due soon
    base('c-acme-security', 'acct-acme', 'Share completed security questionnaire', {
      status: 'in_delivery', ownerAccountId: 'demo-lee', dueDate: d(20), issueKeys: ['DEMO-16'], dueDateSource: 'estimated',
    }), // R8 no evidence
    // Northwind Health
    base('c-nw-ehr', 'acct-northwind', 'Custom EHR integration before renewal', {
      status: 'in_delivery', ownerAccountId: 'demo-priya', dueDate: d(18), issueKeys: ['DEMO-21'],
    }), // R5 blocked + R6 date mismatch
    base('c-nw-export', 'acct-northwind', 'Fix reporting export bug', {
      status: 'assigned', ownerAccountId: 'demo-priya', dueDate: d(-14), issueKeys: ['DEMO-19'], createdAt: ago(30), confirmedAt: ago(30),
    }), // R1 overdue + R9 stale
    base('c-nw-qbr', 'acct-northwind', 'Quarterly business review deck', {
      status: 'in_delivery', ownerAccountId: 'demo-lee', dueDate: d(32), issueKeys: ['DEMO-25'],
    }), // on track
    // Brightfield Labs
    base('c-bf-audit', 'acct-brightfield', 'Add audit log export', {
      status: 'delivered', ownerAccountId: 'demo-marco', dueDate: d(-2), issueKeys: ['DEMO-30'], updatedAt: ago(3),
    }),
    base('c-bf-residency', 'acct-brightfield', 'Provide data residency letter', {
      status: 'assigned', ownerAccountId: 'demo-dana', dueDate: d(40), assignedAt: ago(4),
    }), // R4 no delivery work
    base('c-bf-training', 'acct-brightfield', 'Training session for admins', {
      status: 'in_delivery', ownerAccountId: 'demo-sam', dueDate: d(29), confirmedDueDate: d(22), issueKeys: ['DEMO-33'],
    }), // R7 date moved + R6 date mismatch
  ];

  const ev = (cmtId: string, n: number, sourceType: Evidence['sourceType'], sourceUrl: string, quote: string): Evidence => ({
    id: `${cmtId}:${n}`, commitmentId: cmtId, sourceType, sourceUrl, quote, capturedAt: ago(9),
  });

  const evidence: Evidence[] = [
    ev('c-acme-sso', 1, 'confluence', page('Acme account plan'), 'We will deliver SSO for Acme before their rollout.'),
    ev('c-acme-migration', 1, 'jira', issue('DEMO-4'), "We'll send Acme the migration plan by Friday."),
    ev('c-acme-onboarding', 1, 'confluence', page('Acme call notes'), 'We will run onboarding for 20 Acme users next week.'),
    ev('c-nw-ehr', 1, 'jira', issue('DEMO-21'), 'We committed to the custom EHR integration for Northwind before renewal.'),
    ev('c-nw-export', 1, 'confluence', page('Northwind escalation'), 'We promised Northwind a fix for the reporting export.'),
    ev('c-nw-qbr', 1, 'confluence', page('Northwind QBR plan'), 'We will prepare the quarterly business review deck for Northwind.'),
    ev('c-bf-audit', 1, 'jira', issue('DEMO-30'), "We'll add audit log export for Brightfield."),
    ev('c-bf-residency', 1, 'confluence', page('Brightfield data residency'), 'We will provide Brightfield a data residency letter.'),
    ev('c-bf-training', 1, 'jira', issue('DEMO-33'), 'We will run a training session for Brightfield admins.'),
  ];

  const snap = (key: string, summary: string, statusName: string, statusCategory: IssueSnapshot['statusCategory'], o: Partial<IssueSnapshot> = {}): IssueSnapshot => ({
    key, summary, statusName, statusCategory, flagged: false, dueDate: null, updated: ago(1), accessible: true, source: 'demo', ...o,
  });

  const issues: IssueSnapshot[] = [
    snap('DEMO-11', 'Acme migration plan', 'Done', 'done', { updated: ago(7) }),
    snap('DEMO-14', 'Acme onboarding sessions', 'In Progress', 'in_progress', { dueDate: d(3) }),
    snap('DEMO-16', 'Acme security questionnaire', 'In Progress', 'in_progress', { dueDate: d(15) }),
    snap('DEMO-19', 'Northwind reporting export bug', 'To Do', 'todo', { updated: ago(10) }),
    snap('DEMO-21', 'Northwind EHR integration', 'In Progress', 'in_progress', { flagged: true, dueDate: d(25) }),
    snap('DEMO-25', 'Northwind QBR deck', 'In Progress', 'in_progress', { dueDate: d(30) }),
    snap('DEMO-30', 'Brightfield audit log export', 'Done', 'done', { updated: ago(3) }),
    snap('DEMO-33', 'Brightfield admin training', 'In Progress', 'in_progress', { dueDate: d(36) }),
  ];

  const candidateSources = [
    { accountId: 'acct-acme', sourceUrl: page('Acme call notes'), text: 'Priya said we will have the audit log ready for Acme by 12 Dec.' },
    { accountId: 'acct-northwind', sourceUrl: issue('DEMO-21'), text: 'We will deliver the HL7 mapping document to Northwind before 1 Dec.' },
    { accountId: 'acct-acme', sourceUrl: page('Acme account plan'), text: 'We should get the migration plan to them soon.' },
    { accountId: 'acct-brightfield', sourceUrl: page('Brightfield ideas'), text: 'Maybe we could offer a custom integration for Brightfield.' },
    { accountId: 'acct-acme', sourceUrl: page('Acme rollout'), text: 'SSO before rollout.' },
  ];

  return { accounts, commitments, evidence, issues, candidateSources };
}
