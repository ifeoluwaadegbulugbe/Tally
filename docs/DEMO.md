# Demo video: script and recording checklist (target 2:50, limit 5:00)

Record on the demo site **one-atlas-npei.atlassian.net** (it has Rovo), signed in as the main
admin account. Record each beat as its own clip and join them; if a beat fails, re-record it
or say so on screen. Never cut around a failure. No music, or royalty-free only.

## Before recording (5 minutes)
1. Tally > Settings > Data > **Delete all data** (type the site name), then Dashboard > **Load
   demo data**. This resets the Acme SSO links and the sent update from testing.
2. Check Jira has TD-1 (epic), TD-2 (child, blocked by TD-3) and TD-3 in project TD. They feed
   the Teamwork Graph beat.
3. Browser zoom 110-125 %, close other tabs, hide bookmarks, do not show any email inbox.
4. Open Rovo chat once so "Tally Agent" is in the agent list.
5. Optional MCP beat: in a terminal, `claude mcp list` shows `tally` connected.

## Script
| Time | Screen | Say (about 150 words a minute) |
|---|---|---|
| 0:00 | Dashboard | "Sales tells a customer: we'll ship SSO before your rollout. That promise ends up in a page, and nobody owns it until the customer asks. Tally keeps those promises." |
| 0:12 | Dashboard KPIs + Needs attention | "Eight open commitments. One has no owner, four are at risk, and each line says why, in plain words." |
| 0:25 | Inbox, pick a candidate | "Tally scans the Jira projects and Confluence spaces I choose and lists possible promises with the exact quote. Nothing is tracked until a person confirms it." Click **Confirm** on one. |
| 0:45 | Commitment "Support SSO before their rollout" | "Here's the unowned one. The evidence is the customer's own words, with a link back to the source." **Assign to me**, then **Link issue** > TD-2. |
| 1:05 | Same page, Related context | "Linking real Jira work pulls in related context from the Teamwork Graph: the parent epic and the security review that blocks it. I can link those too." |
| 1:20 | Commitment "Custom EHR integration before renewal" | "This one is at risk because its Jira issue is blocked and the issue's due date is after the promise. Every risk is a rule, and Why? explains it." Open **Why?** on R5. |
| 1:40 | Rovo chat, Tally Agent | Ask: "Which commitments are at risk and why?" then paste: "Priya said we'd have the audit log ready by 12 Dec for Acme". "The agent only states what Tally returns, and a pasted promise goes to the inbox for review." |
| 2:10 | Terminal or Rovo Studio | "The same tools are exposed through Atlassian MCP, so other AI assistants can use them with the user's permissions." Show `claude mcp list` / the tools list. (Do not show a data answer from the external client: it reads the Confluence installation's storage, which is empty. Say "tools available".) |
| 2:25 | Updates > New draft for Acme Retail | "A customer update drafted from stored facts only. The facts it used are right beside it." **Approve**, then **Copy text**. "Copy only works after a person approves. Tally never sends anything." |
| 2:45 | Settings | "Everything runs on Atlassian: no data leaves your site." |
| 2:50 | Closing card (banner) | "Tally. Every promise to a customer, kept." |

## After recording
- Upload to YouTube as **Public** (not Unlisted), title "Tally: customer commitments for Jira
  and Confluence (Codegeist 2026)". Paste the link into DEVPOST.md and the Devpost form.
- Screenshots for Devpost and the Marketplace highlights (1840 x 900): Dashboard, Inbox review
  pane, Commitment detail with Related context, Updates with facts used.
