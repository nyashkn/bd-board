# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0](https://github.com/nyashkn/bd-board/compare/v0.2.0...v0.3.0) (2026-10-31)


### What's New

* **beads:** :::bead references with hover preview ([#9](https://github.com/nyashkn/bd-board/issues/9)) ([834cd65](https://github.com/nyashkn/bd-board/commit/834cd65bb4cac619b88f08f309e0b929275c0fc4))
* **core:** pick each project's connector from an ordered source list with live fallback (bdb-84h.8) ([#22](https://github.com/nyashkn/bd-board/issues/22)) ([0b21553](https://github.com/nyashkn/bd-board/commit/0b2155314b7ddaaddf5f5d47d56f0099a1ef9d6e))
* **dolt-sql:** read-only SQL connector for Dolt server projects (bdb-84h.10) ([#33](https://github.com/nyashkn/bd-board/issues/33)) ([824143e](https://github.com/nyashkn/bd-board/commit/824143e2171b006041cd370b119920cae07f0e57))
* **http-snapshot:** read-only connector for R2 snapshot manifests (bdb-84h.12) ([#30](https://github.com/nyashkn/bd-board/issues/30)) ([2bfb3a6](https://github.com/nyashkn/bd-board/commit/2bfb3a6e467b1f69be5fea1ae86aab015e7bfd65))
* **projects:** copy a migration prompt for an agent on embedded projects (bdb-84h.16) ([#25](https://github.com/nyashkn/bd-board/issues/25)) ([0ff58a6](https://github.com/nyashkn/bd-board/commit/0ff58a6c28f264609bb8196f6efb9ee634c7ff77))
* **questions:** ask and answer on a bead ([#8](https://github.com/nyashkn/bd-board/issues/8)) ([0193a2b](https://github.com/nyashkn/bd-board/commit/0193a2ba27ce316d72b28c240b6fdd6afe5df842))
* **rum:** label every bd.call vital with the current view ([#19](https://github.com/nyashkn/bd-board/issues/19)) ([448aade](https://github.com/nyashkn/bd-board/commit/448aadefec1de4abe1cba461fccd0fe08a947de2))
* **snapshot:** R2 snapshot writer and token-gated Worker with manifest ETag/304 (bdb-84h.13) ([#23](https://github.com/nyashkn/bd-board/issues/23)) ([e43e7a1](https://github.com/nyashkn/bd-board/commit/e43e7a13dcaa95f1f4234ae00a752230f2b37c61))
* **snapshot:** write-back inbox, Worker queue applied with bd comments add (bdb-84h.14) ([#29](https://github.com/nyashkn/bd-board/issues/29)) ([ee2cd35](https://github.com/nyashkn/bd-board/commit/ee2cd3556292f1e8269e439e341bd8ef5295ed80))


### Fixes

* **bd:** harden the per-project bd queue (bdb-84h.18) ([#26](https://github.com/nyashkn/bd-board/issues/26)) ([0cccd35](https://github.com/nyashkn/bd-board/commit/0cccd359dfdba9dba39d567d6de8b7f93306a949))
* **bd:** per-project bd call queue, async Tauri commands, spawn timeouts ([#20](https://github.com/nyashkn/bd-board/issues/20)) ([bca53a3](https://github.com/nyashkn/bd-board/commit/bca53a397c3efebb86fa80d54823c1a8d793221a))
* **core:** client snapshot store, bead open with zero bd calls (bdb-84h.6) ([#27](https://github.com/nyashkn/bd-board/issues/27)) ([164d29a](https://github.com/nyashkn/bd-board/commit/164d29abb1065789d2776c612a9a4a17e8371f01))
* **core:** persist project snapshots for instant cold start (bdb-84h.7) ([#28](https://github.com/nyashkn/bd-board/issues/28)) ([1e105a4](https://github.com/nyashkn/bd-board/commit/1e105a4c13f2a1ee01d724f789ab709bae92b20a))
* **desktop:** send childBeads and links so Subtasks and Edges populate ([#12](https://github.com/nyashkn/bd-board/issues/12)) ([ec5a2b8](https://github.com/nyashkn/bd-board/commit/ec5a2b8edf5b1c68feacfbdf6325d11395d8754c))
* **desktop:** send counts.active so the home subtitle stops reading every bead as open ([#35](https://github.com/nyashkn/bd-board/issues/35)) ([c01b325](https://github.com/nyashkn/bd-board/commit/c01b325a6d5dd4777d09ff8e5efda24dd7024c0d))
* **rail:** refetch project counts when a snapshot cursor moves, not every 15 s ([#37](https://github.com/nyashkn/bd-board/issues/37)) ([de91f58](https://github.com/nyashkn/bd-board/commit/de91f582a3ec097753d78b4c1188316abf58df07))
* **ui:** stop redundant export and projects refetches on bead open and switch ([#18](https://github.com/nyashkn/bd-board/issues/18)) ([31db1f1](https://github.com/nyashkn/bd-board/commit/31db1f13815b8460de59eccd67f8f847a26628d9))

## [0.2.0](https://github.com/nyashkn/bd-board/compare/v0.1.1...v0.2.0) (2026-10-30)

This release adds a Cmd/Ctrl+K command palette, light and dark themes, read-only projects, bead artifacts and opt-in performance monitoring. Blocked and Ready now match what `bd` reports, and the layout no longer overflows on narrow windows. Most of the work landed as direct merges; the four pull requests, [#1](https://github.com/nyashkn/bd-board/pull/1), [#4](https://github.com/nyashkn/bd-board/pull/4), [#5](https://github.com/nyashkn/bd-board/pull/5) and [#6](https://github.com/nyashkn/bd-board/pull/6), are all release automation.

### What's New

#### Command palette

Finding a bead meant scrolling or using the board search box. Press Cmd/Ctrl+K from anywhere to search every bead in every project by id, title, description, labels and assignee. Comments and artifact paths are searched too, in a separate group. Filter chips (`status:`, `type:`, `label:`, `epic:`, `project:`, `@name`, `is:mine|ready|blocked|since`) narrow the results. Enter opens the bead, Cmd/Ctrl+Enter opens it in a new tab, and Cmd/Ctrl+C copies its id. Search tolerates typos, and a scope pill (Ctrl/Cmd+Shift+.) limits it to the current project and doubles as a project switcher (Ctrl/Cmd+Shift+L).

#### Light and dark themes

The app was dark only. A light/dark/system toggle with a visible "Theme" label now sits in the header. The choice is remembered and applied before first paint, so there is no flash. Markdown in the bead modal was nearly unreadable in light mode and now uses the foreground colour in both themes.

#### Blocked and Ready follow bd

Blocked meant only `status=blocked`, and Ready ignored that a closed blocker no longer blocks. Both now come from `bd blocked` and `bd ready`, in the web app and the desktop app. On one real project the old Ready view missed 5 open beads and counted 1 deferred bead, and Blocked showed 0 against 19. If `bd` cannot answer, the board falls back to status only. Totals, blocked, ready and mine counts now come from one place, so the sidebar, dashboard and epic breakdown agree.

#### Hierarchy and epics

Hierarchy rows now show state: a status glyph and word, the open blocker a bead waits on, comment count, assignee and age. The tree starts collapsed, children are ordered in progress, open, deferred, closed, and the expanded set is remembered per project. Hierarchy uses the Board's filter bar and keeps the ancestor path of each match. Epics with no tasks yet stay on the Epics board as header-only lanes. Epic progress (closed/total, percent, breakdown) appears in swimlane headers and on every epic row.

#### Closed window and bead ages

Long-closed beads crowded the board. The Closed column, swimlanes, Hierarchy and lists now show beads closed in the last 7 days by default. Choose 1d, 7d, 30d, 90d or all (`closed=` in the URL, remembered locally). A "Show 240 closed before Oct 21" button reveals the rest. Cards and the bead modal show compact ages such as "created 12d ago", and completed epics show how long they took.

#### Since you last looked

Board and Hierarchy now have a band summarising what is new, closed, commented or updated since your last visit to the project, with a dot on changed cards and rows. Ages take comments into account, since a comment does not change a bead's `updated_at`.

#### Read-only projects and label filters

Projects in the registry can set `readonly` and `filterLabel`. A read-only project goes through a `bd-readonly` shim, shows a "Read-only" badge, hides create, edit, comment, delete and drag controls, and refuses writes in both the web server functions and the desktop commands. Separately, label filter chips on the board (multi-select, OR) work for every project.

#### Bead artifacts

The bead modal has an Artifacts section listing `spec_id`, the `artifacts` metadata and, for epics, the artifacts of its children. An inline viewer handles markdown, sandboxed HTML, images, json and txt, and refreshes with the live feed. Paths are confined to the project (no `..`, absolute paths or symlink escapes), limited to allowed extensions and capped at 2 MB. `http(s)` paths show as external links and are never fetched. `external_ref` shows as a link or plain text.

#### Comments and the bead modal

The comment box now says an agent sees a comment only when it next reads the bead, offers a copyable nudge command, and shows the author `bd` will record (`BD_BOARD_AUTHOR` overrides it). Closed beads get "Comment and reopen". Closing the modal restores browser history and focus, copy buttons cover id, command and nudge, and epic modals list open subtasks first with closed ones folded.

#### Real links, keyboard and navigation

Every bead opener is now a real link to `?bead=<id>`, so middle-click and copy-link work while plain click and drag still behave as before. `j`/`k` and arrow keys move through beads, `/` focuses search, and `?` lists the shortcuts. Search carries across tabs and projects, and lane collapse and scroll position are remembered.

#### bd status and setup help

A missing or too-old `bd` (minimum 1.3.0) now shows the install command and the `BD_BIN` setting, in web and desktop. The dashboard has a bd status card and the sidebar shows the bd version. Empty boards say why they are empty and offer the fix, and an empty Knowledge tab explains the comment prefix convention.

#### Opt-in performance monitoring (RUM)

The app can send real-user monitoring data to an OpenObserve instance. It is off by default and an invalid config keeps it off. A `standard` profile masks user input; a `full` profile passes everything through unmasked. Credentials and the client token are never sent. Desktop reads `~/.config/bd-board/rum.json`. Included are a source-map upload script, a dashboard generator, a setup script and README documentation. The app records cold load, the palette, `bd` calls, the modal, the live feed and router errors.

#### Desktop

`pnpm desktop:install` quits a running copy gracefully, copies the built app to /Applications (or ~/Applications) and opens it. The window has a minimum size of 960x600.

#### Release automation

Releases now go through a release-please Release PR with a version check, and the release notes are written by Claude. release-please left the version in `Cargo.lock` unchanged, so the release-notes workflow now sets it on the Release PR, and a follow-up fixed that sync step. The workflow also runs prettier on the generated `CHANGELOG.md`, so the Release PR passes `pnpm check`.

- [#1](https://github.com/nyashkn/bd-board/pull/1)
- [#4](https://github.com/nyashkn/bd-board/pull/4)
- [#5](https://github.com/nyashkn/bd-board/pull/5)
- [#6](https://github.com/nyashkn/bd-board/pull/6)

### Fixes

- **Bead edits from the web:** the modal's `{ project, id, update }` request was rejected with "No bead updates provided".
- **Horizontal overflow:** project cards, the Projects header, stat grids and topbar tabs now fit narrow windows, which collapse tabs to icons below 900px. Long words, URLs, code blocks and tables wrap or scroll inside their own block.
- **Bead modal:** the whole dialog scrolls below the `lg` breakpoint, and long titles and comments wrap.
- **Since-you-last-looked:** the last-seen time is no longer rewritten when a view unmounts, which happened in StrictMode and on in-app navigation.

### Smaller changes

- **Closed-window note:** it is now a button that shows a date.
- **Sidebar:** below 768px it is always the icon strip.
- **Board toolbar:** clearer labels ("Group", "Filter: priority", "Sort: Priority"). Only the 8 most used label chips show, with the rest behind "+N more".
- **Comment author:** comments pass `--actor` only when `BD_BOARD_AUTHOR` is set.

### Missed recent releases

<details>
<summary>Previous versions</summary>

| Version                                                          | Highlights                                                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [0.1.1](https://github.com/nyashkn/bd-board/releases/tag/v0.1.1) | TanStack Start and Router upgrade clearing three critical XSS advisories, no more "Repair Project" dialog in the browser, README demo GIF |
| [0.1.0](https://github.com/nyashkn/bd-board/releases/tag/v0.1.0) | Live updates through `bd events tail --follow`, bd 1.3.0 now required, feed smoke test in CI, project registry loads in web builds        |

</details>

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
