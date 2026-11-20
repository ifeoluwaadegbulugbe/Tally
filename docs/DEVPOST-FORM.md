# Devpost form: answers to paste

Copy each block into the matching field. Fields marked **YOU** are personal and only you can answer.

---

## Page 1: Project overview

**Project name** (max 60)
```
Tally: customer commitments for Jira and Confluence
```

**Elevator pitch** (max 200)
```
Tally finds the promises your team makes to customers in Jira and Confluence, gets each one owned, ties it to delivery work and flags the ones slipping, with a Rovo agent and MCP tools.
```

**Thumbnail** (3:2): upload `docs/marketplace/assets/devpost-thumbnail.png`

---

## Page 2: Project story

**About the project** (Markdown)
```markdown
## Inspiration
Sales tells a customer "we'll ship SSO before your rollout." The promise ends up in a meeting page or a Jira comment, and after the call nobody checks that it was owned, scheduled or delivered. The customer finds out first. Tally keeps those promises.

## What it does
- **Discovery inbox:** scans the Jira projects and Confluence spaces you choose and lists possible promises with the exact quote and a link to the source. A person confirms, edits, marks ambiguous or rejects each one. Duplicates are flagged. Nothing is tracked automatically.
- **Commitments:** every confirmed promise gets an owner, a due date, evidence and the Jira work that delivers it. Its status follows that work: in delivery when work starts, delivered when every linked issue is Done.
- **Nine rule-based risk flags:** overdue, due soon, no owner, no delivery work, blocked, date mismatch, date moved, no evidence, stale. Each says why in plain words ("DEMO-21 is blocked") and can be acknowledged with a reason and an expiry.
- **Customer updates:** drafted from stored facts only, shown beside the facts used, approved by a person, then copied into their own email. Tally never sends anything.
- **Tally Agent in Rovo:** "Which commitments are at risk and why?", "Draft an update for Acme". Paste a customer message and it proposes the promise to the inbox for review. It only states facts its actions return.
- **MCP tools:** the same seven tools on Atlassian's MCP server, so other AI assistants can use them with the user's permissions.
- **Teamwork Graph context:** for each linked issue, its parent, children, blocking and linked work, plus the owner's recent Confluence pages, with Link and Attach as evidence.

## How we built it
A Forge Custom UI app (React, Vite, TypeScript). One pure engine (`src/core`: risk rules, lifecycle, discovery, drafts) sits behind three thin entry points: the UI resolvers, the Rovo agent actions and the MCP tools, so the UI, the agent and external assistants always agree. Data lives in Forge storage. Every Jira, Confluence and Teamwork Graph call runs as the signed-in user, so Atlassian's permissions apply. Admin-only actions are checked on the server. 173 Vitest tests cover every rule, the lifecycle, drafts, the graph client and permissions. It runs on Atlassian with no egress.

## Challenges we ran into
- Forge storage is per installation, so the Jira and Confluence installations keep separate data, and external MCP calls are served by the Confluence one. We documented it rather than hide it.
- Raw Cypher is not available to new apps, and the graph has no issue-to-page relationship, so we used Atlassian's curated queries and took pages from the owner's work.
- Rovo needed a site with Rovo enabled; a Forge demo site solved it without a card.

## Accomplishments that we're proud of
Human confirmation everywhere: AI suggests and drafts, a person decides. Every risk has a reason, every quote has a source, every update lists the facts it used.

## What we learned
How to give an agent and an MCP server the same engine and the same permission model as the UI, and how much trust comes from showing the evidence next to every claim.

## What's next for Tally
Shared data across the Jira and Confluence installations, scheduled scans, and a Marketplace release ("Tally Commitments for Jira").
```

**Built with** (one tag at a time)
```
forge
jira
confluence
rovo
rovo-agent
mcp
teamwork-graph
typescript
react
vite
zod
vitest
forge-storage
custom-ui
```

**"Try it out" links**
```
https://github.com/ifeoluwaadegbulugbe/Tally
https://ifeoluwaadegbulugbe.github.io/tally-commitments-docs/
```

**Image gallery:** up to 15 images, 3:2. Use the dashboard, inbox, commitment detail with Related
context, Risks, Updates and Settings screenshots once captured (they come with the demo video).

**Video demo link:** the public YouTube link when uploaded.

---

## Page 3: Additional info

| Field | Answer |
|---|---|
| Submitter Type | **YOU** (likely "Individual") |
| Country of Residence | **YOU** |
| Canada province | `N/A` (unless you live in Canada) |
| Organization Name | `N/A` |
| Date you started | `2026-11-10` (first build log entry; the GitHub repo was created that day) |
| New or existed before 27 Oct 2026? | New |
| App ID | `f43c90aa-396f-4774-951c-4f62dc2cd3a9` (full form: `ari:cloud:ecosystem::app/f43c90aa-396f-4774-951c-4f62dc2cd3a9`) |
| Category | Apps for Business Teams (pick the closest name in the list) |
| Bonus prize | Best use of Rovo agents (recommended: fully working and tested live). Pick Marketplace only once you have the review ticket. |
| Marketplace URL | Leave empty until the review ticket exists |
| Hackathon helped skills / Likely to use again | **YOU** |
| Age, eligibility, not an employee (three checkboxes) | **YOU**: tick only if true |

**Installation link** (the Jira + Confluence link)
```
paste the first link from docs/install-link.txt
```

**Testing instructions**
```
1. Use an Atlassian Cloud site where you are a site admin, with Jira and Confluence (Rovo too, for the agent).
2. Open the installation link, click Get app, choose your site, click Install. Tally is added to Jira and Confluence in one step. The site list only shows sites that have both products; for a Jira-only site, use the Jira-only link in docs/install-link.txt of the repo (Confluence quotes and scans are then unavailable).
3. In Jira open Apps > Tally. On the empty dashboard click "Load demo data" (Jira admins only). It loads fictional accounts and eight commitments.
4. Try: Dashboard (8 open, 4 at risk, 1 overdue, 1 no owner); Commitments > "Custom EHR integration before renewal" > Why? on each risk; Inbox > confirm a candidate; Updates > New draft for Acme Retail > Approve > Copy text; Settings > Connections.
5. Rovo chat: choose Tally Agent and ask "Which commitments are at risk and why?", or paste "Priya said we'd have the audit log ready by 12 Dec for Acme".
6. Teamwork Graph: open a commitment, Link issue, choose a real issue that has a parent or a "blocks" link; Related context shows that work.
7. MCP (optional): an admin enables "Expose tools to MCP-compatible apps" for Tally in admin.atlassian.com; server https://mcp.atlassian.com/forge/f43c90aa-396f-4774-951c-4f62dc2cd3a9. Note: external MCP calls read the Confluence installation's data, which is separate from Jira's.
Full steps: README in https://github.com/ifeoluwaadegbulugbe/Tally
```

**How the project meets the main technology requirement**
```
Tally is built entirely on Atlassian Forge (Custom UI, functions, Forge storage; Runs on Atlassian, no egress) and integrates with:
- Jira: a global page (Apps > Tally) is the main UI. Tally reads issue status, assignee and due dates to drive each commitment's lifecycle, links and creates delivery issues, and scans chosen projects for customer promises.
- Confluence: scans chosen spaces and lets users quote a page as evidence; the quote is re-checked against the page before it is saved.
- Rovo: a rovo:agent ("Tally Agent") with five actions to find, explain and draft, and to propose promises from chat.
- Atlassian MCP: a rovo:mcp module exposes seven tools to Rovo Studio and external MCP clients.
- Teamwork Graph: requestTeamworkGraph with curated queries (jiraWorkItemHierarchy, atlassianUserContent) shows related work and the owner's pages for each linked issue.
All product calls run as the user (asUser), so Atlassian permissions apply.
```

**Why this category**
```
Tally is for business teams: account executives, customer success and delivery leads who make promises to customers. It turns those promises into owned, tracked work inside the tools these teams already use, and drafts the customer update.
```

**Experience building with Forge**
```
Worked well: Custom UI with resolvers gave full control of a multi-screen app; Forge storage and asUser() calls meant no backend to run; adding a Rovo agent and an MCP server on top of the same functions was a few manifest entries; the Forge demo site gave us Rovo without a card; deploy/install loops were quick.
Struggled with: storage is per installation, so the Jira and Confluence installs hold separate data and external MCP calls land on the Confluence one; Teamwork Graph docs mix raw Cypher (unavailable to new apps) and curated queries, and the graph has no issue-to-page relationship; Node version warnings in the CLI; iframe UIs are hard to automate in tests.
Would improve: a documented way to share storage across a multi-product app, a clear statement of which installation serves MCP calls, more curated graph queries for work-item context, and a CLI command to list environments with IDs.
```

**AI tools used**
```
Claude (Claude Code) as a coding and testing assistant: writing and reviewing code, running tests and deployments, browser checks of the live app, and drafting docs. Rovo is part of the product (Tally Agent). All design decisions and approvals were mine.
```
