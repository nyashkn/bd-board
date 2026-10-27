# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
