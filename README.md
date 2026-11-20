# Tally: customer commitments for Jira and Confluence

Tally keeps track of what your team promised customers. It finds possible promises in Jira and
Confluence, a person confirms them, each promise is tied to the Jira work that delivers it, nine
rule-based risk flags explain what is slipping, and customer updates are drafted from stored facts
for a person to approve. It is a Forge app (Custom UI) with a Rovo agent, Atlassian MCP tools and
Teamwork Graph context. It runs on Atlassian: no calls leave the customer's site.

Built for Codegeist 2026. Docs, privacy policy and support:
https://ifeoluwaadegbulugbe.github.io/tally-commitments-docs/

## For judges: install and try it (about 5 minutes)

You need an Atlassian Cloud site where you are a site admin, with **Jira** and **Confluence**.
The Rovo agent and MCP parts also need **Rovo** on the site (Forge demo sites from
`forge site provision` include it).

1. **Install:** open the [installation link](https://developer.atlassian.com/console/install/f43c90aa-396f-4774-951c-4f62dc2cd3a9?signature=AYABeCFxvjAFREPz1faoH8DIBX4AAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBxr0Qqi1wdsVrFbciEZDY6AAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDJeWzrI0tf7F6Z2BuAIBEIA7DZsXPJLUFAVA1Z07VaYPZA7BpNJkXFfm5hWzzh7vZvpual1M1B%2FfO8kwd6NDJYhM3hhXE0nDMsirZnUAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgGmSMPANnmy5fcBQoTaRgOiAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMY%2FaBH247EAweJVNHAgEQgDtVm7%2BARDAEtcB0s7%2FiH%2BP%2FkImrplrSbuRb79f8Tkd4HTIxx10EnAhlgHVpC%2Bw0E4p7FtXjnzf7rJL1vgAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAUqj%2FlkAasEa6HjXuqDR8oQAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwQf%2BPmhJubBCrj%2BaUCARCAO3WehBPsc%2BmKJrKDp6K%2B8uI2uc8Qa4F6MG4kdbX6JD%2B4CHSvmnRkJr68fdw7QR1TLvq7oF16R4FsvRziAgAAAAAMAAAQAAAAAAAAAAAAAAAAALwSRHKbdwqtP32sQVm%2FiGn%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLy62LnosXYJ8ATlLg2HYcEK4u4OoK9DDB%2B0S1uFywMVTJwqBF08cOXq3%2Frw5htwxzp2JFd4YysMsh5XIfq%2FO%2Bm%2BPs%3D&product=confluence&product=jira), sign in, click **Get app**, choose your
   site and click **Install**. Tally is added to Jira and Confluence in one step. The site list
   only shows sites where you are an admin **and** that have both Jira and Confluence.
   - Site with Jira only? Use the [Jira-only link](https://developer.atlassian.com/console/install/f43c90aa-396f-4774-951c-4f62dc2cd3a9?signature=AYABeCFxvjAFREPz1faoH8DIBX4AAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBxr0Qqi1wdsVrFbciEZDY6AAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDJeWzrI0tf7F6Z2BuAIBEIA7DZsXPJLUFAVA1Z07VaYPZA7BpNJkXFfm5hWzzh7vZvpual1M1B%2FfO8kwd6NDJYhM3hhXE0nDMsirZnUAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgGmSMPANnmy5fcBQoTaRgOiAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMY%2FaBH247EAweJVNHAgEQgDtVm7%2BARDAEtcB0s7%2FiH%2BP%2FkImrplrSbuRb79f8Tkd4HTIxx10EnAhlgHVpC%2Bw0E4p7FtXjnzf7rJL1vgAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAUqj%2FlkAasEa6HjXuqDR8oQAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwQf%2BPmhJubBCrj%2BaUCARCAO3WehBPsc%2BmKJrKDp6K%2B8uI2uc8Qa4F6MG4kdbX6JD%2B4CHSvmnRkJr68fdw7QR1TLvq7oF16R4FsvRziAgAAAAAMAAAQAAAAAAAAAAAAAAAAALwSRHKbdwqtP32sQVm%2FiGn%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLy62LnosXYJ8ATlLg2HYcEK4u4OoK9DDB%2B0S1uFywMVTJwqBF08cOXq3%2Frw5htwxzp2JFd4YysMsh5XIfq%2FO%2Bm%2BPs%3D&product=jira) instead. Everything works except
     Confluence quotes and scans (Settings shows Confluence as "Not reachable").
   - Both links are also in `docs/install-link.txt`.
2. **Open Tally:** in Jira, **Apps > Tally**.
3. **Load demo data:** on the empty dashboard click **Load demo data** (shown to Jira admins).
   It loads fictional accounts (Acme Retail, Northwind Health, Brightfield), eight commitments,
   inbox candidates and history so every screen and all nine risk rules have something to show.

### What to try
| Where | Try this | You should see |
|---|---|---|
| Dashboard | Open it | 8 open, 4 at risk, 1 overdue, 1 with no owner; a "Needs attention" list with reasons |
| Commitments | Open "Custom EHR integration before renewal" | Evidence quote, linked issue, risk signals with "Why?" (R5 blocked, R6 date mismatch) |
| Inbox | Pick a candidate | Exact quote, suggested class, duplicate warning; Confirm / Edit and confirm / Ambiguous / Reject |
| Risks | Open it, then **Rules** | Risks grouped by rule; every rule in plain language with its thresholds |
| Updates | **New draft** for Acme Retail | Draft from stored facts, "Facts used" beside it; Copy stays disabled until **Approve** |
| Settings | Open it | Live checks for Jira, Confluence and Teamwork Graph; rule thresholds; export |
| Rovo chat | Choose **Tally Agent**, ask "Which commitments are at risk and why?" | A list with commitment IDs and rule reasons, no invented facts |
| Rovo chat | Paste "Priya said we'd have the audit log ready by 12 Dec for Acme" | A candidate proposed to the Inbox, marked for human review |

**Real Jira and Teamwork Graph data:** demo issues (DEMO-*) are fictional snapshots. To see live
status and Teamwork Graph "Related context", open a commitment, **Link issue**, and link a real
issue from your site that has a parent or a "blocks" link. The graph indexes new links within
about a minute.

### Optional: MCP tools from another AI assistant
1. A site admin turns on external access: **admin.atlassian.com > Apps > Sites > your site >
   Connected apps > Tally > View app details > Expose tools to MCP-compatible apps > Enable**.
2. Add the server to an MCP client, for example Claude Code:
   `claude mcp add --transport http tally https://mcp.atlassian.com/forge/f43c90aa-396f-4774-951c-4f62dc2cd3a9`
   then sign in when prompted.
3. Seven tools are available: find-commitments, get-account-health, get-commitment-details,
   identify-at-risk-commitments, explain-risk, draft-customer-update, propose-candidate.

Known limitation: external MCP calls are served by the **Confluence** installation, whose Forge
storage is separate from the Jira installation's. Tally's UI and Tally Agent use the Jira
installation's data, so an external client sees an empty dataset unless data is created through
that path. Rovo Studio lists the same tools.

### Reset
**Settings > Data > Delete all data** (type the site name to confirm), then **Load demo data** on
the dashboard.

## How it is built
- **One engine, three entry points:** `src/core` holds pure functions (risk rules, lifecycle,
  discovery, drafts). The Custom UI resolvers (`src/resolvers`), the Rovo agent actions and the MCP
  tools (`src/agent`) are thin wrappers over it.
- **Forge modules:** `jira:globalPage` (Custom UI, React + Vite), `function`, `action` (7),
  `rovo:agent`, `rovo:mcp`. Storage: Forge KVS. Scopes and why: see
  `docs/marketplace/security-and-privacy-answers.md`.
- **Teamwork Graph:** Atlassian's curated queries `jiraWorkItemHierarchy` (parent, child, blocks,
  blocked by, linked) and `atlassianUserContent` (the owner's pages), run as the user.
- **Safety:** every product call runs `asUser()`; admin-only actions are checked on the server;
  nothing is confirmed, linked or sent without a person; risk is rule-based, not predictive.

## Develop
```bash
npm install
npm --prefix static/ui install
npm test
npm run build:ui
forge deploy -e development
forge install --site <your-site>.atlassian.net --product jira -e development
```
`PROGRESS.md` is the build log: what was done per task, what was verified live, deviations from
the blueprint and known issues.
