# bd-board UX/DX review (2026-10-28)

**Summary**
1. The Hierarchy page draws every bead the same way: every parent starts expanded, a closed row looks like an open one, and you can't filter it. At "All" it is 15,500 px tall, so it is a long list rather than a map of what is scoped, in flight and done.
2. "Blocked" means two things. The Blocked column, the sidebar and the epic bars all say 0, but `bd blocked` reports 19 beads waiting on open dependencies, and the cards show red ⊘ counts.
3. The scoped-but-not-broken-down epics (P4 to P8, "needs owner") don't appear on the Board's Epics view at all, and in Hierarchy they show no cue. Those are exactly the "what is scoped" answers the owner is looking for.
4. Nothing shows what changed since your last look, and a comment doesn't bump `updated_at`: ldb-b6n.26 reads "updated 8d ago" next to a comment from 6 hours ago.
5. The comment box is the channel from you to the agents, but nothing explains how it reaches them. It is offered on closed beads that agents won't re-read, and every comment, human or agent, is signed "KN".

Method: ⚠️ partly degraded. I ran Assessment A (design review, live app plus source) myself because I am already a subagent. Assessment B (`impeccable detect`) ran in its own isolated subagent and found 1 issue, a likely false positive (`side-tab` on the epic card's 2px left marker, bead-card.tsx:175). I did not inject the browser overlay or save an `.impeccable/critique` snapshot, because the repo had to stay read-only. The app was on branch `feat/board-ux` (ages on cards and the modal, and the closed window, were already live). I left out what the builder is already doing (ages on cards and the modal, closed-by-recency, hiding done epics, epic progress bars, light-mode contrast).

Screenshots are in this folder: `01-` dashboard, `02-` board epics, `03-` board status, `04-` hierarchy (7d), `04b-` hierarchy (All), `05-` knowledge, `06-/07-/08-` modal, `09-` hierarchy at 420px. Each comes in light and dark where both exist.

## Heuristic scores (Nielsen, 0-4)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Blocked=0 while 19 are dependency-blocked; comment activity doesn't change "updated" |
| 2 | Match with the real world | 2 | "Blocked" is used for the status field only; "No structured comments", "240 older hidden" |
| 3 | User control | 3 | URL state everywhere, Esc closes the modal; expand state is lost on refresh |
| 4 | Consistency | 2 | Three controls named "Priority" in one row; Open count 145 on the dashboard vs 129 on the Epics board |
| 5 | Error prevention | 3 | Read-only mode is enforced on the server; status select is one click in the modal |
| 6 | Recognition over recall | 2 | Edges shown as icon-only `⊘ 0 ⟡ 0 ⇔ 0`; hierarchy rows don't say status |
| 7 | Flexibility / efficiency | 1 | No keyboard shortcuts anywhere (no keydown handlers in src/), 199 tab stops in Hierarchy |
| 8 | Aesthetic / minimalist | 3 | Calm and dense, but 30 label chips are always visible |
| 9 | Error recovery | 2 | "bd not found (tried: …)" with no fix |
| 10 | Help | 1 | No in-app hint for the knowledge prefixes, artifacts, or how agents read comments |
| | **Total** | **21/40** | Acceptable: a solid base, but the overview job isn't served yet |

## Findings (ranked)

### 1. HIGH: A Hierarchy row doesn't say what state the work is in
- **Evidence:** `04b-hierarchy-all-closed-light.png` (ldb-404's 38 closed children look the same as open rows), `04-hierarchy-light.png` (closed ldb-b6n.35 is the first child under an open epic). hierarchy-view.tsx:85-111: the only status signal is a 6px dot (`size-1.5`). There is no age, assignee, label, dependency or comment signal. Deferred beads (5 of them) get the same grey dot as open ones, through `mapStatus` → `open`.
- **Problem:** You can't scan 400 rows by colour dots, so "what's in flight under this epic?" means opening beads one by one.
- **Fix:** Give rows one anatomy (see mockups §1 and §2):
  - status glyph *with shape* (○ open, ◐ in progress, ⧗ waiting, ✓ closed, ‖ deferred)
  - id, priority, title, up to 2 label chips
  - a right-aligned meta strip in fixed columns: "waits on ldb-b6n.8", 💬 count, assignee initials, updated age
  - closed rows at 55% opacity with the title struck through (or muted)
  - in-progress rows with a 2px tint
- **Effort:** M

### 2. HIGH: Everything is expanded, unordered and forgotten
- **Evidence:** hierarchy-view.tsx:49 `useState(true)` on every node, so state is lost on refresh and on tab switch. Children keep `bd list` order (tree.ts:4-13, not sorted). Roots are sorted only by priority, so loose tasks and epics are interleaved (`ldb-0x3`, `ldb-2gf` before the epics). The completed epic ldb-404 is expanded with all 38 closed children (`04b`). The scroll height measured 15,494 px at Closed=All, with 199 focusable buttons.
- **Problem:** The page becomes a scroll-and-search exercise, and the shape of the project (which epics are alive) is never visible.
- **Fix:**
  - Default rule: expand an epic only if it has in-progress or waiting work. Collapse complete and dormant epics to a one-line summary ("R3: typed primitives · ✓ done 16d ago · took 36h · 38").
  - Order children in-progress → waiting → open → closed. Fold an epic's closed children into a "43 closed ▸" row.
  - Put loose tasks under a "No epic" group at the bottom.
  - Persist the expanded set per project in localStorage and add "Collapse to epics / Expand in-flight" buttons.
- **Effort:** M

### 3. HIGH: Hierarchy has no search, label, ready or assignee filters
- **Evidence:** p.$project.tsx:341 renders `BoardHeader` only when `tab === 'board'`. Lines 399-413 pass unfiltered `beads` to `HierarchyView`, and the only control is the closed window.
- **Problem:** You can't ask "show me the comms work" or "what needs owner?" in the one view built for structure. Filters you set on Board vanish when you switch tabs, even though they stay in the URL.
- **Fix:** Reuse the same URL params (q, l, ready, assignee) in Hierarchy. A matching bead renders with its ancestor path (ancestors dimmed, non-matching siblings hidden), plus a "12 matches in 4 epics" line. Effort: M (the filter logic already exists in `beadMatches`).

### 4. HIGH: "Blocked" shows 0 while 19 beads are waiting on open dependencies
- **Evidence:**
  - `03-board-status-light.png`: Blocked column 0, sidebar Blocked 0, yet cards ldb-0x3, ldb-2gf and ldb-b6n.3 carry red ⊘ badges.
  - `bd blocked --json` in a real project returns **19**, for example ldb-b6n.10 and .11 (wait on .8), ldb-b6n.3 (in progress, waits on .1), and the whole P4→P5→P6→P7→P8 chain.
  - Epic bars say "0 blocked" because `descendantStats` counts status only (epics.ts:44).
  - App "Ready" is 120 but `bd ready` gives 124; `isReady` (sort.ts:61-66) treats any `blocks` link as blocking, apparently even when the blocker is closed (I didn't verify this per bead).
- **Problem:** The two numbers the owner most needs ("what is stuck?", "what can an agent pick up?") are wrong or disagree with `bd`.
- **Fix:**
  - Derive a *waiting* state: not closed, with at least one `blocks` dependency whose target isn't closed. Show it as a sub-count ("Blocked 0 · Waiting 19") in the column header, the sidebar and the epic breakdown.
  - On cards, say "waits on ldb-b6n.8" instead of a bare ⊘ number.
  - Prefer `bd ready` / `bd blocked` as the source of truth for the two quick filters.
- **Effort:** S-M

### 5. HIGH: Scoped epics without tasks disappear from the Board
- **Evidence:** ldb-hpp, ldb-7f8, ldb-f3h, ldb-4bt and ldb-kxl (P4 to P8, all "needs owner", created 18d ago) never appear on `/p/a real project` in the Epics view: 0 text matches in the DOM. board-swimlanes.tsx:375-381 with `keepEpicLane` (sort.ts:131-137) drops any lane with no matching children. In Hierarchy they render with no progress and no cue (`04-`, ldb-4bt / ldb-7f8 rows), because `EpicProgress` returns null when total is 0 (epic-progress.tsx:29).
- **Problem:** "What is scoped but not started" is half of the owner's question, and the Board hides it entirely.
- **Fix:** Add one slim group on the Epics board, "Scoped, not broken down (5)", listing title · age · "waits on P4" ordered by the dependency chain. In Hierarchy, add a "no tasks yet · scoped 18d ago" chip. Effort: S

### 6. MED: No "since you last looked" cue, and comments don't count as activity
- **Evidence:** ldb-b6n.26 modal (`06-modal-comment-light.png`) shows UPDATED 8d ago, but its comment is "about 6 hours ago". Nine agent comments landed in the last 5 hours (`05-knowledge-light.png`) and none of them shows up on Board or Hierarchy.
- **Problem:** The owner comes back after hours away and can't tell what agents did: what closed, what got comments, what changed status.
- **Fix:**
  - Store `lastSeen[project]` in localStorage when the tab is hidden or closed.
  - Compute activity as max(updated_at, closed_at, latest comment created_at). The project-comments feed behind the Knowledge tab already has comment timestamps.
  - Show a dismissible band: "Since Mon 21:40: 9 commented · 2 closed · 3 new" (the real counts for the last ~26h), where each part is a filter. Add a small accent dot on changed rows.
  - See mockups §1.
- **Effort:** M

### 7. MED: The comment box doesn't explain how agents receive it
- **Evidence:**
  - bead-detail-modal.tsx:1099-1127: the bare "Add a comment..." textarea also appears on closed beads (`06-modal-task-light.png`, ldb-kst.38 closed).
  - Every comment in `05-knowledge-light.png` is signed "KN", including the agent-written "Cleanup 2026-10-27: …" notes, so human and agent voices can't be told apart.
- **Problem:** The owner can't tell whether feedback will be seen. A comment on a closed bead probably never will be. Agents also can't tell which comments are owner instructions.
- **Fix:**
  - Under the box, add "Agents read this the next time they open the bead (`bd show ldb-kst.38`)".
  - On closed beads, swap the button for "Comment and reopen" next to a plain "Comment".
  - Prefix human comments with a fixed marker (for example `OWNER:` or a configurable author) so agents can grep for them, and render a "you" or "agent" tag.
- **Effort:** S

### 8. MED: Three controls called "Priority" and 30 label chips crowd the Board toolbar
- **Evidence:** `02-board-epics-light.png`. The row has a "Priority" group-by toggle, a "Priority" filter button and a "Priority" sort button (board-header.tsx:65-68, ~243). Below it are two always-visible rows of 30 label chips, including 9 `phase-P*` chips.
- **Problem:** You have to hover to know which Priority you're about to change. The chips cost about 70 px of every Board view.
- **Fix:** Label them "Group: Priority", "P0–P1 ▾" (showing the active filter) and "Sort: Priority". Show the top 8 labels plus "+22 ▾", and keep selected chips pinned. Effort: S

### 9. MED: The epic modal buries open work under closed subtasks
- **Evidence:** `07-modal-epic-light.png` (ldb-b6n, 71 subtasks). The first 13 rows are all CLOSED, and the open ldb-b6n.26 is about the 16th. Ids wrap onto two lines ("ldb-\nb6n.48").
- **Problem:** On the epic, the most important page for "distance to done", you have to scroll past finished work to find what's left.
- **Fix:** Sort subtasks in-progress → waiting → open → closed and collapse closed into "43 closed ▸". Set `whitespace-nowrap` on the id. Effort: S

### 10. MED: The dashboard project card layout is broken (light and dark)
- **Evidence:** `01-dashboard-light.png`: the path spills out of the card, the progress ring and legend sit outside it, and the legend numbers overlap ("274" over "7", "0" over "145"). project-card.tsx:116 is `relative flex h-full items-start gap-3`, a row layout, so the header, bar and legend sit side by side. The bug is on `main` too.
- **Fix:** Add `flex-col` (and `items-stretch`) on line 116. Effort: S

### 11. MED: The Knowledge tab gives half the screen to an empty panel that doesn't teach its convention
- **Evidence:** `05-knowledge-light.png` shows "KNOWLEDGE 0 · No structured comments." The trigger prefixes (`LEARNED:`, `DECISION:`, `FACT:`, `PATTERN:`, `INVESTIGATION:`, `MUST-CHECK:`, `DEVIATION:`, knowledge.ts:3-11) aren't mentioned in the UI or the README. Comment cards show only the id, not the bead title.
- **Fix:** Make the empty state an example: `bd comments add ldb-x "DECISION: …"`, with the 7 prefixes and their hints (KNOWLEDGE_TYPE_HINT already exists). Show the bead title under the id. When knowledge is empty, let the comments column take the full width. Effort: S

### 12. MED (DX): The README and .env.example have drifted from the code
- **Evidence:**
  - `.env.example` still sets `BD_ROOTS=~/Code`, while README.md:151 says "`BD_ROOTS` is no longer used".
  - README.md:7 says it "discovers bead-enabled repositories on disk", and README.md:27 says "under the configured roots". Discovery is actually the explicit registry.
  - README.md:203 has an empty `## Safety Model` heading; its paragraph is stranded at line 220, after the E2E section.
  - The `metadata.artifacts` convention is buried in one long feature bullet (line 18).
  - There's no section for agents.
- **Fix:** Fix the drift. Add a short "For agents" section with the three conventions an agent needs: attach an artifact (`bd update ID --set-metadata artifacts='[…]'`), record knowledge (the prefixes), and how owner comments are marked. Add a minimal `projects.json` example covering readonly and filterLabel. Effort: S

### 13. LOW (DX): Errors for a missing or old `bd` don't say how to fix them
- **Evidence:** bd.ts:80 and :226 throw `bd not found (tried: bd, /opt/homebrew/bin/bd)`. The version floor (1.3.0) only shows as a live-updates tooltip (bd-version.ts:46-49), not on the dashboard. I did not trigger these states.
- **Fix:** Show a dashboard diagnostic card: "bd not found. Install bd ≥ 1.3.0 or set BD_BIN in .env.local (now: …)". Put the detected bd version in the rail footer. Effort: S

### 14. LOW: No keyboard model in the tree or on the board
- **Evidence:** In Hierarchy there's no `role="tree"`/`treeitem`, 199 sequential Tab stops, and no arrow-key handling. There are no keydown handlers anywhere in src/ except the dnd-kit sensors.
- **Fix:** Use a roving tabindex: ↑/↓ moves, →/← expands or collapses, Enter opens the modal, `/` focuses search, `j`/`k` steps through beads inside the modal. Effort: M

### 15. LOW: Narrow widths, number mismatches and small copy
- **Evidence:**
  - `09-hierarchy-phone-dark.png`: at 420 px the rail doesn't collapse, titles shrink to one character and the tabs are clipped.
  - The dashboard says Open 145 / Closed 274, but the Epics board says 129 / 265 (epic beads aren't counted in columns, and nothing says so).
  - "240 older hidden, show all" is 11px text with no clear button affordance.
  - The theme toggle is three unlabeled icon buttons.
- **Fix:**
  - Auto-collapse the rail below `md` and drop the id column at narrow widths.
  - Explain the count difference with "(+N epics)".
  - Rephrase the closed-window note as a button: "Show 240 closed before Oct 21".
- **Effort:** S

## What I did not look at
- Create, edit, delete, drag, comment submission and the status select: I didn't click any write control, so their flows, feedback and errors are unreviewed.
- Read-only projects (none registered), the Tauri desktop shell, first run with an empty registry, and the bd-missing or bd-too-old states. These were reviewed from code only.
- Artifact rendering beyond the list row (I didn't open the spec viewer), and knowledge entries (there are none in this project).
- Screen-reader announcements, and contrast measured beyond spot checks. One dark-modal capture first looked light; I re-captured it and confirmed through computed styles that it is dark, so it is not a bug.
