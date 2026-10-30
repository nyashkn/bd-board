# bd-board: should it have tabs? Assessment A (design review)

Date 2026-10-30. Live app at http://localhost:3111 (project `a-private-project-copy`, read-only), source at `libraries/bd-board` (HEAD 24b6da1). Screenshots are in this folder (`01-` … `15-`).

Method notes:

- Chrome would not resize: the window is maximised at 1865 css px. I emulated 1440 and 900 by putting the app in a same-origin iframe of that width (`13-`, `14-`, `15-`).
- Data note: the brief says 57 beads and none closed. That is `bd list`'s default view, which hides closed beads. The copy holds 174 beads, 117 of them closed (`bd list --all`). The app counts three different totals: dashboard "153 beads", rail "183", Board "115 closed".

---

## Verdict: no tabs. Make bead links real links and stop losing context

**No to browser-style open-bead tabs. No to workspace (project) tabs.** Fix the six context-loss defects below, then ship the palette with Recent.

The reasons, from the journeys:

1. **Most of the pain is lost state, not too few slots for open beads.** In five of the six journeys the user loses their place:
   - focus drops to `<body>` after closing a bead
   - Board→Hierarchy drops the search
   - lane collapse and scroll reset when you switch view
   - Back reopens a bead you closed
   - there is no copy-id control

   A tab strip fixes none of these. Each tab would inherit the same bugs.

2. **bd-board already has the backbone tabs would give.** `?bead=<id>` is pushed to history (`p.$project.tsx:282`), and I verified Back steps through epic→task→blocker. Deep links open the bead in about 1.7 s warm. Hierarchy expand state persists per project. The missing piece is that **cards are `<button>`s, not `<a href>`s**, so Cmd-click and middle-click can't open a bead in a browser tab. Turning cards into links gives real tabs for free: the browser's own, with its own back stack, pinning and window tiling.
3. **Side-by-side compare (journey 3) is the one real gap, and tabs don't solve it.** Tabs show one bead at a time. Comparing needs two panes, which is a split or peek pane, not a strip.
4. **Workspace tabs duplicate the rail.** One project is registered, and the rail already lists projects with counts. At 900 px the topbar already truncates the project name to "Do…" (`13-board-900.png`), so a second strip has no room. The topbar also already _is_ a `role="tablist"` (Board/Hierarchy/Knowledge). Adding bead or workspace tabs would put tabs inside tabs, which confuses Jordan.
5. **Cold loads are slow.** A full page load spends 3–6 s in a skeleton: one `_serverFn` took 5,596 ms and another 2,985 ms (`02-`). Every in-app "new view" that remounts the route pays this. Browser tabs pay it once and then keep their state, which is another reason to lean on them rather than build in-app views.

Revisit workspace tabs only if the owner works in 3 or more projects every day. Even then, start with "restore the last view per project" when switching from the rail (S).

---

## Journeys, step by step

| #   | Journey                                             | Steps taken (clicks)                                                                                                                                                                                                                                                                                                              | Where state or context was lost                                                                                                                                                                                                                                                                                                                                                                                                          | What fixes it best                                                                                                                                                                                       |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Morning triage: what changed, blocked, mine         | Board load (3–6 s skeleton) → since band (didn't show; last visit was a minute earlier) → rail **Blocked 27** → rail **Assigned to me** (pick KN in a select first)                                                                                                                                                               | **Blocked** isn't a filter: it switches Group to Status (`?view=status`). The column then shows "27", but the epics view says "23 +4 epics" and the dashboard says "30 Blocked". **Assigned to me 46** led to "No beads match the filters" (`05-`): all 46 KN beads are closed, and the 7d window hides them with no hint. Each rail link _replaces_ the search (`project-rail.tsx:362-385`), so Blocked→Assigned dropped `view=status`. | Fix the counts and the empty state; rail links merge into the search instead of replacing it. Tabs: irrelevant.                                                                                          |
| 2   | Epic → task → description/comments → blocker → back | Hierarchy (my `q=lead` search was dropped on tab switch, `06-`) → expand ex-3 → expand ex-4 → click ex-5 (modal) → click blocker ex-6 (modal swaps in place, `09-`) → Back → Back                                                                                                                                                 | Back works (history 9→10, two Backs return to the tree, expand state kept). **But:** no "← ex-5" trail inside the modal; Esc dumps focus to `BODY` instead of the ex-5 row, so j/k restart from the top; closing **pushes** history, so Back after Esc _reopens_ ex-6. The modal dims the whole tree (`15-`), so you can't see where the blocker sits.                                                                                   | Restore focus and close with `replace`; add a visited-bead trail in the modal header; later, a peek pane that leaves the tree visible. Tabs: no help.                                                    |
| 3   | Compare two beads (different epics)                 | Only one modal can be open. The workaround is copying the URL into a second browser tab by hand: Cmd-click a card does nothing special (cards are buttons).                                                                                                                                                                       | Can't do it in-app.                                                                                                                                                                                                                                                                                                                                                                                                                      | **Cards as links** (Cmd-click → browser tab, tile the windows): S. A peek pane with "pin" for true side by side: L. Tabs: no, they show one at a time.                                                   |
| 4   | Hand a bead to an agent                             | Open bead → the id `ex-6` in the header is plain text; "BD COMMAND `bd show … --json`" is a `<p>` with no copy (`bead-detail-modal.tsx:1459`). The "nudge" copy button sits under the comment box, which is hidden in read-only. → drag-select the id → Esc → focus lost                                                          | Copying takes a manual text selection inside a dialog. In read-only mode there are no copy controls at all. Returning drops keyboard position.                                                                                                                                                                                                                                                                                           | Copy button on the id chip and the bd command; a `c` key copies the focused card's or open bead's id; restore focus. Tabs: no help.                                                                      |
| 5   | Find a bead seen yesterday                          | `/` → type. Board search matches **id + title only** (`sort.ts:91-95`). Description and comment text are searchable only in Knowledge's _separate_ search box (`12-`). Closed beads outside the window are hidden, though "Show 5 closed before 23 Oct" does appear (`11-`, good). Keys typed during the 3–6 s skeleton are lost. | No Recent list. You have to remember words from the title, or the id.                                                                                                                                                                                                                                                                                                                                                                    | **Palette Recent + description/comment search.** This is the strongest case for the palette. Tabs only help if you never closed the tab.                                                                 |
| 6   | Work across 2+ projects                             | Rail project link → `/p/<id>` with only `closed` kept; filters, view and scroll from the other project are gone. Each project is a separate `['beads', project]` query loaded on visit.                                                                                                                                           | Switching projects is a cold load plus a fresh view.                                                                                                                                                                                                                                                                                                                                                                                     | Restore the last search per project (localStorage, S). The palette finds beads across projects (but see the palette review: the data isn't in memory today). Workspace tabs: not justified at 1 project. |

---

## Nielsen heuristics

| #   | Heuristic                                   | Score     | Key issue (evidence)                                                                                                                                                              |
| --- | ------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Visibility of system status                 | 2         | Blocked shows 27 (rail), 23 +4 epics (column) and 30 (dashboard); the total shows 153 vs 183; a 3–6 s skeleton with no progress. The since band and Live dot are good.            |
| 2   | Match with real world                       | 3         | Epics, lanes and "waits on" chains read naturally (`07-`). The "Blocked" quick filter is really a view switch.                                                                    |
| 3   | User control and freedom                    | 2         | URL state and Back work, but closing pushes history (Back reopens a closed bead), there is no in-modal back, and tab switches drop the search.                                    |
| 4   | Consistency and standards                   | 2         | Some navigation keeps state (filter chips) and some drops it (topbar tabs, rail links); two separate search boxes (Board vs Knowledge); rail items mix filters and view switches. |
| 5   | Error prevention                            | 3         | Read-only is enforced on the server. The read-only status `<select>` still shows a chevron and looks editable (`15-`).                                                            |
| 6   | Recognition rather than recall              | 2         | No Recent list; ids must be remembered to hand off or refind a bead; hierarchy expand state persists (good).                                                                      |
| 7   | Flexibility and efficiency                  | 2         | j/k, `/` and `?` exist now. Missing: Cmd-click to a new tab, copy id, palette, and keystrokes dropped while loading.                                                              |
| 8   | Aesthetic and minimalist design             | 3         | Calm and dense. At 900 px the header wraps to 3 rows (~250 px of chrome); 8 label chips plus "+65 more" always show.                                                              |
| 9   | Recognise, diagnose and recover from errors | 2         | "No beads match the filters" when the closed window hides all 46 "mine": no reason given, no "show all".                                                                          |
| 10  | Help and documentation                      | 2         | A shortcuts dialog and the Knowledge prefix legend exist; nothing explains Back/deep links or how to copy an id.                                                                  |
|     | **Total**                                   | **23/40** | Acceptable: a solid base, with navigation-context bugs to fix first.                                                                                                              |

## Cognitive load checklist

- [x] Single focus: the board scans as one surface.
- [ ] **Chunking:** 8 label chips plus "+65 more" plus a 12-control header row.
- [x] Grouping: epic lanes and the hierarchy group well.
- [x] Visual hierarchy: epic headers, progress bars and the P1 chip read first.
- [x] One thing at a time: the modal isolates one bead.
- [ ] **Minimal choices:** the header row has Group ×3, Nested, Closed ×5, Filter, Sort and Search (12 controls). The proposed `Recent + Jump to ×4` empty state stays within limits.
- [ ] **Working memory:** the user must carry the id of the bead they came from (no trail), the id to hand off (no copy), and the search that the tab switch dropped.
- [x] Progressive disclosure: labels collapse, closed beads are windowed, the hierarchy collapses.

**3 failures: moderate load.** Tabs would add a fourth, since each open tab becomes something to remember.

## Emotional journey

- **Peak:** Hierarchy shows a `waits 4uz` / `waits u9z` chain inline (`07-`). You understand why work is stuck without opening anything.
- **Valley:** "Assigned to me 46" opens an empty board. The board contradicts its own count, which erodes trust in every other number on screen.
- **End:** Esc closes the bead and focus disappears to `<body>`; the next `j` starts from the top. The last moment of each loop is the place where you get lost, which is the worst place for it under the peak-end rule.

## Design specificity

Grounded in bd: epic lanes, "waits on" chains, nudge commands, the read-only badge and the since band could not belong to a generic tracker. The **navigation model is generic** (a centred modal over a dimmed page). For an app whose core loop is reading chains of related beads, that is the least bd-specific part, which is why tabs feel tempting.

---

## Priority issues

### P1: Top-level navigation drops context

- **Evidence:**
  - `project-topbar.tsx:59` uses `search={{ tab: item.key }}`. I typed `q=lead`, clicked Hierarchy, and the URL became `?tab=hierarchy&closed=30d` with an empty search (`06-`).
  - The rail quick filters do the same: Ready `{ready:'1'}`, Blocked `{view:'status'}`, Assigned `{assignee}` (`project-rail.tsx:362-385`).
  - Epic lane collapse is `useState` (`board-swimlanes.tsx:156`): I collapsed "No epic", went to Hierarchy and back, and it was open again.
  - Board scroll went from 1250 to 0 on the same round trip.
- **Fix:**
  - `search: (prev) => ({ ...prev, tab })` for the tabs.
  - The quick filters toggle their own key over `prev`.
  - Persist the set of collapsed lanes per project+view in localStorage, like `readExpanded` in hierarchy-view.
  - Keep the scroll offset per project+tab in a module-level map.
- **Effort:** S

### P1: Closing a bead loses your place

- **Evidence:**
  - Esc on Board and on Hierarchy both left `document.activeElement === BODY`.
  - `setModalOpen(false)` navigates without `replace` (`p.$project.tsx:300`), so Back after Esc reopened ex-6.
  - Opening comes from URL state, so Radix has no trigger element to return focus to.
- **Fix:**
  - Close with `replace: true`.
  - Remember `lastOpenedId` and, after `bead` leaves the URL, `document.querySelector([data-bead-id=…])?.focus({preventScroll:true})`.
  - This is a WCAG 2.4.3 issue for Sam, not just polish.
- **Effort:** S

### P1: Hand-off has no copy control (and none at all in read-only)

- **Evidence:**
  - The header id is a `<span>` (`bead-detail-modal.tsx:915`).
  - "bd command" is a `<p>` (`:1459`).
  - Nudge copy lives in `CommentHelp`, which renders only with the comment box (hidden when `readonly`).
- **Fix:**
  - Make the id chip a button that copies the id ("Copied ex-6" toast).
  - Add a copy icon on the bd command.
  - Show the nudge line in read-only too (it is read-only safe).
  - Add a `c` key that copies the focused card's or open bead's id (add it to `SHORTCUTS`).
- **Effort:** S

### P2: You can't open a bead in a new tab, and you can't compare two

- **Evidence:** Cards and hierarchy rows are buttons (`keyboard-shortcuts.tsx` comment: "Enter opens the focused bead natively (it is a button)"). Cmd-click and middle-click do nothing extra. The modal dims everything (`15-`).
- **Fix:**
  - Render cards, rows, dependency rows and the parent link as `<a href="/p/<project>?bead=<id>">`. A plain click calls `preventDefault` and opens the modal; modified clicks fall through to the browser.
  - This replaces "bead tabs".
  - Later, if comparing becomes a weekly need: a ≥1280 px right-side peek pane with "Pin" to hold one bead while opening a second.
- **Effort:** S (links); L (peek pane)

### P2: "Assigned to me 46" opens an empty board

- **Evidence:** `mineCount` counts every status (`project-rail.tsx:255`). All 46 KN beads are closed (last on 2026-10-08), so with Closed=7d the board shows "No beads match the filters" (`05-`).
- **Fix:**
  - Count open beads only, or show "46 · all closed".
  - The empty state should say why: "46 assigned to KN are closed before 23 Oct · Show all".
  - For this owner "mine" is really the `approver:<name>` label (16 beads), and the assignee field is mostly empty (128/174). Let "mine" be a saved filter, not the assignee field alone.
- **Effort:** S

## Persona red flags

**Alex (power user)**

- No Cmd-click or middle-click to a new tab.
- No copy-id key.
- Keys typed during the 3–6 s skeleton are lost: my first `/incident-fix` went nowhere.
- After Esc, j/k restart from the first card because focus went to `<body>`.
- "Blocked" in the rail silently switches the grouping Alex had chosen.

**Jordan (first-timer)**

- The topbar already has tabs (Board/Hierarchy/Knowledge); bead tabs would put tabs inside tabs.
- "Assigned to me 46" shows nothing, with no reason.
- The read-only status `<select>` looks editable.
- Two different search boxes find different things: titles vs comments.
- Below 900 px the topbar tabs drop their text and become icon-only (`min-[900px]:inline`).

**Sam (keyboard / screen reader)**

- Focus is lost to `<body>` on every modal close (2.4.3).
- Hierarchy rows signal status with colour dots plus a strikethrough for closed, while open/blocked/waiting are colour or glyph only.
- The palette's proposed "Tab cycles scope" overrides Tab, the one key Sam relies on to move focus.
- Nothing announces "results updated" when the background comment index fills in.

## Minor observations

- Count drift: the dashboard says "1 project · 153 beads" and the rail says "183" for the same project at the same time.
- The dependency rows in the modal say "Blocking" / "Blocked by" well. The modal's top edge jumps about 10 px between beads of different heights (`08-` vs `09-`), which you notice when chaining.
- At 900 px the status columns wrap 2×2 inside each epic lane, so Blocked cards sit under Open cards and the column header row no longer lines up with them (`13-`).

## Questions to consider

- If the URL already _is_ the tab, why build a second tab system inside the page?
- Is "compare two beads" a real weekly task, or a proxy for "see a bead and its blocker together"? If the latter, show the blocker's summary inline in the dependency row and skip compare.
- Should "mine" mean assignee at all in an agent-run project where you are the approver?

---

## Ranked recommendations

| Rank | Change                                                                                                             | Fixes journeys | Effort |
| ---- | ------------------------------------------------------------------------------------------------------------------ | -------------- | ------ |
| 1    | Topbar tabs and rail links keep the search; persist lane collapse and scroll per project+view                      | 1, 2, 6        | S      |
| 2    | Close a bead with `replace`; restore focus to its card or row                                                      | 2, 4 (Sam)     | S      |
| 3    | Copy controls: id chip, bd command, nudge in read-only, `c` key                                                    | 4              | S      |
| 4    | Cards and rows as real `<a href>` links (Cmd/middle-click opens a browser tab): **this is the "tabs" answer**      | 3, 5, 6        | S      |
| 5    | Fix the "Assigned to me" count and the empty-state reason; let "mine" be a saved filter (e.g. `approver:<name>`)   | 1              | S      |
| 6    | Cmd+K palette with Recent, with the changes below                                                                  | 5, 6, 2        | M      |
| 7    | Visited-bead trail in the modal header ("ex-5 › ex-6", click to go back)                                           | 2              | S–M    |
| 8    | Show blocker summary/status inline in dependency rows (often removes the need to compare)                          | 2, 3           | S      |
| 9    | Peek pane at ≥1280 px with Pin for side-by-side, only if 1–8 ship and compare is still asked for                   | 3              | L      |
| 10   | Workspace tabs: don't build. If you use 3+ projects daily, restore the last view per project from the rail instead | 6              | S      |

---

## Palette review (changes to the approved spec)

Keep: global Cmd/Ctrl+K, Esc restores focus, as-you-type search, highlighted snippets, closed beads dimmed and last, rich rows, and no action commands. Change:

1. **"Beads already in memory across all registered projects" isn't true today.** Beads load per project (`['beads', project]`) only when you visit it, and comments come from `getProjectKnowledgeFn`, the slow `bd export` call I measured at 3–6 s cold. Opening the palette needs one prefetch of `getBeads` for every registered project, started on idle after first paint and cached in TanStack Query. Without it, cross-project search returns only the current project and looks broken.
2. **Pin exact-id and id-prefix matches to the top, even for closed beads.** "Closed dimmed and last" is right for fuzzy matches. But typing `ex-6`, or pasting an id from an agent log, must hit row 1. Journey 5 is often about a closed bead.
3. **Results that fill in later must not reorder under the cursor.** Put comment and artifact hits in their own group ("In comments · indexing…") _below_ the instant matches. Keep the highlighted row stable. Announce "N results" in an `aria-live="polite"` region.
4. **Define "Cmd+Enter opens in new view" as a new browser tab** (`window.open(deepLink)`). Don't build an in-app view: that would bring back the tabs problem and pay the cold load each time. Show the hint in the footer: `↵ open · ⌘↵ new tab · esc close`.
5. **Enter on a bead from another project:** navigate to `/p/<other>?bead=<id>`, but show the project in the row _and_ in a footer hint ("opens a private project"). Save the current project's search first (recommendation 1) so Back restores it.
6. **Drop "Tab cycles scope".** Tab is focus traversal, and overriding it inside a dialog breaks Sam's model. Use Tab only to _accept a shown scope completion_ (like a shell); otherwise leave it alone. Remove chips with Backspace on an empty input.
7. **Scopes:**
   - add `project:` (or `p:`), since it is required for cross-project search
   - add `is:closed` / `is:open`
   - `status:` values must match the app's words (open, in progress, blocked, closed, plus "waiting" if dependency-waiting lands)
   - `@name` is weak on this data (128/174 unassigned), so add a `mine` token bound to the identity or saved filter from P2-5.
8. **Empty state:** Recent (8, across projects, with project and "opened 2h ago") is right and is the real replacement for tabs. Record every bead open, including deep links and Back. Replace "Jump to Board / Hierarchy / Projects / Knowledge" (already one click away) with triage jumps: **Blocked · Ready · Since last look · Mine**. That keeps it to 4.
9. **Rows:** don't signal status by a dot alone. Use a glyph whose shape differs per status plus text in the accessible name: "ex-6, open, task, a private project, epic ex-7, 46h". Six fields is the limit, so drop "type icon" for tasks and show it only for epic and bug.
10. **One exception to "no actions":** Cmd+C (or `c`) copies the highlighted row's id. It covers journey 4 from anywhere, adds no command vocabulary, and is the most frequent hand-off action.
11. **Opening rules:**
    - The current handler ignores modified keys (`keyboard.ts:35`) and anything with `[role=dialog]` open, so Cmd+K needs its own listener that runs _even when the bead modal is open_.
    - Choosing a bead from the palette while a bead modal is open should replace `?bead=` and push to history, not stack a second dialog.
    - Cmd+K pressed during the loading skeleton must still open the palette (it can search Recent offline).
