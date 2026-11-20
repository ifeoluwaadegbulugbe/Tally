// Discovery: deterministic pre-filter, class suggestion, date extraction,
// duplicate detection and quote hygiene (blueprint section D, H9).
// The Rovo agent may suggest a different class; a human always sets the final one.
import { toISODate } from './dates';
import type { CandidateClass, Commitment } from './types';

export const MAX_QUOTE = 300;

// ---------- Quote hygiene ----------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Mask email addresses: "dana@acme.com" -> "d***@acme.com". */
export function maskEmails(text: string): string {
  return text.replace(EMAIL, (m) => {
    const [user, domain] = m.split('@') as [string, string];
    return `${user[0]}***@${domain}`;
  });
}

/** Collapse whitespace, mask emails, and truncate at a sentence boundary within MAX_QUOTE. */
export function cleanQuote(text: string, max = MAX_QUOTE): string {
  const t = maskEmails(text.replace(/\s+/g, ' ').trim());
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  if (end > 40) return cut.slice(0, end + 1);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 0 ? space : max - 1)}…`;
}

/** Split plain text into sentences of at most MAX_QUOTE characters. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
    .map((s) => cleanQuote(s));
}

// ---------- Cue patterns ----------

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)';

const FIRM = /\b(?:will|shall|we'll|i'll|we’ll|i’ll|we'd|we’d|committed to|commit to|promised?|guarantee[ds]?|are going to|is going to)\b/i;
const TENTATIVE = /\b(?:should|aim to|plan to|planning to|hope to|try to|intend to|expect to)\b/i;
const HEDGE = /\b(?:maybe|perhaps|possibly|might|could|what if|how about|consider(?:ing)?|we may|an option|one option|idea)\b/i;
const DATEISH = `(?:\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}|${MONTH}\\s+\\d{1,2}|\\d{4}-\\d{2}-\\d{2}|${WEEKDAY}|next week|this week|tomorrow|q[1-4]|(?:the\\s+)?end of (?:the\\s+)?(?:week|month|quarter|year))`;
// "by"/"due" need a date-like word; "before" / "ahead of" / "no later than" accept an event
// ("before rollout"). "on <date>" alone is not a deadline ("We met Acme on Tuesday").
const DEADLINE = new RegExp(
  `\\b(?:(?:by|due)\\s+${DATEISH}|(?:before|ahead of|no later than)\\s+(?:${DATEISH}|(?:their|the|our|its)\\s+\\w+|\\w+))`,
  'i',
);
const EXPLICIT_DATE = new RegExp(`\\b(?:\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}|${MONTH}\\s+\\d{1,2}|\\d{4}-\\d{2}-\\d{2}|${WEEKDAY}|next week|end of (?:the\\s+)?(?:month|quarter|year)|q[1-4])\\b`, 'i');
const SPEAKER = /\b(?:we|we'll|we’ll|we'd|we’d|i|i'll|i’ll|our team|our|us|the team)\b/i;
const GENERIC_CUSTOMER = /\b(?:customer|customers|client|clients|them|their)\b/i;

export interface Cues {
  firm: boolean;
  tentative: boolean;
  hedge: boolean;
  deadline: boolean;
  explicitDate: boolean;
  speaker: boolean;
  customer: boolean;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectCues(sentence: string, accountNames: string[] = [], contextAccount = false): Cues {
  const namesRe = accountNames.length
    ? new RegExp(`\\b(?:${accountNames.map(escapeRe).join('|')})\\b`, 'i')
    : null;
  return {
    firm: FIRM.test(sentence),
    tentative: TENTATIVE.test(sentence),
    hedge: HEDGE.test(sentence),
    deadline: DEADLINE.test(sentence),
    explicitDate: EXPLICIT_DATE.test(sentence),
    speaker: SPEAKER.test(sentence),
    customer: contextAccount || GENERIC_CUSTOMER.test(sentence) || (namesRe?.test(sentence) ?? false),
  };
}

/**
 * Pre-filter: a sentence becomes a candidate only with a commitment cue AND a
 * customer reference. `contextAccount` is true when the source belongs to an
 * account (its Jira project or Confluence space), which counts as the reference.
 */
export function isCandidate(sentence: string, accountNames: string[] = [], contextAccount = false): boolean {
  const c = detectCues(sentence, accountNames, contextAccount);
  const commitmentCue = c.firm || c.deadline || ((c.tentative || c.hedge) && c.speaker);
  return commitmentCue && c.customer;
}

export interface ClassSuggestion {
  class: CandidateClass;
  reason: string;
}

/**
 * Deterministic class suggestion. Order: suggestion, ambiguous, confirmed, possible.
 * Never used to auto-confirm; it only pre-fills the badge in the inbox.
 */
export function suggestClass(sentence: string, accountNames: string[] = [], contextAccount = false): ClassSuggestion {
  const c = detectCues(sentence, accountNames, contextAccount);
  if (c.hedge && !c.firm) return { class: 'suggestion', reason: 'Hedged wording; reads as an idea, not a promise.' };
  if (!c.speaker) return { class: 'ambiguous', reason: 'Cannot tell who is promising.' };
  if (c.firm && c.explicitDate) return { class: 'confirmed', reason: 'Firm commitment with a stated date.' };
  if (c.firm) return { class: 'possible', reason: 'Firm wording but no clear date.' };
  return { class: 'possible', reason: 'Tentative wording; owner or date is vague.' };
}

// ---------- Date extraction ----------

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Extract an explicit calendar date ("5 Dec", "December 12", "2026-12-05").
 * Relative phrases ("by Friday", "soon") return null: the date must be in the text.
 * A day-month without a year resolves to the next occurrence, allowing 30 days in the past.
 */
export function extractDate(text: string, now: Date): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso && !Number.isNaN(Date.parse(`${iso[0]}T00:00:00Z`))) return iso[0];

  const dm = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\b(?:\\s+(\\d{4}))?`, 'i'));
  const md = text.match(new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i'));
  let day: number, month: number, year: number | undefined;
  if (dm) {
    day = Number(dm[1]);
    month = MONTH_INDEX[dm[2]!.slice(0, 3).toLowerCase()]!;
    year = dm[3] ? Number(dm[3]) : undefined;
  } else if (md) {
    day = Number(md[2]);
    month = MONTH_INDEX[md[1]!.slice(0, 3).toLowerCase()]!;
    year = md[3] ? Number(md[3]) : undefined;
  } else {
    return null;
  }
  if (day < 1 || day > 31) return null;

  const build = (y: number) => {
    const d = new Date(Date.UTC(y, month, day));
    return d.getUTCMonth() === month ? toISODate(d) : null;
  };
  if (year) return build(year);
  const thisYear = build(now.getUTCFullYear());
  if (!thisYear) return null;
  const ageDays = (now.getTime() - Date.parse(`${thisYear}T00:00:00Z`)) / 86_400_000;
  return ageDays > 30 ? build(now.getUTCFullYear() + 1) : thisYear;
}

// ---------- Duplicate detection ----------

const STOP = new Set(
  'a an the and or but to for of on in at by with from as is are be been was were will would shall should can could we our us i you your they them their it this that these those have has had do does did not no so if then than into about before after up out all any just also very get got make made'.split(' '),
);

export function normalise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

export const DUPLICATE_THRESHOLD = 0.6;

/** Commitments in the same account whose text is at least 60% similar (Jaccard on token sets). */
export function findDuplicates(
  text: string,
  accountId: string,
  existing: Pick<Commitment, 'id' | 'accountId' | 'title'>[],
  threshold = DUPLICATE_THRESHOLD,
): Array<{ id: string; score: number }> {
  const tokens = normalise(text);
  return existing
    .filter((c) => c.accountId === accountId)
    .map((c) => ({ id: c.id, score: Math.round(jaccard(tokens, normalise(c.title)) * 100) / 100 }))
    .filter((d) => d.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

// ---------- Scan a block of text ----------

export interface ScanHit {
  quote: string;
  suggestedClass: CandidateClass;
  reason: string;
  dueDate: string | null;
}

/** Run the pre-filter over one source's text and return candidate snippets. */
export function scanText(
  text: string,
  now: Date,
  opts: { accountNames?: string[]; contextAccount?: boolean; limit?: number } = {},
): ScanHit[] {
  const { accountNames = [], contextAccount = false, limit = 50 } = opts;
  const hits: ScanHit[] = [];
  for (const s of splitSentences(text)) {
    if (hits.length >= limit) break;
    if (!isCandidate(s, accountNames, contextAccount)) continue;
    const sug = suggestClass(s, accountNames, contextAccount);
    hits.push({ quote: s, suggestedClass: sug.class, reason: sug.reason, dueDate: extractDate(s, now) });
  }
  return hits;
}

/** Stable key for a candidate: source URL plus quote, so re-scans do not re-add it (H6). */
export function candidateKey(sourceUrl: string, quote: string): string {
  // FNV-1a 32-bit, twice with different seeds, hex. Not cryptographic; dedupe only.
  const fnv = (s: string, seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  const input = `${sourceUrl}\n${quote}`;
  return `${fnv(input, 0x811c9dc5)}${fnv(input, 0x9e3779b9)}`;
}
