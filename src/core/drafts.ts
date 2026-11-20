// Customer update drafter (F-40). Deterministic template built from stored fields only.
// The draft lists the commitment IDs it used; the agent may reword tone, never facts.
// Internal detail (Jira keys, rule reasons, owners) never appears in customer-facing text.
import { formatDay } from './dates';
import { healthOf } from './risk';
import type { Account, Commitment, RiskSignal } from './types';

export interface Draft {
  body: string;
  used: string[];
}

/**
 * A stored customer update (F-40, F-41): draft -> approved -> sent. Tally never sends it;
 * "sent" records that a person sent it themselves, with who and when. usedVersions pins the
 * commitment versions the draft was built from, so approval is refused if the facts moved.
 */
export interface UpdateDraft {
  id: string;
  accountId: string;
  commitmentIds: string[];
  usedVersions: Record<string, number>;
  body: string;
  status: 'draft' | 'approved' | 'sent';
  source: 'ui' | 'agent';
  version: number;
  createdBy: string;
  createdAt: string;
  editedBy?: string;
  editedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  sentBy?: string;
  sentAt?: string;
}

export const DRAFT_MAX_BODY = 5000;

function line(c: Commitment, signals: RiskSignal[], now: Date): string {
  const due = c.dueDate ? formatDay(c.dueDate, now) : null;
  const health = healthOf(signals.filter((s) => s.commitmentId === c.id), now);
  switch (c.status) {
    case 'delivered':
    case 'communicated':
      return `${c.title}: delivered.`;
    case 'renegotiated':
      return due ? `${c.title}: new target date ${due}.` : `${c.title}: we are agreeing a new date with you.`;
    default:
      if (!due) return `${c.title}: in progress; we will confirm a date.`;
      if (health === 'critical' || health === 'at_risk') {
        return `${c.title}: in progress; we are reviewing the ${due} date and will update you shortly.`;
      }
      return `${c.title}: in progress, on track for ${due}.`;
  }
}

export function draftUpdate(
  account: Pick<Account, 'id' | 'name'>,
  items: Commitment[],
  signals: RiskSignal[],
  now: Date,
): Draft {
  const mine = items.filter((c) => c.accountId === account.id && c.status !== 'cancelled');
  const order = { delivered: 0, communicated: 0, in_delivery: 1, assigned: 1, confirmed: 1, renegotiated: 2, cancelled: 3 };
  const sorted = [...mine].sort(
    (a, b) => order[a.status] - order[b.status] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
  );

  if (sorted.length === 0) {
    return { body: '', used: [] };
  }

  const body = [
    `Hello ${account.name} team,`,
    '',
    'Here is where we are on what we committed to:',
    '',
    ...sorted.map((c) => `- ${line(c, signals, now)}`),
    '',
    'Reply to this message if anything here does not match your understanding.',
  ].join('\n');

  return { body, used: sorted.map((c) => c.id) };
}
