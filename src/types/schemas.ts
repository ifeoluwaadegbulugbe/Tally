// Shared Zod schemas: the single validation definition used by resolvers,
// Rovo actions, MCP tools and the UI forms (blueprint H1, H4, J).
import { z } from 'zod';

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Not a real date');

export const isoTimestamp = z.string().datetime();

export const HealthSchema = z.enum(['on_track', 'watch', 'at_risk', 'critical']);
export const StatusSchema = z.enum([
  'confirmed',
  'assigned',
  'in_delivery',
  'delivered',
  'communicated',
  'renegotiated',
  'cancelled',
]);
export const CandidateClassSchema = z.enum(['confirmed', 'possible', 'suggestion', 'ambiguous']);
export const TierSchema = z.enum(['enterprise', 'growth', 'standard']);
export const PrioritySchema = z.enum(['critical', 'high', 'normal']);
export const DueDateSourceSchema = z.enum(['stated', 'estimated', 'unknown']);
export const SourceTypeSchema = z.enum(['jira', 'confluence', 'manual']);
export const RuleIdSchema = z.enum(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9']);

export const AccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  tier: TierSchema,
  renewalDate: isoDate.nullable(),
  jiraProjectKey: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
  confluenceSpaceKey: z.string().min(1).optional(),
});

export const CommitmentSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  title: z.string().trim().min(1).max(300),
  status: StatusSchema,
  ownerAccountId: z.string().min(1).nullable(),
  dueDate: isoDate.nullable(),
  dueDateSource: DueDateSourceSchema,
  /** Due date at the moment of confirmation; used by R7 (date moved). */
  confirmedDueDate: isoDate.nullable(),
  priority: PrioritySchema,
  priorityOverridden: z.boolean().default(false),
  issueKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+-\d+$/)),
  version: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  createdBy: z.string().min(1),
  confirmedAt: isoTimestamp,
  /** When an owner was first set; used by R4. */
  assignedAt: isoTimestamp.nullable(),
});

/** Input for manually logging a commitment (F-01). */
export const NewCommitmentInputSchema = z.object({
  accountId: z.string().min(1),
  title: z.string().trim().min(1).max(300),
  ownerAccountId: z.string().min(1).nullable().default(null),
  dueDate: isoDate.nullable().default(null),
  dueDateSource: DueDateSourceSchema.default('unknown'),
  evidence: z
    .object({ sourceType: SourceTypeSchema, sourceUrl: z.string().url(), quote: z.string().min(1) })
    .optional(),
});

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  commitmentId: z.string().min(1),
  sourceType: SourceTypeSchema,
  sourceUrl: z.string().url(),
  quote: z.string().max(300),
  capturedAt: isoTimestamp,
  author: z.string().optional(),
});

export const RiskSignalSchema = z.object({
  id: z.string(),
  commitmentId: z.string(),
  rule: RuleIdSchema,
  severity: z.number().int().min(1).max(5),
  reason: z.string(),
  inputs: z.record(z.string(), z.unknown()),
  evaluatedAt: isoTimestamp,
  acknowledgedUntil: isoTimestamp.optional(),
  acknowledgedReason: z.string().optional(),
  acknowledgedBy: z.string().optional(),
});

export const IssueSnapshotSchema = z.object({
  key: z.string(),
  /** Jira's numeric issue id; the Teamwork Graph identifies issues by it (T14). */
  id: z.string().optional(),
  summary: z.string().optional(),
  statusName: z.string(),
  statusCategory: z.enum(['todo', 'in_progress', 'done']),
  flagged: z.boolean(),
  dueDate: isoDate.nullable(),
  updated: isoTimestamp,
  assigneeAccountId: z.string().nullable().optional(),
  /** false when Jira returned 403/404 for the viewing user. */
  accessible: z.boolean().default(true),
  /** 'demo' for seeded snapshots of issues that may not exist on the site. */
  source: z.enum(['jira', 'demo']).optional(),
});

export const RuleConfigSchema = z.object({
  dueSoonDays: z.number().int().min(0).default(3),
  noOwnerHours: z.number().int().min(1).default(24),
  noDeliveryWorkDays: z.number().int().min(1).default(3),
  staleDays: z.number().int().min(1).default(7),
  blockedStatusNames: z.array(z.string()).default(['Blocked', 'On Hold', 'Impeded']),
});

/** A possible promise found in a source, waiting for a human (section D, F-03..F-13). */
export const CandidateSchema = z.object({
  id: z.string(), // candidateKey(sourceUrl, quote): re-scans never re-add the same snippet
  accountId: z.string().nullable(),
  sourceType: z.enum(['jira', 'confluence', 'agent', 'manual']),
  sourceUrl: z.string().url(),
  sourceTitle: z.string(),
  quote: z.string().max(300),
  suggestedClass: CandidateClassSchema,
  /** Who suggested the class: the deterministic pre-filter or the Rovo agent (T12). */
  suggestedBy: z.enum(['rules', 'agent']),
  reason: z.string(),
  dueDate: isoDate.nullable(),
  duplicateOf: z.array(z.object({ id: z.string(), score: z.number() })),
  reviewState: z.enum(['unreviewed', 'confirmed', 'rejected', 'ambiguous']),
  createdAt: isoTimestamp,
  reviewedBy: z.string().optional(),
  reviewedAt: isoTimestamp.optional(),
  rejectReason: z.string().optional(),
  commitmentId: z.string().optional(),
});

// Resolver / action / MCP envelope (H4).
export const ErrorCodeSchema = z.enum([
  'validation',
  'not_found',
  'conflict',
  'forbidden',
  'upstream',
  'internal',
]);
