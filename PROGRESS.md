# Tally progress

Tally for Jira: every promise to a customer, kept. Forge app for Atlassian Codegeist 2026.
Deadline 22 Dec 2026, 9:00pm Lagos. Self-imposed submission: 20 Dec. Marketplace ticket: 8 Dec.

## Log

### 2026-11-10: T05 core engine (done)
- Done: `src/core/` pure engine, no Forge imports. Risk rules R1 to R9, health bands,
  acknowledgements, lifecycle transitions and system status derivation, discovery
  pre-filter and class suggestion, explicit-date extraction, duplicate detection
  (Jaccard 0.6), quote hygiene (300 chars, email masking), deterministic customer
  update drafter, manual create and versioned patch with history rows, dashboard
  rollup, demo data relative to "now". Shared Zod schemas in `src/types/schemas.ts`.
- Tests: 72 passing (`npm test`); `npm run typecheck` clean; `npm audit` 0 vulnerabilities.
  Covers test matrix O1 to O9, O11 to O14, O31, O33 and the "seed shows all nine rules" gate.
- Next: T01 to T04 (needs Ife: Forge CLI login, developer site, partner signup), then T03 scaffold.
- Blocked: nothing for code; Forge work waits on `forge login` and a developer site.

### 2026-11-11: T01 + T03 Forge scaffold and first deploy (done, install pending)
- Done: Node 26.13.0 (Forge CLI 15.1.0 warns it supports 22/24 but works). Forge login saved
  to the Windows keychain. Developer Space "Tally" (12a3f3d9-9269-457c-8a27-478bf6b1e7ce).
  App registered: ari:cloud:ecosystem::app/f43c90aa-396f-4774-951c-4f62dc2cd3a9.
  `jira:globalPage` "Tally" with Custom UI in `static/ui` (Vite 8, React 18.3.1, TypeScript),
  resolvers in `src/resolvers` (H4 envelope, quote-free error logging). `getDashboard`
  runs the core engine on demo data inside Forge until storage exists.
- Checks: `forge lint` clean; deployed to development; Forge reports the version is
  eligible for Runs on Atlassian. Root and UI `npm audit` both 0 vulnerabilities.
- Next: `forge install` on Ife's developer site, see the page in Jira; then T02 validations, T06 storage.
- Installed 2026-11-11 on usetallyapp.atlassian.net (development env). Page renders in Jira with KPIs 8/4/1/1 and no console errors. Forge flagged the site as a production site: test data only.

### 2026-11-11: T06 storage layer (done)
- Done: `src/storage/` with a small KV port (`kv.ts`), the Forge KVS adapter (`forge-kv.ts`,
  the only file importing `@forge/kvs`), and `Repo` (`repo.ts`): accounts, versioned
  commitments with history rows, evidence, signals, issue snapshot cache, settings, demo
  seed (refuses over existing data) and delete-all. Scope `storage:app` added (major version
  3.0.0, install upgraded). Resolvers now read and write storage: getSettings, seedDemoData,
  resetDemoData, getDashboard, listAccounts, saveAccount, listCommitments, getCommitment,
  createCommitment, updateCommitment. Dashboard empty state with "Load demo data" (F1) and an
  inline two-step "Delete all data". One log line per resolver call (name, outcome, ms).
- Checks: 86 tests passing (14 new storage tests on an in-memory KV, incl. O13, O14, O34).
  Verified in Jira: empty state, seed, data survives reload, delete-all empties storage,
  reseed works. `getDashboard` 2.9 s -> 0.2-0.3 s after batching signal writes.
  Root and UI `npm audit` 0 vulnerabilities.
- Found and fixed: history keys collided when two writes landed in the same millisecond
  (an edit overwrote the "created" row); keys now carry a sequence and random suffix.
- Next: T07 UI shell and screens (Accounts, Commitments, Commitment detail with forms).
- Closed in T08: seed/reset restricted to Jira admins; owners resolved from Jira.

### 2026-11-11: T07 UI shell and screens (done)
- Done: routing through `view.createHistory()` from @forge/bridge, synced with the Jira URL
  (deep links like `/commitments/c-nw-ehr` work; V7 pass), in-memory fallback. Shell rail
  links. Screens: Accounts (F2: rollups, search, tier/health filters, New account dialog),
  Commitments (F4: saved views Mine/Unassigned/At risk/Overdue, account/status/health/text
  filters, sort on every column, j/k/Enter/c keys, 25 per page, New commitment dialog with
  optional evidence), Commitment detail (F5: editable title, evidence cards + Add evidence,
  delivery links from the issue cache, activity timeline, owner/due/priority, risk signals
  with "Why?", Assign to me, Renegotiate, Cancel with reason and customer-informed). Dashboard
  KPI cards open the matching list view; rows open the detail. Tables become cards < 768px.
- Backend: `commitmentRows`, `accountRollups` (pure, tested); `Repo.transitionCommitment`
  (cancel/renegotiate; renegotiation also resets the confirmed date so R7 does not fire);
  resolvers listAccounts (rollups), listCommitments (rows), getCommitment (fresh signals,
  rule text), transitionCommitment, addEvidence, whoAmI.
- Checks: 91 tests passing; UI typecheck and build clean; deployed. In Jira: Accounts,
  account -> filtered Commitments, detail and dashboard links all load (0.06-1.3 s).
- Verified live in Jira (all calls ok, 0.15-0.46 s): Assign to me (status Confirmed ->
  Assigned, R3 cleared to On track), Add evidence (email masked), Renegotiate (date and
  status with reason), Cancel (reason required, customer informed recorded, editing locked),
  New account, New commitment (lands on the new record, R8 shown). "Why?" expanders work.
- Fixed after the live run: evidence "captured" dates now show in the viewer's time zone
  (they showed the UTC day); cancel history reads "Customer informed: yes".
- Added "Assign to me" next to the owner select (native selects in the iframe were hard to
  drive in testing, and it is the common case).
- Demo site state: SSO is assigned + renegotiated, the Brightfield residency letter is
  cancelled, and a test account "Contoso Logistics" with one commitment exists. Reset with
  Dashboard -> Delete all data -> Load demo data before recording.
- Next: T08 Jira integration (issue search/link, live status, user picker, admin check for
  seed/reset).

### 2026-11-11: T08 Jira integration (done)
- Done: `src/jira/client.ts` (as-user REST client: bulk read via /issue/bulkfetch, bounded
  JQL search, create issue, issue types, user search and bulk names, ADMINISTER check;
  429 retry once; 401/403 -> forbidden, 404 -> not_found, 4xx/5xx -> validation/upstream
  with Jira's message), `forge-http.ts` adapter, `services/sync.ts` (read every linked issue
  once per screen, refresh the snapshot cache, apply system lifecycle moves by
  "tally-system"). Flagged state from Jira Software's "Flagged" field (looked up by name).
  Resolvers: searchIssues, searchUsers, getIssueTypes, linkIssue, unlinkIssue,
  createDeliveryIssue; dashboard/lists/detail sync first and return user names and a
  `jiraNotice` if Jira is unreachable. Seed/reset now require Jira admin (H9 item closed).
  Scopes read:jira-work, write:jira-work, read:jira-user (major version 4.0.0; still
  Runs on Atlassian eligible). UI: Link issue (search, project filter), Create issue (project,
  type, summary; user confirms), Unlink, issue keys open Jira, owner picker (Jira users,
  initials instead of avatar images to avoid an image egress permission).
- Cache rule (H9): only issues the viewer can read are written to the shared cache; keys
  Jira refuses for the viewer show "No access, or the issue was deleted". Demo snapshots
  are tagged `source: 'demo'` and shown as "demo snapshot".
- Checks: 104 tests (13 new: client, sync, route adapter). Live in Jira: dashboard and
  detail load with sync; issue search runs (site has no projects, so no results); owner
  picker finds the Jira user and assigns.
- Found and fixed live: routeFromAbsolute() needs a full URL ("Invalid URL" on every Jira
  call); the adapter now adds a placeholder origin and checks the path stays under
  /rest/api/3/ after normalisation (a traversal test caught the first version).
- Speed: dashboard ~2.8 s with Jira sync; admin check now runs alongside the sync.
- Jira project created on usetallyapp: "Tally Demo", key DEMO (Kanban; Jira's first-space flow
  made it as KAN, renamed in project settings; KAN is kept as a previous key).
- Verified live end to end: Create issue from the Contoso commitment made DEMO-1 in Jira (as
  the user, due date and description from Tally) and linked it; moving DEMO-1 to In Progress
  and flagging it in Jira made Tally show "IN PROGRESS" with the flag, move the commitment
  Assigned -> In delivery (by "Tally (from Jira)") and fire R5 "DEMO-1 is blocked." (At risk);
  moving DEMO-1 to Done moved it to Delivered. Text search "customs" finds DEMO-1, filtered
  to the account's project. Calls: getCommitment 0.9-2.5 s, searchIssues 0.5 s,
  createDeliveryIssue 2.5 s, getIssueTypes 0.3 s.
- Found and fixed live: Jira's /user/bulk returned null entries for "tally-system" (the
  actor on system status moves), crashing getCommitment; internal "tally-*" ids are no longer
  sent and null entries are ignored (test added; 105 tests).
- Demo data on usetallyapp predates the `source: 'demo'` tag, so its DEMO-11..DEMO-33 links show
  "No access, or the issue was deleted" (correct: they do not exist in the new DEMO project).
  Delete all data -> Load demo data re-tags them as demo snapshots.
- Next: speed (getCommitment up to 2.5 s with sync + names), then T09 Confluence evidence.

### 2026-11-11: T09 Confluence evidence (done)
- Done: `src/confluence/client.ts` (as-user CQL page search, v2 page read, storage-format to
  text, sentence split with "likely promise" hints from the discovery pre-filter), Forge
  adapter with the shared route guard (now takes allowed API prefixes). Resolvers searchPages,
  getPageText, addConfluenceEvidence. Add evidence dialog has "From Confluence" (search ->
  open page -> pick a sentence, optionally shorten) and "Link and quote" tabs.
- Integrity: addConfluenceEvidence re-reads the page as the user and only saves the quote if
  its words are on the page (whitespace/quote/case-insensitive); the link comes from
  Confluence's response, not the client. Only the quote (<= 300 chars, emails masked) and
  link are stored; page text is returned transiently for picking.
- Scopes: search:confluence, read:page:confluence (major version 5.0.0; still Runs on
  Atlassian eligible). The app must also be installed in Confluence for these calls:
  `forge install --product confluence` (done on usetallyapp, development). Judges' install
  steps must cover both products (README, T19).
- Pre-filter tweak: "on <date>" alone is no longer a deadline cue ("We met Acme on Tuesday"
  was flagged); "by"/"due" + date and "before"/"ahead of" still are.
- Checks: 112 tests (7 new). Live: search found 3 pages (1.0 s), page read (0.4 s), an
  invented quote was rejected with a clear message, a real sentence was saved as Confluence
  evidence (0.45 s). Stale picker error now clears when the quote changes.
- Next: speed pass (detail up to 2.5 s), then T10 scan and inbox.

### 2026-11-11: T10 Scan and discovery inbox (done)
- Done: `src/core/scan.ts` (ADF to text, per-line extraction with account resolution and
  duplicate flags, proposed titles), paged readers `JiraClient.scanProjectPage` (search/jql,
  summary + description + comments, nextPageToken) and `ConfluenceClient.scanSpacePage` (v2
  space pages with bodies, cursor), `services/scan.ts` (one page per call, cursor round-trips
  through the UI and is validated on return; caps 50 candidates / 200 items; unreadable
  projects or spaces are skipped and listed). Candidates stored as `cand:{hash of source URL +
  quote}`, so re-scans never duplicate. `Repo.reviewCandidate`: confirm (creates the
  commitment with the quote as evidence, edits for account/title/date/owner), reject
  (reason required), mark ambiguous; nothing is ever confirmed without this call (O10).
  Demo seed adds the five section P snippets as candidates. Inbox screen (F6): scan control
  with live progress, To review / Ambiguous / Confirmed / Rejected tabs with counts, review
  pane with source link, class reason, duplicate warning; Inbox nav shows the to-review count.
- Scope: read:space:confluence (major version 6.0.0; Jira and Confluence installs upgraded;
  still Runs on Atlassian eligible).
- Checks: 125 tests (13 new: ADF, extraction, paging, cap O21, skipped space O20, tampered
  cursor, every review path). Live on usetallyapp after Delete all -> Load demo data: inbox
  showed 5 candidates with the right classes and pre-filled accounts; confirmed the HL7
  promise (title and 1 Dec date taken from the quote) and rejected the "maybe we could"
  suggestion with a reason; counts and the nav badge updated; a DEMO + CS scan ran in two
  steps (0.8 s + 0.3 s; CS does not exist, so it was skipped).
- Found live and fixed: the scan flagged text Tally itself wrote on DEMO-1 (its generated
  description). Descriptions starting with Tally's own prefix are now ignored (test added).
  The two candidates that scan created on usetallyapp remain in the inbox, tagged
  Ambiguous; reject them or reset demo data. The scan result line no longer disappears when
  the list refreshes.
- Demo data was reset on usetallyapp: test records from T07-T09 (Contoso, renegotiated SSO,
  cancelled residency letter) are gone; DEMO-1 still exists in Jira, unlinked.

### 2026-11-11: T11 Risks screen and dashboard consistency (done)
- Done: `matchesView` in core is the single rule for the saved views (Mine, Unassigned, At
  risk, Overdue; open commitments only) and is used by both the dashboard KPIs and the
  Commitments list. Overdue is now a date fact (an acknowledged R1 still counts as overdue),
  which fixed a KPI/list mismatch. `groupRisks` (by rule, most severe first, acknowledged kept
  apart), `Repo.acknowledgeSignal` (reason required, until end of a chosen day, max 90 days,
  null clears; history row "Risk acknowledged"; carries over when R1's daily reason changes).
  Resolvers listRisks, acknowledgeSignal. Risks screen (F7): groups with counts and severity,
  Acknowledge dialog (reason + date, default one week), folded "Acknowledged" section with
  "Show again", and a Rules drawer listing all nine rules, current thresholds and severity.
- Checks: 129 tests (4 new: KPI/list parity with an acknowledged R1, grouping, acknowledgement
  lifecycle across days, validation). Live: Risks showed 10 risks across 9 rules (2.1 s cold,
  0.7 s warm); Rules drawer readable; acknowledging the export bug's R1 until 18 Nov removed the
  Overdue group (0.4 s), the dashboard showed it as Watch while Overdue still counted 1;
  KPI cards Overdue (1) and At risk (3) open lists with the same counts.
- Demo state on usetallyapp: R1 on "Fix reporting export bug" is acknowledged until 18 Nov
  (Risks -> Show acknowledged -> Show again to undo).

### 2026-11-11 / 2026-11-15: T12 Rovo agent (done)
- Done: `src/agent/actions.ts` - five actions over the shared engine: find-commitments,
  get-account-health, explain-risk, propose-candidate (CREATE; lands in the inbox as
  unreviewed, never a commitment; a date is kept only if written in the quote; pasted text
  gets source `urn:tally:rovo-chat`, the agent may not invent links), draft-customer-update
  (deterministic draft + used IDs, never sends). Zod input schemas (shared with MCP in T13),
  empty-string inputs from Rovo ignored, unknown account/ID -> not_found, ambiguous partial
  account names -> asks to disambiguate. `src/agent/handlers.ts` (one log line per call,
  actor from the action context), exported from `src/index.ts`. Prompt in
  `resources/prompts/agent-prompt.txt` (blueprint I rules plus "rules not predictions").
  Manifest: 5 functions (keys <= 23 chars: `fn-*`), 5 action modules with typed inputs,
  `rovo:agent` "Tally Agent" with 4 conversation starters, resource `agent-resource`.
- Verified from the Forge manifest schema (node_modules/@forge/manifest): action variants
  (actionVerb GET/CREATE/UPDATE/DELETE/TRIGGER, <= 10 inputs of type string/integer/number/
  boolean, description <= 255), rovo:agent (name <= 30, starters <= 85), and rovo:mcp
  (`name` <= 30, `tools` = action keys, max 50) - answers V3's manifest-shape question.
- Checks: forge lint clean; 139 tests (10 new: the six-step script O22-O24, input handling
  O27); deployed 6.3.0 (Runs on Atlassian eligible).
- Rovo is not active on usetallyapp (Free plan). Solved without a card: `forge site provision`
  created a Forge demo site with enterprise Jira, Confluence, JSM and Rovo:
  **one-atlas-npei.atlassian.net** (created 2026-11-15, expires 2027-02-13; one per developer;
  the CLI has no extend command). Tally installed there for Jira and Confluence (development),
  demo data loaded.
- Live six-step Rovo chat test on the demo site, all pass (agent calls 0.3-1.8 s):
  1. "Which commitments are at risk?" -> 4 at risk or critical, with IDs (c-nw-export first).
  2. "Why is Northwind's EHR integration at risk?" -> R5 "DEMO-21 is blocked." plus the date
     mismatch, rule text repeated, nothing added.
  3. "Which commitments have no owner?" -> c-acme-sso only.
  4. Pasted Priya promise -> Rovo showed its "Please review" card for the CREATE action
     (account Acme Retail, due 2026-12-12); after confirming, the candidate was in the Tally
     inbox and the agent said a person must confirm it. V4 pass.
  5. "Draft an update for Acme" -> "Hello Acme Retail team, ..." and "nothing has been sent".
  6. "What did we promise Initech?" -> "No commitments were found for Initech." (not_found).
- Fixed after the run: chat-pasted candidates/evidence no longer show an "Open source" link
  (no web source exists); they read "Pasted into Rovo chat".
- Open: Rovo lists two agents, "Tally Agent (Jira)" and "Tally Agent (Confluence)", one per
  installation. Forge storage is per installation (confirmed in T13), so the Confluence one
  sees separate data. Judges' instructions must say to use "Tally Agent (Jira)"; consider whether the
  Confluence install can be avoided or its agent pointed at the Jira data (T13/T19).

### 2026-11-15: T13 Atlassian MCP (done, with a known storage limitation)
- Done: `rovo:mcp` module "Tally" exposing 7 tools (the 5 agent actions plus two MCP-only
  reads: `get-commitment-details`, `identify-at-risk-commitments`). Only write: propose-candidate
  (inbox only, human review). `skill/SKILL.md` for third-party agents (tools table, rules incl.
  "never present a candidate as a confirmed commitment", two worked examples). 141 tests.
  Deployed 6.5.0 (Runs on Atlassian eligible; admin shows the RUNS ON ATLASSIAN badge).
- V3 answered: server URL `https://mcp.atlassian.com/forge/f43c90aa-396f-4774-951c-4f62dc2cd3a9`
  (app id from manifest), OAuth 2.1 for external clients. Admin switch: admin.atlassian.com ->
  org one-atlas-np -> Apps -> Sites -> one-atlas-npei -> Connected apps -> search "tally" ->
  View app details (Jira install) -> TOOLS "Expose tools to MCP-compatible apps" -> Enable
  tools -> Enable. Now **Enabled** on the demo site.
- O25 pass: Rovo Studio (studio.atlassian.com, demo site) Tools catalogue lists "tally" with all
  seven tools and their descriptions. Studio's AI agent builder failed on Atlassian's side
  ("technical issue creating the solution plan"); manual Studio agent not built.
- CORRECTION to an earlier note: storage is NOT shared between the Jira and Confluence
  installations on a site. Each installation has its own Forge KVS. (The earlier "Tally Agent
  (Confluence)" answer was not proof of shared storage.)
- O26 external client: Claude Code (`claude mcp add --transport http tally <url>`, OAuth done by
  Ife) connects ("Connected"), lists all 7 tools and calls them; every call returns a valid
  envelope. But the external MCP endpoint always runs in the **Confluence** installation
  (installContext `ari:cloud:confluence::site/...`), so it reads the Confluence install's storage,
  which has no demo data. Reinstalling the Jira install and re-authorising did not change this
  (and wiped the Jira install's demo data; reloaded via the dashboard afterwards).
- Decision (Ife, option B): keep Tally installed in both Jira and Confluence. Confluence evidence
  and scanning need the Confluence install; multi-app compatibility does not share storage and
  Marketplace only allows it for paid listings. Consequence to document for judges (T19):
  Tally UI and "Tally Agent (Jira)" use the Jira install's data; external MCP clients and
  "Tally Agent (Confluence)" use the Confluence install's data. MCP tools are enabled on both
  installs in admin.
- Possible later fix (not scheduled): a single source of truth, e.g. the Confluence-side
  handlers reading Jira-side data, is not available in Forge without remote storage/egress.

### 2026-11-15: T14 Teamwork Graph (done)
- Validation (GraphiQL step, done in the browser as Ife on the demo site): the TWG gateway
  answers; operation names must look like `company_operation` (`tally_*`); the Jira issue ARI
  is `ari:cloud:jira:<cloudId>:issue/<issueId>` (seen in live results); Cypher is one-directional.
  Docs say raw `cypherQuery` is unavailable to new apps (persisted queries need registering), so
  Tally uses Atlassian's **curated** queries, which need no registration and are in the live schema:
  `jiraWorkItemHierarchy(id, kinds: [PARENT|CHILD|BLOCKS|BLOCKED_BY|LINKED])` and
  `atlassianUserContent(userId, roles: [CREATED], since)`.
- No issue-to-Confluence-page relationship exists in the graph, so pages come from the documented
  fallback: recent pages created by the commitment owner (or the linked issue's assignee).
- Done: `src/graph/client.ts` (GraphClient over an injected GraphHttp; parses results; errors
  map to upstream/forbidden), `src/graph/forge-http.ts` (api.asUser().requestTeamworkGraph; the
  SDK adds X-Query-Context), `src/services/graph.ts` (per commitment: up to 3 live linked issues,
  2 people, owner suggestions only when unowned; demo issues and demo-* owners skipped),
  resolver `getGraphContext`, snapshot gains Jira's numeric `id`. UI: "Related context" section
  on the commitment page with Link (related work), Attach as evidence (opens the Confluence quote
  picker on that page; quote still verified on the page), Make owner (suggestions). Never blank:
  "Graph unavailable: <reason>" with Retry. Scopes added: read:graph:issue:jira,
  read:graph:page:confluence, read:graph:user:atlassian (major 7.0.0, all four installs upgraded).
- Checks: 153 tests (12 new: parsing, empty, GraphQL/HTTP/thrown errors, no-issue, demo-only,
  owner suggestions, id re-read, demo owners never queried). Live on demo site (7.1.0): panel
  loads via the graph for c-acme-sso linked to MC-8; shows the suggested owner (MC-8's assignee)
  and the empty-state lines. Note: c-acme-sso now has MC-8 linked (demo data edited by the test).
- Finding: the demo site's graph has **no** issue-to-issue relations at all (Cypher count 0 for
  child/links/blocks), because its sample issues were bulk-loaded. Related work will show only
  for links made after install. The person-pages query does return real pages (Ife's own pages).
- Proven (Ife's OK): created TD-1 epic "Acme Retail SSO rollout", TD-2 "Build SAML SSO for Acme
  Retail" (child of TD-1) and TD-3 "Security review of Acme SSO design" (child, blocks TD-2) in
  project TD on the demo site. The graph indexed them within ~20 s (parent fully a little later).
  c-acme-sso now links MC-8 and TD-2; its panel shows Parent TD-1 and Blocked by TD-3 with Link
  buttons, plus suggested owners. Some kinds come back null (field-level errors) on other issues;
  treated as empty. Demo-video path: open c-acme-sso -> Related context.

### 2026-11-16: T15 Customer update drafts (done)
- Done: `UpdateDraft` record (core/drafts.ts) stored at `draft:{id}`: draft -> approved -> sent,
  with createdBy/At, editedBy/At, approvedBy/At, sentBy/At, source ui|agent, version, and
  `usedVersions` (commitment versions it was built from). Repo: createDraft (draftUpdate over
  freshly evaluated stored fields), editDraft (draft only; approved/sent text frozen; <=5000
  chars), approveDraft (refused with conflict if any used commitment changed since drafting),
  markDraftSent (approved only; delivered commitments it covers become communicated with a
  history row, section C / O9), discardDraft (not once sent). Resolvers listUpdates, getUpdate
  (draft + "facts used" rows + stale list), createUpdate, editUpdate, approveUpdate,
  markUpdateSent, discardUpdate.
- UI: new "Updates" nav item and screen (list + pane): message box, Save edits, Approve, Copy
  text (disabled until approved; clipboard API, then select+copy fallback, then "press Ctrl+C"),
  Mark as sent, Discard with confirm, "Facts used" list beside the text, audit of who/when.
  "Draft customer update" button on the commitment page opens Updates with the account preset.
- Agent/MCP: draft-customer-update now saves its draft (source agent) to Updates and returns
  draftId; actionVerb GET -> CREATE (it writes a record). Prompt and SKILL.md say so.
- Checks: 163 tests (10 new in tests/updates.test.ts). Deployed 7.5.0.
- Live on demo site (7.5.0): Commitment page -> Updates?account=acct-acme opened the New draft
  dialog preset to Acme; createUpdate made upd-1e4c3a81 (4 commitments, Copy disabled);
  approveUpdate -> Approved, text read-only, Copy enabled; Copy put the text on the clipboard;
  markUpdateSent -> Sent with who/when; "Send migration plan by Friday" moved delivered ->
  Communicated. Logs show each call ok. Note: the demo data now holds this sent update.
- Not yet checked live: Tally Agent creating a draft in Rovo chat (CREATE verb may prompt).

### 2026-11-16: T16 Polish (done)
- Theme: Tally now follows Jira's light/dark theme (`view.theme.enable()` sets
  data-color-mode on <html>); OS setting is only the fallback outside Jira. Verified live: with
  the browser in dark mode, Jira (theme set to light) and Tally both stayed light.
- Tokens: added --on-brand, --on-red, --blue-tint; removed hard-coded #fff and the in-progress
  lozenge colours. White on the dark-mode brand green was unreadable; primary buttons now use
  --on-brand. Contrast check script: all 32 text/background pairs >= 4.5:1 in both themes.
  Amber/orange stay darker than the blueprint proposals for that reason (noted in styles.css).
- Spacing on the 4px grid (10px paddings -> 12px). One focus ring for every focusable element
  (links, summaries, tabindex rows). Hover states on buttons; 150ms transitions; reduced motion
  covers ::before/::after.
- Dialog: focus trap (Tab/Shift+Tab stay inside), focus returns to the opener on close,
  aria-labelledby. Fixed a bug: the effect re-ran on every render (inline onClose), which could
  pull focus back to the first field while typing elsewhere.
- Nav: removed the disabled "Reports" (P1, on the cut list) and "Settings" items that read
  "Coming in a later build step"; active item uses aria-current on the link.
- Microcopy: agent-sourced inbox items say "Suggested by Tally Agent"; no exclamation marks,
  "Oops", "AI-powered" etc. anywhere (grep). Skeletons labelled "Loading".
- Narrow screens: detail title, section heads, form actions and graph rows wrap at 768px.
- Checks: 163 tests, UI typecheck clean, deployed; dashboard and commitment page checked live.
- Gap noted: F10 Settings screen was not built; added right after (next entry).

### 2026-11-16: F10 Settings screen (done)
- Connections: live checks as the viewing user - Jira (`JiraClient.access()`, mypermissions),
  Confluence (page search), Teamwork Graph (`GraphClient.ping()`, echo). Each shows Connected
  or Not reachable with the reason. Rovo agent and MCP row with the MCP URL (Copy) and where an
  admin turns on external access.
- Risk rules: thresholds (due soon, unowned hours, no delivery work, stale days), blocked status
  names, tier -> priority mapping. Admins edit (`saveRuleSettings`, admin-checked server side,
  validated by RuleConfigSchema); others see read-only values. "How each rule reads" shows
  describeRules with the current values.
- Data (admins): Export all as JSON (`exportData`, admin only; download attempt plus a text box
  fallback), Load demo data when empty, Delete all data behind typing the site host name.
- Not built: scan-scope defaults and the "include comments" toggle (nothing reads them yet).
- Checks: 167 tests (4 new in tests/settings.test.ts). Live on demo site: all three
  connections Connected; rules editable as admin; Export filled the JSON box. Delete not
  exercised live (would wipe demo data); covered by the existing deleteAll test.

### 2026-11-16: T17 Tests and permissions (section O matrix)
- New: `tests/resolvers.test.ts` runs the real resolver definitions with Forge modules mocked
  (in-memory KV, fake Jira whose ADMINISTER answer is set per test). Non-admins can use every
  everyday screen; seed, reset, export and rule changes are refused `forbidden` by the server
  and change nothing; admins can do them; every resolver refuses a call with no accountId;
  missing ids are envelopes; no UI file uses dangerouslySetInnerHTML/innerHTML (O33).
  Added @types/node (dev) for that test. 173 tests, 14 files, typecheck clean.

| O | Case | Status | Where |
|---|---|---|---|
| O1-O7 | Risk rules R1-R9, health, acknowledgement | Pass | risk.test, risks.test |
| O8 | Cancel without reason refused | Pass | lifecycle.test, storage.test |
| O9 | Delivered -> communicated needs sent update | Pass | lifecycle.test, updates.test; live T15 |
| O10 | Agent snippet never auto-confirmed | Pass | agent.test, scan.test; live T12 |
| O11-O12 | Discussion class; duplicate warning with score | Pass | discovery.test |
| O13-O14 | Validation no write; stale version conflict | Pass | engine.test, storage.test |
| O15 | Link existing issue, live status | Pass (live) | T08 on usetallyapp; MC-8/TD-2 on demo site |
| O16 | Issue user cannot see -> no access, not cached | Pass | jira.test |
| O17 | Create issue after confirmation | Pass (live) | T08 |
| O18 | Issue deleted after linking | Pass | jira.test |
| O19 | Confluence quote saved with page link | Pass (live) | T09 |
| O20 | Restricted page/space skipped, no crash | Pass | confluence.test, scan.test |
| O21 | Scan cap 50, cursor resumes | Pass | scan.test |
| O22-O24 | Agent six-step script, unknown account, errors | Pass (live) | agent.test; Rovo chat T12 |
| O25 | MCP tools in Rovo Studio | Pass (live) | T13 |
| O26 | External MCP client | Pass with documented limitation | T13 (reads Confluence install's storage) |
| O27 | Invalid MCP parameter -> structured error | Pass | agent.test |
| O28 | Graph related items | Pass (live) | T14: TD-2 shows parent TD-1, blocked by TD-3 |
| O29 | Graph denied -> reason shown, page works | Pass | graph.test (unavailable path) |
| O30 | Copy disabled before approval | Pass (live) | T15 |
| O31 | Draft facts only from stored IDs | Pass | engine.test, updates.test |
| O32 | Non-admin views; admin actions hidden/refused | Pass | resolvers.test (server refuses); live on demo site as a second user (Jira/Confluence "User", no admin): dashboard, data and Settings load, all calls ok; rules read-only, no Save, no export/load/delete, no demo controls |
| O33 | Quote with HTML shown as text | Pass | discovery.test, resolvers.test |
| O34 | Delete all data | Pass | storage.test, updates.test (live not pressed: would wipe demo) |
| O35 | Empty/loading/error states on every screen | Pass (code review) | every screen uses Skeleton/ErrorBanner/EmptyState |
| O36 | Fresh site via installation link | Pass | T19: tally-judge-test.atlassian.net as a second account |

- Known issues (documented, no open P0 failure in code):
  1. External MCP clients read the Confluence installation's storage (separate from Jira's);
     the Tally UI and Tally Agent (Jira) use the Jira installation's data (T13, option B).
  2. Teamwork Graph has no relations for bulk-loaded sample issues; only links made after the
     site was set up show (TD-1..3 created for the demo).
  3. Tally Agent creating a draft (now a CREATE action) not yet run live in Rovo chat.
  4. (Closed) O32 checked live 2026-11-16 with a second account invited to the demo site as a
     basic Jira and Confluence user (group jira-users-one-atlas-npei, no admin access). No
     per-user consent prompt appeared for Tally.

### 2026-11-16: T18 Marketplace submission (pack ready; partner steps are Ife's)
- Requirements (developer.atlassian.com/platform/marketplace, read 16 Nov): partner (vendor)
  profile at marketplace.atlassian.com/manage/vendor/create; a "Partner Verification" ticket with
  Stripe Identity (ID + selfie) and the Partner Security Questionnaire, due within 14 days, applies
  to free apps too; security contact with an ecosystem.atlassian.net account; Privacy & Security
  tab; scope justification. Review "usually 5-10 business days to start" -> start the partner
  steps now to have a ticket URL by 8 Dec.
- Warning: once listed, the app can no longer be distributed from the developer console. Judges'
  install link (T19) needs a plan: a separate, unlisted copy of the app for judging, or rely on the
  listing. Decide in T19 before linking the app.
- Name: "Tally for Jira" collides with "Tally — Epic & Sub-task Progress for Jira" (Datum) on the
  Marketplace. Draft uses "Tally Commitments for Jira" (pending Ife's choice).
- Checks: `npm audit` 0 vulnerabilities (app and UI); manifest has no egress; the UI bundle loads
  nothing external (URLs inside it are library strings only); Runs on Atlassian eligible.
- Prepared in `docs/marketplace/`: listing.md (all fields within limits, counted), privacy-policy.md,
  support.md, user-guide.md, security-and-privacy-answers.md (Privacy & Security tab, scope table,
  how each security requirement is met), assets/logo-144.png, assets/banner-1120x548.png.
  EULA: Atlassian's standard customizable end-user agreement.
- Decided (Ife): listing name "Tally Commitments for Jira"; docs on GitHub Pages; support and
  security contact ifeoluwaadegbulugbe@gmail.com.
- Published (public repo github.com/ifeoluwaadegbulugbe/tally-commitments-docs, docs only, no
  source): https://ifeoluwaadegbulugbe.github.io/tally-commitments-docs/ with /privacy-policy,
  /user-guide, /support (all HTTP 200, checked 16 Nov). The listing and answers files now point
  at these URLs.
- Open: highlight screenshots (1840 x 900) from the demo site; partner profile + verification and
  ecosystem.atlassian.net account (Ife); then link the app, fill the listing, submit, save the
  ticket URL.

### 2026-11-16..18: T19 Share link and judge install (done)
- Decision: this app (f43c90aa..., the one verified with the agent, MCP and graph) is the judging
  app and keeps the share link. Listing an app on Marketplace disables its link (console note:
  "once ... submitted for listing on Marketplace, it can't be shared via installation link"), so
  the Marketplace listing (T18) will use a separate registered copy. MCP_URL in
  src/resolvers/index.ts is per app id; change it in that copy.
- Deployed to **production** (2.0.0, Runs on Atlassian eligible; Ife approved). Developer console
  > Distribution: "Sharing with anyone"; company "Independent developer"; support, privacy and
  terms URLs set (GitHub Pages; Atlassian standard EULA); "Stores personal data?" No (account IDs
  live only in Atlassian-hosted Forge storage, not our own systems). Install link for Confluence
  and Jira saved in docs/install-link.txt and README (plus a Jira-only variant).
- O36 tested as a stranger: Ife created tally-judge-test.atlassian.net (free Jira, premium trial
  by default) as the second account (no rights on our other sites). Install page shows vendor,
  privacy policy, support and all ten permissions. Findings:
  - One install adds Tally to Jira **and** Confluence; the site picker then lists only sites
    with both products ("No options" otherwise). The Jira-only link listed the new site.
  - Installed ("Success, this app was installed!"), Apps > Tally opened the empty dashboard,
    Load demo data gave 8 open / 4 at risk / 1 overdue / 1 no owner as the README says.
    Settings: Jira and Teamwork Graph Connected; Confluence "Not reachable" with the reason
    (site has no Confluence).
- README judge steps rewritten to the tested flow. Not done: adding Confluence to the test site
  (the admin "Add app" control did not respond in the narrow pane); install page shows the app
  as lowercase "tally" with a default icon: rename to "Tally" and upload the logo in the
  developer console app settings.

### 2026-11-20: T20 Media and Devpost (prepared; recording is Ife's)
- docs/DEMO.md: 2:50 script in eleven beats following blueprint 17/Q, adapted to what runs
  (Teamwork Graph via curated queries on TD-2; MCP beat shows the tools, not a data answer,
  because external calls read the Confluence installation's empty storage). Pre-recording reset
  steps and a screenshot list.
- docs/DEVPOST.md: every Devpost field (blueprint R), bonus write-ups, honest limits. Open:
  YouTube link, public repo link, Marketplace ticket link.
- Source published 2026-11-20: https://github.com/ifeoluwaadegbulugbe/Tally (public, main).
- 2026-11-20: demo video and gallery made from live captures of the demo site (reset + Load demo
  data first): media/tally-demo.mp4 (1920x1080, 2:55, 22 beats, Windows "Zira" narration, captions,
  no music) and media/gallery-1..6.png (1500x1000, 3:2). Rebuild with tools/demo-video
  (beats.json = script, tts.ps1 = narration, build.py = frames + ffmpeg). The Rovo agent beats are
  real: it answered with IDs and rule reasons, and the CREATE action showed Rovo's "Please review"
  card before adding the inbox candidate.
- Issue found while recording, then fixed: the Related context panel showed no parent/blocker
  for TD-2 although the graph had them. After forge login, a temporary log showed the app's call
  now returning parent TD-1 and blocked-by TD-3, with no code change: the graph intermittently
  answers with every relation empty. Fix: GraphClient.relatedWork asks once more (after 1.2 s)
  when every relation is empty, and the empty message has a "Check again" button. 175 tests (2 new).
  Deployed to development and verified live (Parent TD-1, Blocked by TD-3, with Link). The video's
  graph scene and gallery-4 now use that capture. Production deploy waits for Ife's OK.
- Open: upload the video (Public), add the gallery to Devpost, submit.

## Deviations from the blueprint (decided while building)
- `Commitment` gained `confirmedAt`, `assignedAt`, `confirmedDueDate`, `priorityOverridden`:
  R3, R4 and R7 need them, and H5's interface did not carry them.
- `evaluateRisks(c, { issues, evidenceCount }, now, cfg)`: R8 needs the evidence count,
  so the context is an object rather than a bare issue list.
- R2 only fires when a linked issue is not Done (as specified). A promise due in 2 days
  with no linked issue shows R4 or R3 instead, not R2.
- `extractDate` only returns explicit calendar dates. "by Friday" yields null, per section D
  ("if the date is not in the text, the field is null").
- Demo data adds one commitment ("Share completed security questionnaire", Acme, no
  evidence) so R8 appears; Brightfield training has a moved date (R7). With these, all nine
  rules fire on seed data. Dashboard on seed: 8 open, 4 at risk, 1 overdue, 1 unowned.
- Customer drafts never include Jira keys, owners or rule reasons; at-risk items read
  "we are reviewing the {date} date".
- Dev tooling: Vitest 5 and Zod 4 (older versions failed `npm audit`).
- The `jira-global-page-custom-ui` template ships Create React App on React 16; replaced with
  Vite + React 18 + TypeScript per H1. Its AGENTS.md (UI Kit only) was not kept: the blueprint
  chose Custom UI.
- `static/ui/package.json` overrides `prosemirror-view`, `glob`, `minimatch` to patched
  versions. All three come in through `@forge/bridge` 7.3.0 (latest); none is in the browser
  bundle (bundle hash unchanged). Remove the overrides when the bridge updates them.
- Root `tsconfig.json` must not set `noEmit`: Forge's ts-loader reads it to bundle functions.
- Storage uses plain KVS keys with prefix queries, not custom entities (the H6 fallback):
  simpler, and lists are filtered in memory, fine at hundreds of commitments. Plain keys have
  no conditional writes, so the version check is read-compare-write (catches stale UI edits;
  two saves in the same instant could still race). Page and batch sizes are 20 until V5
  confirms the real KVS limits.
- Unchanged risk signals are not rewritten on evaluation; `evaluatedAt` therefore means
  "first fired" for a still-active signal.
- Root `package.json` also overrides `glob`/`minimatch` (via `@forge/kvs` -> `@forge/api`).

## Validation log (week 1: fill in pass / fail)
| ID | Check | Result | Notes |
|----|-------|--------|-------|
| V1 | GraphiQL query at `https://<site>.atlassian.net/gateway/api/graphql/twg` | | |
| V2 | Work-item to page relationship type exists | | |
| V3 | `rovo:mcp` manifest shape, admin switch, real URL | | |
| V4 | Agent invokes a CREATE action reliably | | |
| V5 | KVS query and size limits fit the model | | |
| V6 | Function time limit and scan paging | | |
| V7 | Hash routing inside the Jira global page | | |
| V8 | Jira search path and blocked-status detection | | |
| V9 | Marketplace category options and review process | | |
| V10 | Name conflict check for "Tally" | | |

## Task cards
| ID | Task | Status |
|----|------|--------|
| T01 | Environment: Node LTS, Forge CLI, login, dev site, Forge + ADS MCP servers | partly done: dev site + MCP servers left |
| T02 | Validate risky APIs (V1, V3, agent hello world) | todo |
| T03 | Scaffold Jira global page Custom UI, deploy, install | done: installed on usetallyapp.atlassian.net (dev env), dashboard renders |
| T04 | Partner paperwork (L1 to L4) | todo (Ife) |
| T05 | Core engine + tests | done |
| T06 | Storage layer (KVS) | done |
| T07 | UI shell, Accounts, Commitments, Detail | done |
| T08 | Jira integration | done |
| T09 | Confluence evidence | done |
| T10 | Scan and Inbox | done |
| T11 | Risk and Dashboard screens | done |
| T12 | Rovo agent | done (live on demo site) |
| T13 | MCP | done; external MCP reads Confluence install's storage (option B) |
| T14 | Teamwork Graph | done (live: TD-2 shows parent TD-1, blocked by TD-3) |
| T15 | Update drafts UI | done (live: draft, approve, copy, sent, communicated) |
| T16 | Polish | done, plus F10 Settings screen |
| T17 | Tests and permissions | done; 35/36 pass, O36 (install link) belongs to T19 |
| T18 | Marketplace submission | pack ready; partner signup and verification are Ife's |
| T19 | Share link | done; stranger install on a fresh site works (O36) |
| T20 | Media and Devpost | script, text and public repo ready; video and submit open |
