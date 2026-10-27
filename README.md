# bd board

Visual kanban board and multi-project dashboard for [`bd` (beads)](https://github.com/steveyegge/beads).

![bd board: the multi-project dashboard, an epic swimlane board, a bead with comments, drag and drop between columns, a bead created from the terminal appearing live, and search](assets/demo.gif)

`bd-board` is intentionally local-first: it shows the bead projects you register (an explicit registry, see Configuration), reads data through the local `bd` CLI, and renders a fast dashboard for day-to-day planning. It now also has an early Tauri desktop shell spike so the same UI can run outside the browser.

## Features

- Multi-project dashboard with live status counts.
- Board view grouped by status or by epic swimlanes.
- Priority and label filtering, text search, and sort controls with URL state. The label chips (multi-select, OR) are built from the labels present in the project; in epic swimlanes a lane stays when the epic or any of its children matches. This is a view filter only, not access control.
- Light, dark or system theme: toggle in the header, remembered in `localStorage`, applied before first paint (no flash). Defaults to `prefers-color-scheme`.
- Read-only projects: a "Read-only" badge, and create, edit, comment, delete and drag are hidden and refused by the server (see Configuration).
- Hierarchy tab: rows show status, waits-on, comments, assignee and age; epics start collapsed, children are ordered in progress, open, deferred, closed, the expanded set is remembered per project, and the Board's search, priority, label, ready and assignee filters apply (a match keeps its ancestor path). Epics with no tasks yet show on the Epics board as header-only lanes.
- Blocked and Ready follow `bd`: Blocked is every bead waiting on an open dependency (`bd blocked`, any status but closed), Ready is `bd ready` (closed blockers do not block, deferred is not ready). The board runs `bd blocked --json` and `bd ready --json -n 0` next to `bd list`; if either fails it falls back to the bead's own status.
- Epic progress everywhere (swimlane header, Hierarchy rows): a thin bar, `closed/total`, percent and an "N open · N in progress · N blocked" breakdown. Nested sub-epics count each descendant once; epics that are containers are not counted themselves.
- Closed recency window (`closed` URL param: `1d`, `7d` default, `30d`, `90d`, `all`; last choice also kept in `localStorage`, URL wins). Closed beads older than the window are hidden on the board (status, epic, priority views), in Hierarchy and in lists; the Closed column reads "34 of 265" with an "N older hidden, show all" link. Closed time is `closed_at`, falling back to `updated_at`. Sidebar and dashboard counts are unchanged.
- Completed epics (all descendants closed, or a closed epic with none) follow the same window by their latest closed time; when shown they get a "Done · took 5d" badge (created to last close).
- Compact ages on cards, the Hierarchy and the bead modal: "created 12d ago · updated 3h ago" (minutes < 1h, hours < 48h, days < 90d, then months, then years), full timestamp on hover.
- Bead detail modal with markdown description, acceptance criteria, comments, parent and child navigation.
- Artifacts in the bead detail modal: a bead's `spec_id` (shown as "Spec"), its `artifacts` metadata and, for epics, its children's artifacts open inline (markdown rendered, HTML in a sandboxed iframe, images, json/txt). The `external_ref` shows as a link (http/https) or plain "Ref" text. How to attach one: see For agents.
- "Since you last looked" band on the Board and Hierarchy: new, closed, commented and otherwise updated beads since you last had the project open (kept per project in `localStorage`, `bd-board:last-seen:<project>`), with a dot on each changed card or row. Comments do not bump a bead's `updated_at`, so the band, the card age line and the Hierarchy age also count the newest comment. The comment times come from the same `bd export` read the Knowledge tab uses (one extra call per 30 s, shared cache), so the cost is one full export per refresh on large projects; if it fails the band falls back to `updated_at` only.
- Comments: the modal says plainly that an agent sees a comment only when it next reads the bead (`bd show` / `bd comments`), offers a copyable `agent-deck session send` nudge, shows the author `bd` will record, and on a closed bead offers "Comment and reopen" next to "Comment".
- Keyboard: `j`/`k` or the arrow keys step through beads, Enter opens the focused bead, Esc closes the modal, `/` focuses search and `?` lists the shortcuts. Nothing fires while typing or with a dialog or menu open.
- Drag-and-drop status updates with mouse and keyboard sensors.
- Create beads, add comments, edit fields, and delete beads, enabled by default.

## Requirements

- Node.js 24+.
- pnpm 10+.
- `bd` 1.3.0 or newer. Older versions are not supported (the board relies on the events journal for live updates).
- At least one registered project: a repository with `.beads/metadata.json`, added with "Open project" in the app or in `~/.config/bd-board/projects.json` (see Configuration).

**Live updates:** the board subscribes to `bd events tail --follow` and refetches only when the journal reports a change (plus a 60 s safety refetch). When a project's journal is off, the board enables it automatically by running `bd config set events-journal true` in that project (a one-time write to its beads config) and shows a toast. It falls back to 8 s polling only while connecting or after a transient feed error.

## Setup

Web development:

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3009.

Desktop development:

```bash
pnpm install
pnpm desktop:dev
```

**Development tools:** The project includes `mise.toml` to pin exact versions of Node.js, pnpm, and bd. Run `mise install` to set them up for consistent development across the team.

## Desktop App

The desktop app is a Tauri v2 shell around the same React/TanStack UI. It is
intended for local use only: it reads bead projects from your machine and calls
the local `bd` binary through Tauri commands.

Desktop data flow:

- Web mode uses TanStack Start server functions and the local `bd` adapter.
- Desktop mode uses Tauri commands for project discovery, board data, bead
  details, comments, and knowledge, plus the same create/update/delete
  mutations as web mode.
- No bead database, `.beads` data, or Lavra memory is bundled into the app.

Desktop packaging:

```bash
pnpm desktop:prepare
pnpm desktop:build
```

`pnpm desktop:prepare` builds the TanStack Start app in SPA mode, copies the
generated `.output/public` assets into the repo-root `dist/`, and writes
`dist/index.html` from the generated `_shell.html`. This matters because Tauri
serves `frontendDist` as static assets; packaging a handmade `index.html` with
only the client script leaves the installed app on a blank screen.

Tauri is configured with:

```json
"frontendDist": "../dist"
```

The path is relative to `src-tauri/tauri.conf.json`, so the installed app embeds
the repo-root `dist/` directory.

On macOS, the release build writes:

```text
src-tauri/target/release/bundle/macos/bd board.app
src-tauri/target/release/bundle/dmg/bd board_0.1.0_aarch64.dmg
```

Windows packaging is part of the Tauri roadmap for this project, but the current
verified artifact is the macOS build.

Desktop troubleshooting:

- If the app opens but shows no projects, check that `bd` is available on
  `PATH` or set `BD_BIN`.
- The app uses an explicit project registry at `~/.config/bd-board/projects.json`.
  Click "Open project" to register a beads workspace, or "Init project" to create one.
- If the desktop bridge fails, the home page shows a diagnostic card. When the
  bridge is healthy, that card stays hidden.
- If the installed app opens to a blank screen, rerun `pnpm desktop:build` and
  confirm `dist/index.html` exists and was generated from `_shell.html`.

## Configuration

### Project Registry

The app stores a list of registered beads projects at `~/.config/bd-board/projects.json`:

```json
{
  "version": 1,
  "projects": [
    {
      "id": "ravo",
      "path": "/Users/you/Code/jeanpfs-ai/beads/ravo",
      "label": "ravo"
    }
  ]
}
```

Two optional fields per project:

- `"readonly": true`: bd runs through the deny-by-default shim `scripts/readonly/bd-readonly` (allowlist of read subcommands plus `bd --readonly`), the UI hides every write control and the server functions refuse writes. `REAL_BD` is set to the normally resolved bd binary. Set `BD_READONLY_SHIM` to use a shim at another path. Desktop bundles ship the shim as a resource.
- `"filterLabel": "wo"`: only honoured together with `readonly`. The board then shows only epics carrying that label and their direct children (`BD_FILTER_LABEL`, with `BD_FILTER_TYPE`, default `epic`, if you run `scripts/readonly/bd-filter.py` yourself). Without `readonly` it is ignored. It is a view filter, not access control: `bd show <id>` still answers for any id.

```json
{
  "id": "ledger",
  "path": "/Users/you/ledger",
  "label": "ledger",
  "readonly": true,
  "filterLabel": "wo"
}
```

A wrongly typed value (for example `"readonly": "yes"`) is an error, never silently ignored. A read-only project cannot enable the events journal itself (the shim refuses `config set`), so run `bd config set events-journal true` once by hand in that project; otherwise the board polls every 8 s. Test the shim with `pnpm test:readonly` (needs bd and python3).

Use the **Open project** and **Init project** buttons in the app UI to manage projects. The app resolves each project's beads location by calling `bd where --json`, so it automatically honors all beads configuration mechanisms (embedded, shared server, proxied, global, redirects).

### Environment Variables

Set them in `.env.local` for the web app (copy `.env.example`) or in the environment for the desktop app.

- `BD_BIN`: path to the `bd` binary. Defaults to `bd`, with `~/.local/bin/bd` and `/opt/homebrew/bin/bd` as fallbacks. If bd is missing or older than 1.3.0 the dashboard says so and names the install command (`brew install beads`) and this variable.
- `BD_BOARD_AUTHOR`: the name comments written from the board are recorded under (passed to bd as `--actor`). Unset, the board lets `bd` decide, which resolves `BD_ACTOR`, then `BEADS_ACTOR`, then `bd config set actor <name>`, then `git config user.name`, then `$USER`; the comment box shows the name that will be used. Because agents on the same machine usually share your git name, set one of these to tell your comments from theirs.
- `BD_READONLY_SHIM`: path to the read-only shim for `readonly` projects (see Project Registry).

The project list comes only from the registry; the old `BD_ROOTS` variable is ignored.

Reads and writes are both enabled by default: the app executes local `bd` mutations (create, edit, comment, status update, delete) with no separate opt-in.

## For agents

Three conventions the board understands. None needs the board running.

- **Attach an artifact** to a bead (shown in its modal, and on the epic):
  `bd update ID --set-metadata artifacts='[{"path":"docs/plan.md","label":"Plan","stage":"design"}]'`. Paths are relative to the project, limited to `.md .html .htm .png .jpg .jpeg .gif .svg .txt .json`, 2 MB max, and never read outside the project root. A `path` may also be an `http(s)://` URL, shown as a "remote" link row (new tab), never fetched or embedded; other schemes (`javascript:`, `data:`, `file:`) show as invalid. A bead's `spec_id` shows as "Spec".
- **Record knowledge** with an ordinary comment that starts with one of `LEARNED:`, `DECISION:`, `FACT:`, `PATTERN:`, `INVESTIGATION:`, `MUST-CHECK:` or `DEVIATION:`, for example `bd comments add ID "DECISION: use the events journal, not polling"`. These collect in the Knowledge tab.
- **Owner comments** are written from the board with `bd comment`, so they carry the author name `bd` records (see `BD_BOARD_AUTHOR`). Agents see them only when they next run `bd show ID` or `bd comments ID`; nothing is pushed to a running session. Filter for the owner's name when you want only those.

## Commands

```bash
pnpm dev
pnpm typecheck
pnpm check
pnpm exec eslint --max-warnings=0
pnpm test
pnpm audit:prod
pnpm validate
pnpm desktop:prepare
pnpm desktop:build
```

## Architecture

```text
src/
  lib/
    bd.ts                 local bd CLI adapter
    server.ts             TanStack Start server functions
    server-validation.ts  server-function input validation
    sort.ts               filtering and sorting helpers
    types.ts              bead/project types and status mapping
  routes/
    __root.tsx            app shell
    index.tsx             project dashboard
    p.$project.tsx        board route
  components/
    board-header.tsx
    board-swimlanes.tsx
    kanban-column.tsx
    bead-card.tsx
    bead-detail-modal.tsx
    create-bead-dialog.tsx
scripts/
  prepare-desktop-build.mjs
src-tauri/
  tauri.conf.json
  src/
    desktop.rs
    lib.rs
```

The app does not store its own database. It shells out to `bd` with `node:child_process` and parses JSON output.

`docs/bd-schema.json` documents that contract as a JSON Schema: the `Bd*` definitions describe what each `bd` command emits, and the remaining definitions describe the normalized shapes the UI consumes.

## Overflow check

jsdom cannot lay out, so layout regressions are checked in real Chrome. `scripts/check-overflow.mjs` needs no dependency (it speaks the Chrome DevTools protocol with Node's `fetch`/`WebSocket`; set `CHROME=` if Chrome is not at a default path). Against a running dev server, ideally on a read-only registry:

```bash
BASE_URL=http://localhost:3009 node scripts/check-overflow.mjs   # SHOTS=dir saves PNGs, WIDTHS=720,1000 overrides
```

It asserts `scrollWidth <= clientWidth` at 720, 1000, 1280 and 1440px for Projects (light and dark), Board (status and epics), Hierarchy, Knowledge and the bead modal. Manual checklist for the same pages and widths: no horizontal scroll, header actions and toolbar wrap, long titles/paths/URLs truncate or wrap, the sidebar works collapsed and expanded. The desktop window cannot shrink below 960x600.

## E2E (WebdriverIO)

End-to-end tests run through WebdriverIO with the Tauri service (`@wdio/tauri-service`). They are split in two suites because the two things they verify need different runtimes:

| Suite   | Command                         | Runtime                                        | Covers                                                                    |
| ------- | ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| Native  | `pnpm e2e:build && pnpm e2e`    | Real app binary, embedded WebDriver provider   | UI behaviour against the shipped shell (`e2e/specs/native`)               |
| Browser | `pnpm dev` + `pnpm e2e:browser` | Frontend in Chrome against the Vite dev server | Flows that stub backend commands and native dialogs (`e2e/specs/browser`) |

On macOS the native suite uses the embedded provider (`tauri-plugin-wdio-webdriver`); `tauri-driver` has no macOS support. The build activates the `wdio` Rust feature and the `VITE_WDIO` frontend flag, so production binaries never carry the test surface.

IPC mocking only works in the browser suite: Tauri defines `window.__TAURI_INTERNALS__.invoke` as non-writable and non-configurable, and `@wdio/tauri-plugin` only wraps the `withGlobalTauri` global, which the bundled `@tauri-apps/api` never calls.

The native suite pins the embedded WebDriver port (`e2e/wdio.conf.ts`); the default 4445 is shared with any other Tauri app running its own suite, and a session will silently attach to the wrong app.

## Safety Model

`bd-board` is not designed as a hosted multi-tenant app. Run it locally and bind it only to trusted interfaces: writes are always enabled (except for `readonly` projects), so anyone who can reach the app can mutate local bead data.

## License

MIT
