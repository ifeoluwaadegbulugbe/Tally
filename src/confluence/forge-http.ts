// Forge adapter for the Confluence client: asUser(), so page restrictions are enforced.
import api from '@forge/api';
import { toRoute } from '../jira/forge-http';
import type { ConfluenceHttp } from './client';

const CONFLUENCE_APIS = ['/wiki/rest/api/', '/wiki/api/v2/'];

export const forgeConfluenceHttp: ConfluenceHttp = (path, init) =>
  api.asUser().requestConfluence(toRoute(path, CONFLUENCE_APIS), {
    method: init?.method ?? 'GET',
    headers: { Accept: 'application/json' },
  });
