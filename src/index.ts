// Forge function entry points. manifest.yml: function "resolver" -> handler "index.handler";
// Rovo agent actions -> "index.<name>" below.
export { handler } from './resolvers';
export {
  findCommitmentsHandler as findCommitments,
  getAccountHealthHandler as getAccountHealth,
  explainRiskHandler as explainRisk,
  proposeCandidateHandler as proposeCandidate,
  draftCustomerUpdateHandler as draftCustomerUpdate,
  getCommitmentDetailsHandler as getCommitmentDetails,
  identifyAtRiskHandler as identifyAtRisk,
} from './agent/handlers';
