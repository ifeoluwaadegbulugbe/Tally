import type { Commitment, IssueSnapshot } from '../src/core';

export const NOW = new Date('2026-11-10T12:00:00Z');
export const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
export const daysAgo = (d: number) => hoursAgo(d * 24);

export function cmt(o: Partial<Commitment> = {}): Commitment {
  return {
    id: 'c1',
    accountId: 'a1',
    title: 'Support SSO before rollout',
    status: 'assigned',
    ownerAccountId: 'u1',
    dueDate: '2026-12-05',
    dueDateSource: 'stated',
    confirmedDueDate: '2026-12-05',
    priority: 'high',
    priorityOverridden: false,
    issueKeys: [],
    version: 1,
    createdAt: daysAgo(5),
    updatedAt: daysAgo(1),
    createdBy: 'u0',
    confirmedAt: daysAgo(5),
    assignedAt: hoursAgo(12),
    ...o,
  };
}

export function issue(o: Partial<IssueSnapshot> & Pick<IssueSnapshot, 'key'>): IssueSnapshot {
  return {
    statusName: 'In Progress',
    statusCategory: 'in_progress',
    flagged: false,
    dueDate: null,
    updated: hoursAgo(2),
    accessible: true,
    ...o,
  };
}
