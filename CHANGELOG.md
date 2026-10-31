# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0](https://github.com/nyashkn/bd-board/compare/v0.2.0...v0.3.0) (2026-10-31)

This release lets a project be read from more than the local `bd` command: a Dolt SQL server or a published snapshot. It also makes the app start and open beads faster, and adds questions on a bead. It covers 25 pull requests.

### What's New

#### Questions on a bead

Questions had no place on a bead other than a plain comment. You can now ask a question on a bead and answer it from the same place.

- [#8](https://github.com/nyashkn/bd-board/pull/8)

#### Bead references with hover preview

Mentioning another bead in markdown gave you only text. A `:::bead` reference now renders as a link to that bead, and hovering it shows a preview.

- [#9](https://github.com/nyashkn/bd-board/pull/9)

#### Choosing where a project is read from

Each project used to be read only through the `bd` command line. A project can now list its sources in order, and the app uses the first one that works and falls back to live `bd` when none does. Two new read-only sources exist: a SQL connector for projects served by a Dolt server, and an HTTP connector for snapshot manifests published to R2.

- [#22](https://github.com/nyashkn/bd-board/pull/22)
- [#33](https://github.com/nyashkn/bd-board/pull/33)
- [#30](https://github.com/nyashkn/bd-board/pull/30)

#### Published snapshots and write-back

A snapshot writer publishes a project to R2, and a token-gated Worker serves it with ETag and 304 support, so an unchanged manifest costs almost nothing. People reading a snapshot can still comment: comments go to an inbox on the Worker, and a queue applies them to the project with `bd comments add`.

- [#23](https://github.com/nyashkn/bd-board/pull/23)
- [#29](https://github.com/nyashkn/bd-board/pull/29)

#### Faster cold start and bead open

Opening a bead ran `bd` calls, and the app started with nothing to show. The client now keeps a snapshot store, so a bead opens with zero `bd` calls. Project snapshots are also persisted, so your projects appear right away on the next start.

- [#27](https://github.com/nyashkn/bd-board/pull/27)
- [#28](https://github.com/nyashkn/bd-board/pull/28)

#### Migration prompt for embedded projects

Projects that use an embedded database cannot be read by the new connectors. These projects now have a button that copies a prompt you can hand to an agent to move them to shared-server mode.

- [#25](https://github.com/nyashkn/bd-board/pull/25)

#### View label on performance data

Every `bd.call` vital sent to opt-in performance monitoring now carries the view that was open, so a slow call can be traced to a screen.

- [#19](https://github.com/nyashkn/bd-board/pull/19)

### Fixes

- **Subtasks and Edges:** the desktop app now sends `childBeads` and links, so both sections fill in. [#12](https://github.com/nyashkn/bd-board/pull/12)
- **Home subtitle:** the desktop app sends `counts.active`, so the subtitle no longer reads every bead as open. [#35](https://github.com/nyashkn/bd-board/pull/35)
- **Project counts:** the rail refetches counts when a project's snapshot cursor moves, not every 15 seconds. [#37](https://github.com/nyashkn/bd-board/pull/37)
- **Redundant refetches:** opening a bead or switching projects no longer refetches the export and projects list. [#18](https://github.com/nyashkn/bd-board/pull/18)
- **bd queue:** the per-project `bd` queue is hardened. [#26](https://github.com/nyashkn/bd-board/pull/26)

### Smaller changes

- **bd call queue:** `bd` calls run through a per-project queue, Tauri commands are async, and spawns have timeouts. [#20](https://github.com/nyashkn/bd-board/pull/20)
- **Connector seam:** the core reads through a connector interface, with the `bd` command line as the only connector at that point. [#13](https://github.com/nyashkn/bd-board/pull/13)
- **Desktop code layout:** `desktop.rs` is split into domain, ports, `bd` CLI adapter, app and commands modules. [#24](https://github.com/nyashkn/bd-board/pull/24)

### Missed recent releases

<details>
<summary>Previous versions</summary>

| Version                                                          | Highlights                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0.2.0](https://github.com/nyashkn/bd-board/releases/tag/v0.2.0) | Cmd/Ctrl+K command palette, light and dark themes, Blocked and Ready that follow `bd`, read-only projects, bead artifacts, opt-in performance monitoring |
| [0.1.1](https://github.com/nyashkn/bd-board/releases/tag/v0.1.1) | TanStack Start and Router upgrade clearing three critical XSS advisories, no more "Repair Project" dialog in the browser, README demo GIF                |
| [0.1.0](https://github.com/nyashkn/bd-board/releases/tag/v0.1.0) | Live updates through `bd events tail --follow`, bd 1.3.0 now required, feed smoke test in CI, project registry loads in web builds                       |

</details>

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
