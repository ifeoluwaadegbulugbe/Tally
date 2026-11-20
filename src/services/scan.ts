// Cursor-based discovery scan (H8): each call processes one page (20 Jira issues or 10
// Confluence pages) and returns a cursor the UI passes back, so no call runs long and the
// UI can show progress. Caps: 50 new candidates and 200 items per run (section D, O21).
import type { ConfluenceClient } from '../confluence/client';
import { SCAN_CANDIDATE_CAP, SCAN_ITEM_CAP, adfToText, extractCandidates } from '../core/scan';
import type { ScanSource } from '../core/scan';
import type { Result } from '../core/types';
import { ok } from '../core/types';
import type { JiraClient } from '../jira/client';
import { TALLY_DESCRIPTION_PREFIX } from '../jira/client';
import type { Repo } from '../storage/repo';

export interface ScanCursor {
  queue: Array<{ kind: 'jira' | 'confluence'; key: string; token?: string | null; spaceId?: string }>;
  scanned: number;
  added: number;
  skipped: string[];
}

export interface ScanStep {
  cursor: ScanCursor | null; // null when the run is finished
  scanned: number;
  added: number;
  capped: boolean;
  skipped: string[]; // sources the user cannot read (restricted space, unknown project)
  current: string | null;
}

export function startCursor(projectKeys: string[], spaceKeys: string[]): ScanCursor {
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  return {
    queue: [
      ...uniq(projectKeys).map((key) => ({ kind: 'jira' as const, key: key.toUpperCase() })),
      ...uniq(spaceKeys).map((key) => ({ kind: 'confluence' as const, key })),
    ],
    scanned: 0,
    added: 0,
    skipped: [],
  };
}

export async function scanStep(
  repo: Repo,
  jira: JiraClient,
  confluence: ConfluenceClient,
  cursor: ScanCursor,
  siteUrl: string,
  now: Date,
): Promise<Result<ScanStep>> {
  const c: ScanCursor = { ...cursor, queue: [...cursor.queue], skipped: [...cursor.skipped] };
  const head = c.queue[0];
  const done = (capped: boolean): ScanStep => ({ cursor: null, scanned: c.scanned, added: c.added, capped, skipped: c.skipped, current: null });
  if (!head) return ok(done(false));
  if (c.added >= SCAN_CANDIDATE_CAP || c.scanned >= SCAN_ITEM_CAP) return ok(done(true));

  const [accounts, commitments] = await Promise.all([repo.listAccounts(), repo.listCommitments()]);
  const sources: ScanSource[] = [];
  let next: string | null = null;

  if (head.kind === 'jira') {
    const owner = accounts.find((a) => a.jiraProjectKey === head.key)?.id ?? null;
    const page = await jira.scanProjectPage(head.key, head.token ?? undefined);
    if (!page.ok) {
      if (page.code === 'forbidden' || page.code === 'not_found' || page.code === 'validation') {
        c.skipped.push(`Jira ${head.key}`);
        c.queue.shift();
        return ok({ cursor: c.queue.length ? c : null, scanned: c.scanned, added: c.added, capped: false, skipped: c.skipped, current: head.key });
      }
      return page;
    }
    for (const i of page.data.issues) {
      // Text Tally itself wrote (descriptions of issues it created) is not a customer promise.
      const description = adfToText(i.description);
      const text = [i.summary, description.startsWith(TALLY_DESCRIPTION_PREFIX) ? '' : description, ...i.comments.map(adfToText)].join('\n');
      sources.push({ sourceType: 'jira', sourceUrl: `${siteUrl}/browse/${i.key}`, sourceTitle: `${i.key} ${i.summary}`, text, accountId: owner });
    }
    next = page.data.nextPageToken;
  } else {
    const owner = accounts.find((a) => a.confluenceSpaceKey === head.key)?.id ?? null;
    let spaceId = head.spaceId;
    if (!spaceId) {
      const id = await confluence.spaceId(head.key);
      if (!id.ok) {
        c.skipped.push(`Confluence ${head.key}`);
        c.queue.shift();
        return ok({ cursor: c.queue.length ? c : null, scanned: c.scanned, added: c.added, capped: false, skipped: c.skipped, current: head.key });
      }
      spaceId = id.data;
    }
    const page = await confluence.scanSpacePage(spaceId, head.token ?? undefined);
    if (!page.ok) return page;
    for (const p of page.data.pages) {
      sources.push({ sourceType: 'confluence', sourceUrl: p.url, sourceTitle: p.title, text: p.text, accountId: owner });
    }
    next = page.data.cursor;
    head.spaceId = spaceId;
  }

  c.scanned += sources.length;
  const found = sources.flatMap((s) => extractCandidates(s, accounts, commitments, now));
  const added = await repo.saveCandidates(found.slice(0, Math.max(0, SCAN_CANDIDATE_CAP - c.added)));
  c.added += added;

  if (next) c.queue[0] = { ...head, token: next };
  else c.queue.shift();

  const capped = c.added >= SCAN_CANDIDATE_CAP || c.scanned >= SCAN_ITEM_CAP;
  if (capped || c.queue.length === 0) return ok(done(capped));
  return ok({ cursor: c, scanned: c.scanned, added: c.added, capped: false, skipped: c.skipped, current: head.key });
}

/** Validate a cursor coming back from the browser before trusting it. */
export function parseCursor(raw: unknown): ScanCursor | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as ScanCursor;
  if (!Array.isArray(c.queue) || typeof c.scanned !== 'number' || typeof c.added !== 'number' || !Array.isArray(c.skipped)) return null;
  const okItem = (q: ScanCursor['queue'][number]) =>
    (q.kind === 'jira' && /^[A-Z][A-Z0-9_]+$/.test(q.key)) || (q.kind === 'confluence' && /^[~\w-]{1,255}$/.test(q.key));
  return c.queue.length <= 50 && c.queue.every(okItem) ? c : null;
}

