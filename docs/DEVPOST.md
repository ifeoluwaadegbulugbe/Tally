# Devpost submission text (Codegeist 2026)

Claim only what runs. Fill the three [brackets] before submitting.

**Name:** Tally
**Tagline / short description (under 200 characters):** Tally finds the promises your team makes to customers in Jira and Confluence, gets each one owned, ties it to delivery work and flags the ones slipping.
**Category:** Apps for Business Teams
**Video:** [YOUTUBE LINK]
**Repo:** [PUBLIC GITHUB REPO LINK]
**Installation link:** see README (link also in docs/install-link.txt)
**Marketplace:** [REVIEW TICKET OR LISTING LINK]

## Inspiration
Promises to customers are made in calls, pages and comments: "SSO before your rollout", "the
migration plan by Friday". After the meeting nobody checks they were owned, scheduled or
delivered, and the customer finds out first.

## What it does
- **Discovery inbox:** scans the Jira projects and Confluence spaces you choose and lists possible
  promises with the exact quote and a link. A person confirms, edits, marks ambiguous or rejects.
  Duplicates are flagged. Nothing is tracked automatically.
- **Commitments:** owner, due date, evidence and the Jira work that delivers it. Status follows
  that work (in delivery when started, delivered when every linked issue is Done).
- **Nine rule-based risk flags** (overdue, due soon, no owner, no delivery work, blocked, date
  mismatch, date moved, no evidence, stale), each with a plain reason and an acknowledge option.
- **Customer updates:** drafted from stored facts only, shown beside the facts used, approved by a
  person, then copied into their own email. Marking it sent records who and when.
- **Tally Agent (Rovo):** answers "what is at risk and why", explains a commitment, drafts updates
  and proposes pasted promises to the inbox. It only states facts its actions return.
- **MCP tools:** seven tools on Atlassian's MCP server for other AI assistants.
- **Teamwork Graph context:** related work for a linked issue and the owner's recent pages.

## How we built it
A Forge Custom UI app (React, Vite, TypeScript) with one pure engine (`src/core`: risk rules,
lifecycle, discovery, drafts) behind three thin entry points: the UI resolvers, the Rovo agent
actions and the MCP tools. Data lives in Forge storage (KVS). Every Jira, Confluence and graph call
runs as the user. 173 Vitest tests, including server-side permission checks.

**Forge modules:** `jira:globalPage`, `function` (8), `action` (7), `rovo:agent`, `rovo:mcp`.
**Scopes:** storage:app, read/write:jira-work, read:jira-user, search/read:page/read:space
Confluence, read:graph:issue:jira, read:graph:page:confluence, read:graph:user:atlassian.
Runs on Atlassian: no egress, no external services.

## Bonus: Rovo agent
`rovo:agent` "Tally Agent" with five actions (find-commitments, get-account-health, explain-risk,
propose-candidate, draft-customer-update). The prompt forbids inventing facts; unknown accounts
return not_found. Tested with a six-step script in Rovo chat.

## Bonus: MCP
`rovo:mcp` exposes seven tools (the five above plus get-commitment-details and
identify-at-risk-commitments). Listed in Rovo Studio; called from Claude Code as an external client.
`skill/SKILL.md` tells agents how to use them. Known limitation: external MCP calls are served by
the Confluence installation, whose Forge storage is separate from the Jira installation's.

## Bonus: Teamwork Graph
`requestTeamworkGraph` as the user, with Atlassian's curated queries (raw Cypher is not available
to new apps): `jiraWorkItemHierarchy` (parent, child, blocks, blocked by, linked) for each linked
issue, and `atlassianUserContent` for Confluence pages the owner created. Shown in "Related context"
on each commitment with Link, Attach as evidence and owner suggestions; "Graph unavailable" with a
reason on errors.

## Bonus: Marketplace
Listing pack prepared (docs, privacy policy, support, security answers); submitted as
"Tally Commitments for Jira": [REVIEW TICKET OR LISTING LINK].

## Challenges
Forge storage is per installation, so the Jira and Confluence installations hold separate data.
The Teamwork Graph has no issue-to-page relationship, so pages come from the owner's work.

## What we learned
Human confirmation is the feature: AI suggests and drafts, a person decides.

## What's next
Shared storage across installations, scheduled scans, and a Marketplace release.

## Judge test steps
See README "For judges": install from the link, Apps > Tally, Load demo data, then the "What to
try" table.
