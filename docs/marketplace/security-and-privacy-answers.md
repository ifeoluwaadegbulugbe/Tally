# Privacy & Security tab and security questionnaire: prepared answers

Answer from these during submission. Everything below matches the code at the time of writing
(see PROGRESS.md T17/T18).

## Privacy & Security tab
| Question | Answer |
|---|---|
| Does the app store End-User Data outside Atlassian? | No. All data is in Forge hosted storage (KVS) on the customer's site. |
| Does the app process End-User Data outside Atlassian or the user's browser? | No. No egress: the manifest has no `external.fetch`; Runs on Atlassian eligible. |
| Does the app expose remote REST APIs? | No. |
| Does the app share End-User Data with third parties? | No. No sub-processors. |
| GDPR role | The customer is controller; the app stores data only inside the customer's Atlassian site. |
| Data residency | Supported: Forge hosted storage follows the site's data residency (pinned location). |
| Data retained after uninstall? | Per Atlassian's Forge hosted storage data lifecycle (soft delete, then removal; relink possible within 21 days). The app keeps nothing elsewhere. |
| Logging | One line per call: action name, outcome code, duration. No customer content. |
| Encryption | Provided by Atlassian Forge hosted storage. |
| Credentials / PATs | The app never asks for or stores passwords or tokens. All product API calls use `asUser()`. |
| Security contact | ifeoluwaadegbulugbe@gmail.com (must have an account on ecosystem.atlassian.net) |
| Privacy policy | https://ifeoluwaadegbulugbe.github.io/tally-commitments-docs/privacy-policy |

## Scope justification (manifest `permissions.scopes`)
| Scope | Why |
|---|---|
| `storage:app` | Store commitments, evidence quotes, history, drafts and settings inside Forge. |
| `read:jira-work` | Read status, assignee and due date of linked issues; search issues to link; scan chosen projects; check the viewer's admin permission. |
| `write:jira-work` | Create a delivery issue, only when a user confirms it in Tally. |
| `read:jira-user` | Show owners and assignees by name; owner picker. |
| `search:confluence` | Find Confluence pages to quote as evidence; list pages when scanning a chosen space. |
| `read:page:confluence` | Read a chosen page to pick and verify a quote. Only the quote and link are stored. |
| `read:space:confluence` | Look up a space by key for scans. |
| `read:graph:issue:jira` | Teamwork Graph: related work items for a linked issue. |
| `read:graph:page:confluence` | Teamwork Graph: Confluence pages the owner created. |
| `read:graph:user:atlassian` | Teamwork Graph: assignee names for owner suggestions. |
Remote hostnames called: none.

## Security requirements (cloud apps) — how Tally meets them
- **Authenticate and authorise every request:** every resolver rejects calls without a signed-in
  account (tested in `tests/resolvers.test.ts`); admin-only actions (demo data, delete all,
  export, rule changes) check Jira's ADMINISTER permission on the server.
- **Least privilege:** read scopes plus one write scope used only on explicit confirmation.
  Product calls run `asUser()`, so Atlassian permissions apply.
- **Input validation:** Zod schemas for every stored entity and agent/MCP input; route guard
  limits product API calls to the Jira and Confluence REST prefixes (traversal tested).
- **Output safety:** quotes render as text; no `dangerouslySetInnerHTML` (tested).
- **Secrets:** none. No API keys, no egress.
- **Dependencies:** `npm audit` reports 0 vulnerabilities for the app and the UI (16 Nov 2026).
  Re-run before each release.
- **CSP:** the Custom UI bundle loads no external scripts, styles or fonts.
- **Data deletion:** admins can delete all app data from Settings > Data.
- **Incident response:** report to Atlassian via ECOHELP; acknowledge security reports within 2
  business days; follow the Security Bug Fix Policy.
