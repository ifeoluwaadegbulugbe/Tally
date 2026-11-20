// Commitment lifecycle (blueprint section C). Pure functions, no I/O.
// Jira state is read by status category, never by status name.
import type { Commitment, IssueSnapshot, Status } from './types';
import { isOpen } from './types';

export interface TransitionInput {
  reason?: string;
  /** New due date, required for renegotiation. */
  newDueDate?: string | null;
  /** Live snapshots of linked issues, required for system transitions. */
  issues?: IssueSnapshot[];
  /** True when an update covering this commitment was approved and marked sent. */
  hasSentUpdate?: boolean;
  customerInformed?: boolean;
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

const yes: TransitionCheck = { ok: true };
const no = (reason: string): TransitionCheck => ({ ok: false, reason });

function linked(c: Commitment, issues: IssueSnapshot[] = []): IssueSnapshot[] {
  return issues.filter((i) => c.issueKeys.includes(i.key) && i.accessible !== false);
}

/** Progress states a commitment can move between as owner and Jira state change. */
const PROGRESS: readonly Status[] = ['confirmed', 'assigned', 'in_delivery', 'delivered', 'renegotiated'];

export function canTransition(from: Status, to: Status, c: Commitment, input: TransitionInput = {}): TransitionCheck {
  if (from === to) return no(`Already ${to}.`);
  const reason = input.reason?.trim();

  switch (to) {
    case 'cancelled':
      if (!isOpen(from)) return no(`A ${from} commitment cannot be cancelled.`);
      if (!reason) return no('A reason is required to cancel.');
      return yes;

    case 'renegotiated':
      if (!isOpen(from)) return no(`A ${from} commitment cannot be renegotiated.`);
      if (!reason) return no('A reason is required to renegotiate.');
      if (!input.newDueDate) return no('A new due date is required to renegotiate.');
      return yes;

    case 'communicated':
      if (from !== 'delivered') return no('Only a delivered commitment can be marked communicated.');
      if (!input.hasSentUpdate) return no('An approved customer update must be marked sent first.');
      return yes;

    case 'assigned':
      if (!PROGRESS.includes(from) || from === 'delivered') return no(`Cannot assign a ${from} commitment.`);
      if (!c.ownerAccountId) return no('Set an owner first.');
      return yes;

    case 'in_delivery': {
      if (!PROGRESS.includes(from)) return no(`Cannot start delivery on a ${from} commitment.`);
      if (!c.ownerAccountId) return no('Set an owner first.');
      const issues = linked(c, input.issues);
      if (!issues.some((i) => i.statusCategory !== 'todo')) {
        return no('At least one linked Jira issue must be past To Do.');
      }
      return yes;
    }

    case 'delivered': {
      if (!PROGRESS.includes(from) || from === 'confirmed') return no(`Cannot deliver a ${from} commitment.`);
      if (c.issueKeys.length === 0) return no('Link the Jira work that delivers this promise first.');
      const issues = linked(c, input.issues);
      if (issues.length < c.issueKeys.length) return no('Some linked issues could not be read.');
      if (!issues.every((i) => i.statusCategory === 'done')) return no('All linked Jira issues must be Done.');
      return yes;
    }

    case 'confirmed':
      return no('Commitments are confirmed from the discovery inbox, not by transition.');
  }
}

/**
 * The status the system should move a commitment to, given its owner and the live
 * state of its linked issues, or null if nothing changes. Only system-driven moves:
 * assigned -> in_delivery -> delivered, and delivered -> in_delivery if work reopens.
 * Cancelled and communicated are terminal and never changed by the system.
 */
export function deriveSystemStatus(c: Commitment, issues: IssueSnapshot[]): Status | null {
  if (c.status === 'cancelled' || c.status === 'communicated') return null;
  if (!c.ownerAccountId) return null;

  const live = linked(c, issues);
  const allRead = live.length === c.issueKeys.length && live.length > 0;
  const allDone = allRead && live.every((i) => i.statusCategory === 'done');
  const started = live.some((i) => i.statusCategory !== 'todo');

  let target: Status = c.status === 'confirmed' ? 'assigned' : c.status;
  if (allDone) target = 'delivered';
  else if (c.status === 'delivered' && live.some((i) => i.statusCategory !== 'done')) target = 'in_delivery';
  else if (started && (target === 'assigned' || target === 'renegotiated')) target = 'in_delivery';

  return target === c.status ? null : target;
}
