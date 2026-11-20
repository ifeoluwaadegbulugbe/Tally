// Live Jira sync (T08): read every linked issue once as the viewing user, refresh the
// shared snapshot cache, then apply system lifecycle moves. A Jira failure never breaks
// the screen: the cache keeps its last known values and the caller shows a notice.
//
// Cache rule (H9): only issues the viewer can read are written. Keys Jira refuses for this
// viewer are reported as `unavailable` so the UI shows "No access" instead of cached
// content, and the shared cache is not overwritten with another user's view.
import type { IssueSnapshot } from '../core/types';
import type { JiraClient } from '../jira/client';
import type { Repo } from '../storage/repo';

export interface SyncResult {
  unavailable: string[];
  moved: string[];
  error: string | null;
}

export async function syncIssues(repo: Repo, jira: JiraClient, now: Date): Promise<SyncResult> {
  const commitments = await repo.listCommitments();
  const keys = [...new Set(commitments.flatMap((c) => c.issueKeys))];
  if (keys.length === 0) return { unavailable: [], moved: [], error: null };
  const read = await jira.readIssues(keys);
  if (!read.ok) return { unavailable: [], moved: [], error: read.message };
  if (read.data.snapshots.length) await repo.saveIssueSnapshots(read.data.snapshots);
  const moved = await repo.applySystemStatuses(now);
  return { unavailable: read.data.unavailable, moved, error: null };
}

/** What a viewer may see of a linked issue: live data, a demo snapshot, or nothing. */
export function visibleLink(key: string, cache: IssueSnapshot[], unavailable: string[]) {
  const snap = cache.find((i) => i.key === key);
  if (snap?.source === 'demo') return { key, state: 'demo' as const, issue: snap };
  if (unavailable.includes(key) || !snap) return { key, state: 'unavailable' as const, issue: null };
  return { key, state: 'live' as const, issue: snap };
}
