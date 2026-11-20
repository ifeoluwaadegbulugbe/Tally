// Forge function handlers for the Rovo agent actions (manifest: function keys -> index.<name>).
// Each builds the shared dependencies, runs the action, logs one line, and never throws.
import { fail } from '../core/types';
import type { Result } from '../core/types';
import { JiraClient } from '../jira/client';
import { forgeJiraHttp } from '../jira/forge-http';
import { logCall, logError } from '../resolvers/log';
import { forgeKv } from '../storage/forge-kv';
import { Repo } from '../storage/repo';
import { draftCustomerUpdate, explainRisk, findCommitments, getAccountHealth, getCommitmentDetails, identifyAtRisk, proposeCandidate } from './actions';
import type { AgentDeps } from './actions';

const repo = new Repo(forgeKv);
const jira = new JiraClient(forgeJiraHttp);

type ActionContext = { principal?: { accountId?: string }; accountId?: string };

function actorFrom(payload: unknown, context: unknown): string | null {
  const c = (context ?? {}) as ActionContext;
  const p = ((payload ?? {}) as { context?: ActionContext }).context ?? {};
  return c.principal?.accountId ?? c.accountId ?? p.principal?.accountId ?? p.accountId ?? null;
}

function wrap(name: string, fn: (payload: unknown, d: AgentDeps) => Promise<Result<unknown>>) {
  return async (payload: unknown, context: unknown): Promise<Result<unknown>> => {
    const started = Date.now();
    const accountId = actorFrom(payload, context);
    if (!accountId) {
      logCall(`agent.${name}`, 'forbidden', 0);
      return fail('forbidden', 'Tally actions need a signed-in user.');
    }
    try {
      const res = await fn(payload, {
        repo,
        actor: { accountId },
        now: new Date(),
        names: async (ids) => {
          const r = await jira.users(ids);
          return r.ok ? r.data : {};
        },
      });
      logCall(`agent.${name}`, res.ok ? 'ok' : res.code, Date.now() - started);
      return res;
    } catch (err) {
      logError(`agent.${name}`, err);
      return fail('internal', `Tally could not complete ${name}. Try again.`);
    }
  };
}

export const findCommitmentsHandler = wrap('findCommitments', findCommitments);
export const getAccountHealthHandler = wrap('getAccountHealth', getAccountHealth);
export const explainRiskHandler = wrap('explainRisk', explainRisk);
export const proposeCandidateHandler = wrap('proposeCandidate', proposeCandidate);
export const draftCustomerUpdateHandler = wrap('draftCustomerUpdate', draftCustomerUpdate);
export const getCommitmentDetailsHandler = wrap('getCommitmentDetails', getCommitmentDetails);
export const identifyAtRiskHandler = wrap('identifyAtRisk', identifyAtRisk);
