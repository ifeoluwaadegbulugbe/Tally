// Forge adapter for the Teamwork Graph client: every call runs as the viewing user.
// @forge/api adds the X-Query-Context header (the installation's site) itself.
import api from '@forge/api';
import type { GraphHttp } from './client';

export const forgeGraphHttp: GraphHttp = async (query, variables) => {
  const res = await api.asUser().requestTeamworkGraph(query, variables);
  return { status: res.status, json: () => res.json() };
};
