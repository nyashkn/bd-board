# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0](https://github.com/nyashkn/bd-board/compare/v0.1.1...v0.2.0) (2026-10-30)


### What's New

* bd status card on the dashboard, bd version in the rail, rail collapses below md ([d37e394](https://github.com/nyashkn/bd-board/commit/d37e394ed6f9803646301cc929a02e74b7f1343f))
* **bd:** helpful bd-missing errors (web and desktop), comment author resolution and BD_BOARD_AUTHOR override, bd status ([437302a](https://github.com/nyashkn/bd-board/commit/437302aa34d1c65918ac99dfa7f82683cd1aa4ce))
* Blocked and Ready follow bd blocked / bd ready ([b47c78a](https://github.com/nyashkn/bd-board/commit/b47c78a96355a8d976662fa1892e2d5343d28deb))
* **board:** closed recency window (URL closed=1d|7d|30d|90d|all), completed epics follow it, epic progress everywhere ([f635eaa](https://github.com/nyashkn/bd-board/commit/f635eaa2277b0ec28ca98696ace9541f84ffb296))
* **board:** distinct toolbar labels, top labels with a more popover; knowledge empty state teaches the convention ([091df60](https://github.com/nyashkn/bd-board/commit/091df6000c55592b9cafa1ab2096edca7f8a4934))
* **board:** empty states say why and offer the fix; contrast tokens ([0efb8a4](https://github.com/nyashkn/bd-board/commit/0efb8a4e18e65844b3c622e8fc8a6058214e2177))
* **board:** epics with no tasks yet stay on the Epics board ([03a2e9c](https://github.com/nyashkn/bd-board/commit/03a2e9c2bedb2b848f3230298d2f88f58c27e391))
* **board:** since-you-last-looked band with comment-aware activity ([7c2650f](https://github.com/nyashkn/bd-board/commit/7c2650f4d9976c87692c57156af48065b85968df))
* closed-window note is a button with a date ([35aa601](https://github.com/nyashkn/bd-board/commit/35aa601454422dcbe51fecabc4b732e8ade89442))
* **desktop:** desktop:install script (graceful quit, ditto, no sudo) ([594d178](https://github.com/nyashkn/bd-board/commit/594d1788f18d97cef78dd1cdcfa677d69896936a))
* **desktop:** minimum window size 960x600 ([96109ea](https://github.com/nyashkn/bd-board/commit/96109ea80d135610a3cd3caabb92338bd032b7e8))
* **filter:** label filter chips (OR, URL param l) for all projects; epic lanes kept when epic or child matches ([fd203e8](https://github.com/nyashkn/bd-board/commit/fd203e806fe5b8401cc5303e572904a9390d458f))
* **hierarchy:** state per row, collapsed sorted tree, Board filters ([ba0c06f](https://github.com/nyashkn/bd-board/commit/ba0c06f3c7fc66fb3a5a6de026b096037cb74327))
* keyboard model (j/k, arrows, / search, ? cheatsheet) and a labelled theme toggle ([71325b7](https://github.com/nyashkn/bd-board/commit/71325b73a64b55a31184589b98a916819c5f77e9))
* **lib:** age formatter and epic stats/completeness helpers with tests ([36cbf49](https://github.com/nyashkn/bd-board/commit/36cbf49efcadef03990869f9035fb87c2ec584af))
* **lib:** pure rules for last-seen diffing, comment author, bd setup errors, keyboard, closed fold, toolbar labels ([dd3a593](https://github.com/nyashkn/bd-board/commit/dd3a5936a1f7dc4d920af5c257e7eeda50e7889b))
* **modal:** close pops history and restores focus; copy id/command/nudge buttons ([ad837e6](https://github.com/nyashkn/bd-board/commit/ad837e68006d339d9366c2f56ecae8a9d8a8f323))
* **modal:** how comments reach agents, author shown and configurable, reopen on closed beads, open subtasks first with closed folded ([3b23df3](https://github.com/nyashkn/bd-board/commit/3b23df378b73c8a50f3ff9bc3f77bc0406948e5d))
* **nav:** carry search across tabs/projects, persist lane collapse and scroll, roving radiogroups ([28b8d8e](https://github.com/nyashkn/bd-board/commit/28b8d8e74ded4426e663bcca580202b30e5e9618))
* **palette:** Cmd+K command palette overlay with chips, late comment group, copy id ([aa03f28](https://github.com/nyashkn/bd-board/commit/aa03f28ae48a0d325931b682d457ccb7130f7a5b))
* **palette:** project switcher in the scope pill, Open project rows, Ctrl/Cmd+Shift+L and +. shortcuts ([38a7fe5](https://github.com/nyashkn/bd-board/commit/38a7fe55757e09dcfab8ae6d99aabe4de00ee44e))
* **palette:** pure query, fuzzy search, snippet and recent-list logic ([daed66c](https://github.com/nyashkn/bd-board/commit/daed66c85a2c1b3fc012b54b8c48452470929f2d))
* **palette:** typo tolerance and current-project scope pill (Ctrl/Cmd+Shift+.); matrix cells B6, F5-F6; e2e ([d139adb](https://github.com/nyashkn/bd-board/commit/d139adbeaa2af2f7f696649d09ccb7db402000d6))
* **readonly:** per-project readonly/filterLabel registry fields, bd-readonly shim + generic filter, write refusal (TS + Rust) ([3d35e92](https://github.com/nyashkn/bd-board/commit/3d35e923020ca15924d4d189bab4e0928440d94b))
* **readonly:** read-only badge, hide create/edit/comment/delete/drag, skip journal enable ([093e4f6](https://github.com/nyashkn/bd-board/commit/093e4f660c76ff489cabaa6b7e6e5d4009cab7fa))
* **rum:** applicationName config (sent as the SDK's applicationId), rum-setup.sh, real example settings ([40c45a2](https://github.com/nyashkn/bd-board/commit/40c45a2f6f42378abc2b1039ebd1fb95dfb0c312))
* **rum:** desktop rum_config command reading ~/.config/bd-board/rum.json ([4cc1d65](https://github.com/nyashkn/bd-board/commit/4cc1d65e0fb12998aa898ed36e2c7ea773fbec13))
* **rum:** docs-review fixes: dashboard folder and update recipe, Basic-auth source-map upload, token model, retention warnings, CORS allow-list in the fake intake ([2f7eb92](https://github.com/nyashkn/bd-board/commit/2f7eb92e99da1af99fd8dc50ceea2302a17e4ede))
* **rum:** full profile is a pass-through with nothing masked; credentials and client token never sent; standard uses mask-user-input ([a280a46](https://github.com/nyashkn/bd-board/commit/a280a46abf38a8b77aef656099ee03dbc792f083))
* **rum:** instrument cold load, palette, bd calls, modal, feed and router errors ([8e859a7](https://github.com/nyashkn/bd-board/commit/8e859a772638339419b13d62f783cf523babbc67))
* **rum:** opt-in OpenObserve RUM core: config validator, privacy profiles, queue-and-flush facade, runtime config route ([e79dabb](https://github.com/nyashkn/bd-board/commit/e79dabb68ed320c7feba32dc1c673d2914aebab5))
* **rum:** source-map upload script (dry run), dashboard generator, env example and README section ([7e77299](https://github.com/nyashkn/bd-board/commit/7e772994addfc67c8121ede695285aaf99e5d745))
* **theme:** add light palette from owner patch ([4045328](https://github.com/nyashkn/bd-board/commit/4045328aea3bc08c3969ec4f7daf67ad111ad251))
* **theme:** light/dark/system toggle, no-flash head script, token-based overlays ([0c186af](https://github.com/nyashkn/bd-board/commit/0c186af442d5a082003140560424beba28fa31f5))
* **ui:** bead ages on cards and modal; fix markdown contrast in light mode (prose bound to foreground token) ([e905829](https://github.com/nyashkn/bd-board/commit/e905829f0975204c8c1cd436491a6bc803a95b75))
* **web:** bead-link helpers (withBead search, isModifiedClick) ([ffb8582](https://github.com/nyashkn/bd-board/commit/ffb8582225253a4d11b439fee3062bad78ff7ff2))
* **web:** every bead opener is a real link to ?bead=&lt;id&gt; ([349fdaa](https://github.com/nyashkn/bd-board/commit/349fdaa74e9d553403a065db326fe195290ae479))


### Fixes

* **counts:** one derivation for totals, blocked, ready, mine ([edbd5fc](https://github.com/nyashkn/bd-board/commit/edbd5fc52e6092f60a8bfb7b7c176116fba62466))
* **markdown:** wrap long words, scroll code and tables inside their block ([e289a79](https://github.com/nyashkn/bd-board/commit/e289a795616ad586110e6c97cf81a30f1d44cb99))
* **modal:** whole dialog scrolls below lg, wrap long titles and comments ([e2f695e](https://github.com/nyashkn/bd-board/commit/e2f695e322a3f945d206cddfb20ddda5a0341545))
* **projects:** contain project card layout (column flex, min-w-0) ([ead8885](https://github.com/nyashkn/bd-board/commit/ead888505e7a8332eff438939e47cd057dcd4c8e))
* **projects:** wrap header actions, responsive stat and project grids ([e5227a9](https://github.com/nyashkn/bd-board/commit/e5227a9c008a65a2a332449aec8d07846119945c))
* **since:** do not rewrite last-seen on unmount (StrictMode and SPA navigation); format ([98e75fc](https://github.com/nyashkn/bd-board/commit/98e75fcadc75e2e7baf4ecbe748928e2fe2f0dd4))
* **topbar:** icon-only tabs below 900px so the theme toggle stays in view ([b602ba2](https://github.com/nyashkn/bd-board/commit/b602ba2ff981dca4a6bdeb90e760e21e9afd10f5))
* **web:** accept the { project, id, update } envelope the bead modal sends (web edits threw 'No bead updates provided') ([d2d3e95](https://github.com/nyashkn/bd-board/commit/d2d3e9504bcfcc54f15882b996fd31b45f54fc8a))

## [Unreleased]

### Added

- Command palette (Cmd/Ctrl+K, from anywhere): instant search over every bead of every project by id, title, description, labels and assignee, plus comments and artifact paths indexed lazily in a separate group. Filter chips `status:` `type:` `label:` `epic:` `project:` `@name` `is:mine|ready|blocked|since`; Enter opens the bead, Cmd/Ctrl+Enter a new tab, Cmd/Ctrl+C copies its id; Recent beads and Jump to when empty. Read-only projects work the same.
- Tests that were only checked by hand: `pnpm e2e:fixture` (artifacts panel with a real sandboxed HTML file, escaping/missing/remote artifacts, read-only projects and the shim leaving the ledger unchanged, server functions refusing writes), `src-tauri/tests/real_bd.rs` (read_artifact limits and escapes, registry, shim launch, write guard, comment author, blocked/ready from real `bd` output) and a native `artifacts.e2e.ts`. The native suite now runs against a throwaway HOME.
- `pnpm desktop:install` (`scripts/install-desktop.sh`): quits a running bd board gracefully, copies the built app with `ditto` to /Applications (or ~/Applications), opens it.
- Desktop window minimum size 960x600 and `scripts/check-overflow.mjs`, a dependency-free (Chrome DevTools protocol) horizontal-overflow check at 720/1000/1280/1440px.
- Compact relative ages ("created 12d ago", "updated 3h ago") on bead cards and in the bead modal sidebar, with the full timestamp as tooltip (`src/lib/age.ts`).
- Closed recency window (`closed=1d|7d|30d|90d|all`, default 7d, remembered in `localStorage`, URL wins) for the Closed column, swimlanes, Hierarchy and lists, with "N of M" counts and a "show all" link. Completed epics are hidden or shown by the same window and show "Done · took 5d" when visible.
- Epic progress bar, `closed/total`, percent and open/in progress/blocked breakdown in swimlane headers and on every epic row in Hierarchy; nested sub-epics counted once per descendant.
- Hierarchy rows show state: a status glyph (shape and colour) and word, "waits on" the open blocker, comment count, assignee initials and age; closed and deferred rows are muted and closed titles struck through, in-progress rows carry a 2px tint.
- Hierarchy starts collapsed, with children ordered in progress, open, deferred, closed (then priority, then id with numbers compared as numbers). The expanded set is remembered per project in `localStorage` (`bd-board:hierarchy-expanded:<project>`), with "Expand all" and "Collapse all". While a filter is active the matching paths are open and the stored set is left alone.
- Hierarchy uses the Board's filter bar (search, priority, label chips, ready, assignee, closed window; same URL params). A match keeps its ancestor path, other siblings are hidden, and a "12 matches in 4 epics" line says what is shown.
- Epics with no tasks yet appear on the Board's Epics view as a header-only lane ("no tasks yet", "waits on", "scoped 18d ago") and on Hierarchy rows. Column headers on the Epics view add "+N epics" because epics are lanes, not cards.
- `Bead.waiting_on` and `Bead.ready`, filled from `bd blocked --json` and `bd ready --json -n 0` in both the TS adapter and the Rust desktop commands (the read-only shim already allowed both).

- "Since you last looked" band on Board and Hierarchy (new, closed, commented, updated since the last visit, per project in `localStorage`), a dot on changed cards and rows, and comment-aware ages: a comment does not bump `updated_at`, so cards, Hierarchy rows and the modal also show the newest comment time (`src/lib/activity.ts`). Comment times come from the Knowledge tab's `bd export` read (one extra call, at most every 30 s).
- Comment box: says an agent sees a comment only when it next reads the bead, a copyable agent-deck nudge, the author `bd` will record (`BD_BOARD_AUTHOR`, then `BD_ACTOR`, `BEADS_ACTOR`, `bd config actor`, git user.name, `$USER`), and "Comment and reopen" on closed beads. New desktop command `comment_author`.
- Keyboard model: `j`/`k` and arrows through beads, Enter opens, `/` focuses search, `?` opens a shortcut list (button in the top bar); inactive while typing or with a dialog open.
- Dashboard diagnostic card and rail footer for bd: a missing or too-old bd (minimum 1.3.0) now names the install command (`brew install beads`) and `BD_BIN`, in the web and the desktop paths (`src/lib/bd-errors.ts`, `desktop.rs`).
- Knowledge tab with nothing recorded teaches the convention (the seven prefixes with hints, an example `bd comments add`) in one compact card and gives the width to Comments, which now show the bead title.
- README "For agents" section (artifacts, knowledge prefixes, owner comments) and `BD_BOARD_AUTHOR`.

### Changed

- Board toolbar: "Group" label on the group-by toggle, "Filter: priority" / "Priority: P0-P1" and "Sort: Priority" instead of three buttons called Priority; only the 8 most used label chips show (selected ones stay pinned), the rest sit behind "+N more".
- Epic modal: open and in-progress subtasks first, closed ones folded under "N closed"; ids no longer wrap.
- Below 768px the sidebar is always the icon strip; the theme toggle has a visible "Theme" label; "N older hidden, show all" is now a "Show 240 closed before Oct 21" button.
- Comments written from the board pass `--actor` only when `BD_BOARD_AUTHOR` is set; otherwise bd records its own actor as before.

- Blocked and Ready now agree with `bd`. Blocked is every bead waiting on an open dependency (what `bd blocked` lists, any status except closed), no longer only `status=blocked`; the Blocked column, sidebar count, dashboard card and epic breakdown use it. Ready is `bd ready`: it no longer treats a closed blocker as still blocking and no longer counts deferred beads. On a real project the old Ready omitted 5 open beads whose blockers are all closed and counted 1 deferred bead (net 4 short of `bd ready`), and Blocked was 0 against 19. If bd cannot answer (old bd, failed call) the UI falls back to status only (the previous behaviour). The card's red blocked count now counts open blockers only.

### Fixed

- README and `.env.example` drift: `BD_ROOTS` is gone from both, discovery is described as the explicit registry, the empty Safety Model heading has its paragraph.
- Horizontal overflow: the project card is now a contained column (path ellipsised with a tooltip, donut and counts inside the card), the Projects header actions wrap, stat cards and project cards use responsive auto-fit grids, topbar tabs collapse to icons below 900px, and long words/URLs in markdown, bead titles and comments wrap while code blocks and tables scroll inside themselves.
- Bead modal description, acceptance criteria and artifact markdown were nearly invisible in light mode (`prose-invert` on a light background); markdown body now uses the foreground token in both themes. Also removed alpha-faded muted text on empty-state and detail copy.

- Light and dark themes with a light/dark/system toggle in the header (persisted in `localStorage`, set before first paint); the light palette comes from the owner's patch. Fixed overlay colours now use theme tokens.
- Optional registry fields `readonly` and `filterLabel` (validated in the TS and Rust loaders). A readonly project runs `scripts/readonly/bd-readonly` (REAL_BD, BD_FILTER_LABEL), shows a "Read-only" badge, hides write controls and refuses writes in the server functions and desktop commands. `filterLabel` is only honoured together with `readonly`. `pnpm test:readonly` exercises the shim.
- Label filter chips on the board (multi-select, OR, `l` URL param) for every project; view filter only.
- Bead detail modal: an Artifacts section showing `spec_id`, the `artifacts` metadata (JSON array of `{path, label, stage}`) and, for epics, children's artifacts, with an inline viewer (markdown, sandboxed HTML, images, json/txt) that refreshes on live-feed changes. `external_ref` is shown as an http(s) link or plain "Ref" text.
- Artifact `path` may be an `http(s)://` URL: rendered as a "remote" external link (new tab, `rel="noopener noreferrer"`), never fetched or iframed; other schemes are shown as invalid.
- `readArtifact` server function and `read_artifact` desktop command: project-confined (no `..`, absolute paths or symlink escapes), allow-listed extensions, 2 MB cap.

## [0.1.1] - 2026-10-16

### Security

- Upgrade the TanStack Start and Router packages together (`@tanstack/react-start` 1.169.2, `@tanstack/react-router` 1.170.44, plus router-ssr-query, router-plugin, router-cli and react-query). This clears three critical advisories: unauthenticated reflected XSS in server-function responses.

### Fixed

- Web build: opening the app in a browser no longer shows the "Repair Project" dialog for every registered project. Path validation is a desktop-app command and always failed in the browser, which was treated as an invalid path.

### Docs

- README demo GIF, and the scripts used to record it (`scripts/demo/`).

## [0.1.0] - 2026-10-15

### Added

- Live updates via `bd events tail --follow`. The board enables the events journal automatically when it is off (`bd config set events-journal true`) and refetches on journal records plus a 60 s safety refetch; it polls every 8 s only while connecting or after a feed error.
- **Breaking:** bd 1.3.0 or newer is now required.
- Feed integration smoke test (`scripts/feed-smoke.ts`) with CI job that runs against bd 1.3.0 and latest, validating disabled → live → change message flow.
- `mise.toml` for pinned development tool versions (Node.js 24.14.0, pnpm 11.21.0, bd 1.3.0).

### Fixed

- Web build now loads `~/.config/bd-board/projects.json` correctly using `node:fs/promises` instead of Tauri fs plugin, enabling project registration in web deployments.

### Removed

- Unused `@tauri-apps/plugin-fs` dependency.
