// Forge adapter for the Jira client: always asUser(), so Jira enforces the viewer's permissions.
import api, { routeFromAbsolute } from '@forge/api';
import type { JiraHttp } from './client';

/**
 * routeFromAbsolute() parses a full URL and keeps only its path and query, so the client's
 * site-relative paths get a placeholder origin. URL parsing also normalises "." and ".."
 * segments. Query values are already encoded by the client (URLSearchParams / encodeURIComponent).
 */
export function toRoute(path: string, allowed: string[] = ['/rest/api/3/']) {
  const url = new URL(`https://site.invalid${path}`);
  // Checked after normalisation, so "/rest/api/3/../../x" cannot escape the allowed API.
  if (url.origin !== 'https://site.invalid' || !allowed.some((p) => url.pathname.startsWith(p))) {
    throw new Error(`Path must stay under ${allowed.join(' or ')}`);
  }
  return routeFromAbsolute(url.toString());
}

export const forgeJiraHttp: JiraHttp = (path, init) =>
  api.asUser().requestJira(toRoute(path), {
    method: init?.method ?? 'GET',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(init?.body ? { body: init.body } : {}),
  });
