import type { z } from 'zod';
import type {
  AccountSchema,
  CandidateClassSchema,
  CommitmentSchema,
  ErrorCodeSchema,
  EvidenceSchema,
  HealthSchema,
  IssueSnapshotSchema,
  PrioritySchema,
  RiskSignalSchema,
  RuleConfigSchema,
  RuleIdSchema,
  StatusSchema,
  TierSchema,
} from '../types/schemas';

export type Health = z.infer<typeof HealthSchema>;
export type Status = z.infer<typeof StatusSchema>;
export type CandidateClass = z.infer<typeof CandidateClassSchema>;
export type Tier = z.infer<typeof TierSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type RuleId = z.infer<typeof RuleIdSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type Commitment = z.infer<typeof CommitmentSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type RiskSignal = z.infer<typeof RiskSignalSchema>;
export type IssueSnapshot = z.input<typeof IssueSnapshotSchema>;
export type RuleConfig = z.infer<typeof RuleConfigSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export type Result<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = <T = never>(code: ErrorCode, message: string): Result<T> => ({
  ok: false,
  code,
  message,
});

/** Statuses where the promise is still owed to the customer. */
export const OPEN_STATUSES: readonly Status[] = ['confirmed', 'assigned', 'in_delivery', 'renegotiated'];
export const isOpen = (s: Status): boolean => OPEN_STATUSES.includes(s);

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  dueSoonDays: 3,
  noOwnerHours: 24,
  noDeliveryWorkDays: 3,
  staleDays: 7,
  blockedStatusNames: ['Blocked', 'On Hold', 'Impeded'],
};
