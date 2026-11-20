---
name: tally-customer-commitments
description: Use Tally's MCP tools to find, explain and report on promises made to customers that are tracked in Jira and Confluence. Use when asked what was promised to a customer, which promises are at risk or unowned, why one is at risk, or to draft a customer progress update.
---

# Tally: customer commitments

Tally tracks every promise made to a customer as a **commitment**: an account, an owner, a due
date, evidence (the exact quote and a link to where it was said) and linked Jira work. Risk is
flagged by nine readable rules (R1 overdue ... R9 stale delivery), never by a score.

The tools run as the signed-in Atlassian user, so they only return what that user can see.

## Tools

| Tool | Use it to | Key inputs |
|---|---|---|
| `find-commitments` | List or search open commitments | `account`, `owner` (a name, `me`, `unassigned`), `status`, `health` (`on_track`, `watch`, `at_risk`, `critical`), `text` |
| `get-account-health` | Summarise one customer | `account` (required) |
| `identify-at-risk-commitments` | List what is slipping, worst first, with every reason | `minSeverity` (2-5, default 4), `account` |
| `get-commitment-details` | Everything about one commitment | `commitmentId` (required) |
| `explain-risk` | Why one commitment is at risk, rule by rule | `commitmentId` (required) |
| `draft-customer-update` | Saves a progress update draft for a customer, from stored facts only (Tally > Updates) | `account` (required), `commitmentIds` (comma separated) |
| `propose-candidate` | Put a possible promise in the Tally inbox for a person to review | `quote` (required, the exact words), `account`, `sourceUrl`, `dueDate` |

Every tool returns `{ ok: true, data }` or `{ ok: false, code, message }`. An unknown account or
id returns `code: "not_found"`.

## Rules for agents

1. **Never present a candidate as a confirmed commitment.** `propose-candidate` only adds to
   the Tally inbox. Say that a person must confirm it in Tally before it is tracked.
2. State only what the tools return. If a field is missing, say it is missing. Never invent a
   commitment, owner, date, issue key, quote or link.
3. Quote evidence exactly, in quotation marks, with its commitment ID.
4. When explaining risk, repeat each rule's reason as returned. Do not add causes.
5. Drafts are drafts. Tally never sends anything; a person reviews and approves in Tally.
6. If a tool returns `not_found`, say no commitments were found for it. Do not guess.
7. For `propose-candidate`, pass `sourceUrl` only if the user gave a link, and `dueDate` only
   if a date is written in the quote. Tally drops a date that is not in the quote.

## Examples

**"What's at risk for Northwind, and why?"**
1. `identify-at-risk-commitments` with `account: "Northwind Health"`.
2. For each returned commitment, report its ID, title and each signal's `reason`, e.g.
   `c-nw-ehr` "Custom EHR integration before renewal": R5 "DEMO-21 is blocked."; R6
   "DEMO-21 due 6 Dec, promise due 29 Nov."
3. Offer `get-commitment-details` for the evidence quote.

**"Our AE wrote: 'We'll have the audit log ready for Acme by 12 Dec.' Track it."**
1. `propose-candidate` with `quote: "We'll have the audit log ready for Acme by 12 Dec."`,
   `account: "Acme Retail"`, and no `sourceUrl`.
2. Reply: added to the Tally inbox as unreviewed, due 12 Dec taken from the quote; someone
   must confirm it in Tally before it is tracked.
