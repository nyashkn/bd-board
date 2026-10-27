# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Desktop window minimum size 960x600 and `scripts/check-overflow.mjs`, a dependency-free (Chrome DevTools protocol) horizontal-overflow check at 720/1000/1280/1440px.
- Compact relative ages ("created 12d ago", "updated 3h ago") on bead cards and in the bead modal sidebar, with the full timestamp as tooltip (`src/lib/age.ts`).
- Closed recency window (`closed=1d|7d|30d|90d|all`, default 7d, remembered in `localStorage`, URL wins) for the Closed column, swimlanes, Hierarchy and lists, with "N of M" counts and a "show all" link. Completed epics are hidden or shown by the same window and show "Done · took 5d" when visible.
- Epic progress bar, `closed/total`, percent and open/in progress/blocked breakdown in swimlane headers and on every epic row in Hierarchy; nested sub-epics counted once per descendant.

### Fixed

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
