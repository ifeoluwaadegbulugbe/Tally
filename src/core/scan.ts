// Discovery scan (section D, F-03/F-04): turn source text into reviewable candidates.
// Pure: the Jira/Confluence readers hand in text; nothing here does I/O.
import type { z } from 'zod';
import type { CandidateSchema } from '../types/schemas';
import { candidateKey, findDuplicates, scanText } from './discovery';
import type { Account, Commitment } from './types';

export type Candidate = z.infer<typeof CandidateSchema>;

export const SCAN_CANDIDATE_CAP = 50;
export const SCAN_ITEM_CAP = 200;

/** Atlassian Document Format (Jira descriptions and comments) to plain text, one block per line. */
export function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: { text?: string } };
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'mention') return n.attrs?.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  const inner = (n.content ?? []).map(adfToText).join('');
  const block = ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableCell', 'panel'];
  return block.includes(n.type ?? '') ? `${inner}\n` : inner;
}

export interface ScanSource {
  sourceType: 'jira' | 'confluence';
  sourceUrl: string;
  sourceTitle: string;
  text: string;
  /** The account that owns this project/space, if one is configured. */
  accountId: string | null;
}

/** Pick the account a snippet is about: the source's account, else a single named account. */
export function resolveAccount(quote: string, sourceAccountId: string | null, accounts: Pick<Account, 'id' | 'name'>[]): string | null {
  if (sourceAccountId) return sourceAccountId;
  const named = accounts.filter((a) => new RegExp(`\\b${a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(quote));
  return named.length === 1 ? named[0]!.id : null;
}

/**
 * Candidates from one source. Lines are scanned separately so headings never glue onto
 * the next sentence. Account names count as the customer reference; a source owned by an
 * account counts too. Duplicates are flagged against that account's commitments.
 */
export function extractCandidates(
  source: ScanSource,
  accounts: Pick<Account, 'id' | 'name'>[],
  commitments: Pick<Commitment, 'id' | 'accountId' | 'title'>[],
  now: Date,
  limit = SCAN_CANDIDATE_CAP,
): Candidate[] {
  const names = accounts.map((a) => a.name);
  const out: Candidate[] = [];
  for (const line of source.text.split('\n')) {
    if (out.length >= limit) break;
    for (const hit of scanText(line, now, { accountNames: names, contextAccount: !!source.accountId, limit: limit - out.length })) {
      const accountId = resolveAccount(hit.quote, source.accountId, accounts);
      out.push({
        id: candidateKey(source.sourceUrl, hit.quote),
        accountId,
        sourceType: source.sourceType,
        sourceUrl: source.sourceUrl,
        sourceTitle: source.sourceTitle.slice(0, 200),
        quote: hit.quote,
        suggestedClass: hit.suggestedClass,
        suggestedBy: 'rules',
        reason: hit.reason,
        dueDate: hit.dueDate,
        duplicateOf: accountId ? findDuplicates(hit.quote, accountId, commitments) : [],
        reviewState: 'unreviewed',
        createdAt: now.toISOString(),
      });
    }
  }
  return out;
}

/** A title for the commitment proposed from a quote: the quote itself, trimmed of filler. */
export function proposedTitle(quote: string): string {
  const t = quote
    .replace(/^(?:\w+ (?:said|confirmed|promised) (?:that )?)/i, '')
    .replace(/^(?:we(?:'|’)ll|we will|we'd|we would|i(?:'|’)ll|i will|we are going to|we committed to|we promised(?: to)?)\s+/i, '')
    .replace(/[.!]+$/, '')
    .trim();
  const title = t.charAt(0).toUpperCase() + t.slice(1);
  return title.length > 120 ? `${title.slice(0, 117).trimEnd()}…` : title;
}
