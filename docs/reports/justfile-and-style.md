# bd-board: adopting a `justfile` and a short style rulebook

Date: 2026-10-30 · Read-only research: no bd-board source was changed.
Numbers come from an APFS clone (`cp -cR`) in a scratch directory, on macOS with node 26.12.1, cargo 1.99.1, bd 1.3.2 and just 1.59.0.

**Best first step (about 10 minutes):** drop in the justfile below and run `just doctor`. On this machine it already shows the first real problem: **pnpm is not on PATH** (no mise, no corepack, and Node 25+ no longer ships corepack). So every `pnpm …` command in the README fails here today.

## 0. Problems found while measuring (fix these whatever you decide)

| # | Finding | Evidence | Fix |
|---|---|---|---|
| 1 | **The format gate already fails on `main`.** | `prettier --check .` exits 1 on `src/lib/readiness.test.ts` (commit b47c78a). The CI step `pnpm check` should be red. | `pnpm format` (one line changes). |
| 2 | **CI never runs the Rust tests.** | The `rust` job runs only `fmt` and `clippy`. `cargo test --features wdio` passes locally: 50 unit tests plus 1 real-bd integration test, 56 s warm. | Add a `cargo test` step, or run `just rust-test` in CI. |
| 3 | **CI and local machines use different Rust versions.** | CI uses `dtolnay/rust-toolchain@stable`, unpinned. There is no `rust-toolchain.toml`, and `Cargo.toml` says `rust-version = "1.77.2"`. | Add a `rust-toolchain.toml` (wglane pins `1.99.1`). |
| 4 | `pnpm check` only runs Prettier, but the name suggests the whole gate. | See `package.json`. | In the justfile, `just check` means the full frontend gate. Leave the pnpm name alone. |
| 5 | pnpm, mise and corepack are missing on this machine. | `just doctor` → `FAIL pnpm`. | `mise install` (mise.toml pins pnpm 11.21.0). |
| 6 | Two RUSTSEC advisories in `quick-xml` 0.39.4. | RUSTSEC-2026-0194/0195, pulled in through `plist` → `tauri`. It only reads local plist files, so the input is trusted. | Add a `deny.toml` ignore that states the reason, and wait for a tauri update. |

## (a) wglane's justfile: what to borrow and what to skip

wglane's justfile has 40 lines and covers Rust only. It is good because it is small and because CI runs the same entry point you run locally.

**Worth borrowing:**

- **One gate shared by local and CI.** `ci: fmt-check clippy test deny doc check-no-tui` is a recipe made only of dependencies. CI installs just (`taiki-e/install-action` with `tool: just,cargo-deny`) and runs `just ci`, so local and CI cannot drift apart. bd-board's CI jobs repeat the commands inline today.
- **`default: @just --list`.** Typing `just` alone shows the menu.
- **`fmt` / `fmt-check` pairs.** One recipe writes the formatting, the other only checks it.
- **Short recipes with one job each** (`clippy`, `deny`, `doc`, `check-no-tui`), each with a one-line comment that says why it exists. Example: "The binary must still build without the optional TUI." The bd-board equivalent is clippy with `--features wdio`, which is what CI runs.
- **Pass-through arguments.** `run *args: cargo run -p wglane-cli -- {{args}}`.
- **Documented env knobs on the recipe,** e.g. `INSTA_UPDATE=always just test`. bd-board has similar knobs: `ONLY=… SHOTS=… just overflow-check` and `REBUILD=1 just desktop-install`.
- **The rest of wglane's guard rails:** a pinned toolchain (`rust-toolchain.toml`), `clippy.toml` with `allow-unwrap-in-tests`, workspace `[lints]`, and `deny.toml`. Section (c) picks the parts that fit bd-board.
- **CONTRIBUTING.md names the gate:** "`just ci` green before pushing."

**Not worth borrowing for a small desktop + web app:**

- **The `xtask` crate** (`cargo xtask completions/man`). bd-board's automation already lives in `scripts/*.mjs` and `.sh`. A second automation language buys nothing.
- **`doc` with `RUSTDOCFLAGS=-D warnings` and `missing_docs`.** bd-board's Rust is an app shell (4 files, about 3.1k lines) and has no library consumers. Clippy's pedantic `missing_errors_doc` alone produced 28 warnings that would be noise here.
- **The full `clippy::pedantic` set.** It produced about 110 warnings. 36 of them are `needless_pass_by_value` on `#[tauri::command]` functions, and Tauri requires owned arguments there.
- **`release.toml` / `dist-workspace.toml` (cargo-dist).** bd-board already releases through `tauri-action` in `release.yml`.
- **`check-no-tui`-style feature-matrix recipes.** bd-board has one optional feature (`wdio`), and CI's clippy already covers it.

## (b) Proposed justfile (drop-in, at the repo root)

Checks I ran on the clone: `just --fmt --check --unstable` passes, `just --list` is grouped, `just -n ci` and `just -n validate` print the expected commands, `just rust` passes in 4 s warm, and both guard recipes refuse cleanly when no server is running.

Design rules:
- **Thin wrappers only.** Every recipe calls an existing `pnpm` script or a cargo command. Nothing is reimplemented.
- **No process control.** No recipe kills, stops or backgrounds a process. Recipes that need a running server check for it and refuse with a hint. `e2e-native` refuses when port 4472 is taken, because `e2e/wdio.conf.ts` warns that the client would otherwise drive the wrong app.
- **No dotenv loading** (`dotenv-load := false`). Vite reads `.env.local` itself.
- **macOS-only recipe is gated.** `desktop-install` has a `[macos]` attribute.
- **`clean-all` asks first** (`[confirm]`), because `src-tauri/target` is 7.6 GB here.

Bug I hit while testing: a backtick inside a quoted dependency argument (``"start `just dev` …"``) is shell command substitution in the guard. It actually ran `just dev`, which only failed because pnpm was missing. The hints below use no backticks. Keep it that way.

```just
# bd-board tasks. Thin wrappers over package.json scripts and cargo.
# `just ci` is the gate CI runs; run it before pushing. `just` alone lists recipes.
# No recipe kills, stops or backgrounds a process: guards refuse and say why.

set shell := ["bash", "-euo", "pipefail", "-c"]
# Vite reads .env.local itself; just must not export it into every recipe.
set dotenv-load := false

tauri := "src-tauri"
manifest := "--manifest-path " + tauri + "/Cargo.toml"

default:
    @just --list --unsorted

# ── setup ────────────────────────────────────────────────────────────

# Install pinned deps; create .env.local from the example if missing (never overwrites).
[group('setup')]
setup: doctor
    pnpm install --frozen-lockfile
    [ -f .env.local ] || cp .env.example .env.local

# Check the toolchain: node, pnpm, bd, cargo (hard); python3, Chrome, mise (soft).
[group('setup')]
doctor:
    #!/usr/bin/env bash
    set -uo pipefail
    fail=0
    ok()   { printf 'ok    %-8s %s\n' "$1" "$2"; }
    bad()  { printf 'FAIL  %-8s %s\n' "$1" "$2"; fail=1; }
    warn() { printf 'warn  %-8s %s\n' "$1" "$2"; }
    # ver_ge A B: true when version A >= B
    ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }
    want_pnpm=$(node -p "require('./package.json').packageManager.split('@')[1].split('+')[0]" 2>/dev/null || echo "?")
    if v=$(node --version 2>/dev/null); then
      ver_ge "${v#v}" 24.0.0 && ok node "$v" || bad node "$v (need >=24; run: mise install)"
    else bad node "missing (run: mise install)"; fi
    if v=$(pnpm --version 2>/dev/null); then
      [ "$v" = "$want_pnpm" ] && ok pnpm "$v" || warn pnpm "$v (packageManager pins $want_pnpm)"
    else bad pnpm "missing (run: mise install; Node 25+ ships no corepack)"; fi
    bd_bin="${BD_BIN:-bd}"
    if v=$("$bd_bin" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1); [ -n "$v" ]; then
      ver_ge "$v" 1.3.0 && ok bd "$v ($bd_bin)" || bad bd "$v (need >=1.3.0: brew install beads)"
    else bad bd "missing ($bd_bin): brew install beads, or set BD_BIN"; fi
    if v=$(cargo --version 2>/dev/null); then ok cargo "$v"; else bad cargo "missing (rustup): needed for desktop + rust recipes"; fi
    command -v python3 >/dev/null && ok python3 "$(python3 --version 2>&1)" || warn python3 "missing: test-readonly needs it"
    chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
    [ -x "$chrome" ] && ok chrome "found" || warn chrome "not found: overflow-check and e2e need it (or set CHROME)"
    command -v mise >/dev/null && ok mise "$(mise --version 2>/dev/null | head -n1)" || warn mise "missing: mise.toml pins node/pnpm/bd"
    [ -f .env.local ] && ok env ".env.local present" || warn env ".env.local missing (just setup creates it)"
    [ -d node_modules ] && ok deps "node_modules present" || warn deps "node_modules missing (just setup)"
    exit $fail

# ── run ──────────────────────────────────────────────────────────────

# Web dev server on :3009 (foreground; Ctrl-C to stop).
[group('run')]
dev:
    pnpm dev

# Production web build, then preview it on :3009.
[group('run')]
web:
    pnpm build
    pnpm preview

# Tauri desktop app in dev mode (starts its own `pnpm dev`).
[group('run')]
desktop-dev:
    pnpm desktop:dev

# Release desktop bundle (tauri runs desktop:prepare itself).
[group('run')]
desktop-build:
    pnpm desktop:build

# Install the built bundle into /Applications (asks a running copy to quit; never kills).
[group('run')]
[macos]
desktop-install:
    pnpm desktop:install

# ── gate ─────────────────────────────────────────────────────────────

# What CI runs on every PR: frontend + rust jobs (feed-smoke and e2e-browser are separate).
[group('gate')]
ci: check rust

# Pre-push: ci plus prod audit, feed smoke and rust tests (needs network and bd).
[group('gate')]
validate: ci audit feed-smoke rust-test

# Frontend gate: format check, types, lint (zero warnings), unit tests. Not `pnpm check` (prettier only).
[group('gate')]
check: fmt-check-web typecheck lint unit

[group('gate')]
typecheck:
    pnpm typecheck

[group('gate')]
lint:
    pnpm exec eslint --max-warnings=0

# Vitest, once.
[group('gate')]
unit:
    pnpm test

# Rust gate as CI runs it: fmt check + clippy -D warnings (with the wdio feature).
[group('gate')]
rust: fmt-check-rust clippy

[group('gate')]
clippy:
    cargo clippy {{ manifest }} --locked --all-targets --features wdio -- -D warnings

[group('gate')]
audit:
    pnpm audit:prod

# ── format ───────────────────────────────────────────────────────────

# Rewrite formatting: prettier + eslint --fix + cargo fmt.
[group('format')]
fmt:
    pnpm format
    cargo fmt {{ manifest }} --all

[group('format')]
fmt-check: fmt-check-web fmt-check-rust

[group('format')]
fmt-check-web:
    pnpm check

[group('format')]
fmt-check-rust:
    cargo fmt {{ manifest }} --all --check

# ── test ─────────────────────────────────────────────────────────────

# Unit tests, both languages.
[group('test')]
test: unit rust-test

# Rust unit + real-bd integration tests (real_bd skips itself when bd is absent).
[group('test')]
rust-test:
    cargo test {{ manifest }} --locked --features wdio

# Board feed against the local bd binary.
[group('test')]
feed-smoke:
    pnpm test:feed-smoke

# Read-only shim against a throwaway bd project (needs bd + python3).
[group('test')]
test-readonly:
    pnpm test:readonly

# Chrome against a real dev server on its own port (:3061) and a throwaway HOME; the suite starts and stops that server itself.
[group('e2e')]
e2e-fixture:
    pnpm e2e:fixture

# Chrome against an already-running `just dev` on :3009 with mocked IPC.
[group('e2e')]
e2e-browser: (_need-url "http://localhost:3009" "run: just dev (in another terminal)")
    pnpm e2e:browser

# Debug desktop build with the wdio feature (needed by e2e-native).
[group('e2e')]
e2e-build:
    pnpm e2e:build

# Native desktop suite. Refuses if another app owns :4472 (pinned in e2e/wdio.conf.ts; the client would drive the wrong app).
[group('e2e')]
e2e-native: (_need-free-port "4472") e2e-build
    pnpm e2e

# Horizontal-overflow guard in real Chrome. Point the dev server at a read-only registry.
# e.g. `ONLY=bead-modal SHOTS=/tmp/shots just overflow-check`
[group('e2e')]
overflow-check base="http://localhost:3009": (_need-url base "run: just dev against a read-only registry first")
    BASE_URL={{ base }} node scripts/check-overflow.mjs

# ── housekeeping ─────────────────────────────────────────────────────

# Set the version in package.json, Cargo.toml and tauri.conf.json, e.g. `just version 0.2.0`.
[group('housekeeping')]
version v:
    pnpm version:set {{ v }}

# Remove web build output (dist/, .output/). Cheap to rebuild.
[group('housekeeping')]
clean:
    rm -rf dist .output

# Also remove src-tauri/target (several GB; next desktop build is cold).
[confirm('Delete src-tauri/target? The next cargo build starts cold.')]
[group('housekeeping')]
clean-all: clean
    cargo clean {{ manifest }}

# ── guards (private) ─────────────────────────────────────────────────

[private]
_need-url url hint:
    @curl -sf -o /dev/null --max-time 3 {{ url }} || { echo "error: nothing answering at {{ url }}: {{ hint }}" >&2; exit 1; }

[private]
_need-free-port port:
    @! lsof -nP -iTCP:{{ port }} -sTCP:LISTEN >/dev/null 2>&1 || { echo "error: port {{ port }} is in use (another Tauri app's WebDriver?). Quit that app; the port is pinned in e2e/wdio.conf.ts" >&2; exit 1; }
```

Wiring CI to it (stage M): in `ci.yml`, add `- uses: taiki-e/install-action@v2` with `tool: just`. Then replace the four frontend `run:` steps with `just check`, and the Rust steps with `just rust rust-test`. Keep the jobs separate: the Linux Rust job needs the WebKitGTK apt step, and the frontend job does not.

## (c) Ranked rules worth enforcing in this repo (8)

Each cost was measured on the clone. "Hits" means violations in `src/` + `scripts/` (TS) or `src-tauri/` (Rust).

What the current setup already covers: `tanstackConfig` runs typed linting (`parserOptions.project: true`) and already enforces Google-TS rules such as `ban-ts-comment`, `consistent-type-imports`, `no-namespace`, `no-var`, `prefer-const`, `no-wrapper-object-types` and `no-unnecessary-condition`. `tsconfig` already has `strict` and `verbatimModuleSyntax`. So the shortlist only contains rules that are missing.

| Rank | Rule (source) | Mechanism | Measured cost now |
|---|---|---|---|
| 1 | **Handle every promise** (TS guide: exceptions and control flow; template: "untested combinations ship broken") | ESLint `@typescript-eslint/no-floating-promises: error`, plus `no-misused-promises` with `{ checksVoidReturn: { attributes: false } }` | 25 + 13 hits in 8 files, about 45 min. Most are `queryClient.invalidateQueries(...)` in `onSuccess` → prefix with `void`. One is real: the async IIFE at `src/lib/bead-feed-server.ts:191`, where a rejection on the server would go unhandled. |
| 2 | **Free lock-ins with 0 hits today** (TS guide: no `any`, `===`, throw only `Error`, `interface` for object types) | ESLint `no-explicit-any`, `eqeqeq: ['error','always',{null:'ignore'}]`, `only-throw-error`, `consistent-type-definitions: ['error','interface']`; tsconfig `noImplicitOverride`, `noImplicitReturns` | **0 hits** for all six, about 5 min. They stop future regressions, mostly from agent-written code. |
| 3 | **Rust: no `unsafe`, no `unwrap` in app code** (Google Rust guide: `expect("reason")` over `unwrap`, unsafe only with justification; wglane's `clippy.toml`) | `Cargo.toml` `[lints.rust] unsafe_code = "forbid"`; `[lints.clippy] unwrap_used = "warn"` (fails the build through the existing `-D warnings`); `src-tauri/clippy.toml` `allow-unwrap-in-tests = true` | 0 `unsafe` blocks. 1 non-test hit (`lib.rs:75` `.expect` in the builder; allow it with a reason). 40 hits in `tests/real_bd.rs` helpers → one `#![allow(clippy::unwrap_used)]` at the top of that file. About 10 min. |
| 4 | **Pin the Rust toolchain and run `cargo test` in CI** (template: format/lint gates; wglane `rust-toolchain.toml`) | `src-tauri/rust-toolchain.toml` with `channel = "1.99.1"`, `components = ["rustfmt","clippy"]`; CI runs `just rust-test` | 1 file + 1 CI step. Adds about 1–2 min of CI time (56 s warm locally). |
| 5 | **No non-null assertions** (TS guide: "avoid `!`") | ESLint `@typescript-eslint/no-non-null-assertion: error` (allowed in `*.test.ts`) | 14 hits in 6 files, 12 of them outside tests (`bead-detail-modal.tsx` ×6, `bead-feed-server.ts` ×3, `bd.ts`, `bd-errors.ts`, `project-rail.tsx`). About 30 min. |
| 6 | **Supply-chain gate for Rust** (template: `cargo-deny` for licenses and advisories) | `src-tauri/deny.toml`: copy wglane's file, add `MPL-2.0` to the allow list, ignore RUSTSEC-2026-0194/0195 with a reason. Add a `just deny` recipe and the weekly `audit.yml` job. | With wglane's config: 5 license rejects (all MPL-2.0: cssparser, selectors, dtoa-short, option-ext) + 2 advisories (quick-xml through plist/tauri) + 46 duplicate warnings (windows-sys, harmless). With no config: 406 rejects, so the config file is required. About 15 min; the check runs in 10 s. |
| 7 | **Safe array/record indexing** (TS guide, type system section) | tsconfig `noUncheckedIndexedAccess: true` | 56 errors. Top files: `bd.test.ts` 10, `palette.test.ts` 9, `palette-search.ts` 8, `utils.ts` 5, `hierarchy.ts` 5. About 1.5–2 h. This one finds real bugs in parsing `bd` JSON. Do **not** adopt `exactOptionalPropertyTypes` (51) or `noPropertyAccessFromIndexSignature` (63): high churn, little gain. |
| 8 | **Braces on every control-flow body** (TS guide: "Braces on all control-flow bodies") | ESLint `curly: 'error'` | 308 hits in 60 files, **all fixed automatically** by `eslint --fix` in one commit (about 5 min, plus a large diff). Do it in a quiet week, after rule 1, so it does not conflict with open branches. |

Considered and rejected:
- **No default exports** (TS guide). 2 hits, both TanStack devtools/provider integration files. Not worth a rule.
- **`switch-exhaustiveness-check`.** 1 hit (`bead-artifacts.tsx:22`, which has a `default`). Optional.
- **`consistent-type-assertions` with `objectLiteralTypeAssertions: never`.** 5 hits, 4 of them in tests. Low value.
- **Google HTML/CSS guide.** Mostly not applicable: styling is Tailwind utilities in 133 TS/TSX files plus one `styles.css` (344 lines). That file has one ID selector (`#app`) and two `!important`, both inside the reduced-motion override, which is the legitimate use. Only the HTML **semantics and alt-text** rules carry over. Raw `<button>` is already banned outside `components/ui` by `no-restricted-syntax`, and there are 0 `<div onClick>` today. One small fix: `bead-artifacts.tsx:42` has `alt="Artifact"`; use the file name instead. Stylelint and `eslint-plugin-jsx-a11y` are not installed. Adding jsx-a11y is a later (L) item, not a rule worth enforcing now.
- **Rust template architecture** (hexagonal design, crate-per-layer). This is a single-crate Tauri shell where one file, `desktop.rs`, has 2.7k lines. The template itself says to use modules for "single binary, <10 modules, no independent consumers". The only applicable advice: split `desktop.rs` into modules by command family when it next changes, and use `pub(crate)` first.

## (d) Staged adoption plan

**S: one sitting, about 1 hour, no behaviour change**
1. Add the justfile, then run `just doctor` and `mise install`.
2. `pnpm format`, to fix finding 1 so the gate is green.
3. Add `src-tauri/rust-toolchain.toml` (rule 4), plus a CI `cargo test` step.
4. Add the rule 2 lock-ins (0 hits) to `eslint.config.js` and `tsconfig.json`.
5. Add `brew install just` and "`just ci` green before pushing" to `CONTRIBUTING.md` and `AGENTS.md`. Keep the existing pnpm commands listed; just is optional sugar on top.

**M: about half a day**
6. Rule 1 (floating/misused promises). Fix `bead-feed-server.ts:191` properly; use `void` for the rest.
7. Rule 3 (Rust `[lints]` + `clippy.toml`) and rule 6 (`deny.toml` + `just deny` + an `audit.yml` step).
8. CI calls `just check` / `just rust rust-test` (install just via `taiki-e/install-action`).
9. Rule 5 (no `!`).

**L: when there is a quiet week**
10. Rule 7, `noUncheckedIndexedAccess` (56 errors). One PR per directory: `lib/` first.
11. Rule 8, `curly` autofix, as one isolated commit. Add it to `.git-blame-ignore-revs`.
12. Optional: `eslint-plugin-jsx-a11y` (recommended set), measured first. Split `desktop.rs` by command family.

## Not accessed or not verified

- **Google TS guide:** WebFetch read only the first ~100k of 126k characters, so the later sections (tuples, `{}` type, generics) were not reviewed.
- **Google Rust guide:** a full, real page, not a redirect. Several of its rules are tagged [chrome]/[Fuchsia] and were ignored.
- **Not run:** the `pnpm`-driven recipes, because pnpm is missing here. I ran the same binaries from `node_modules/.bin`: `tsc` 3 s ✓, `eslint` 5 s ✓, `vitest` 3 s ✓ (281 tests), `prettier --check` ✗ (finding 1).
- **Also not run:** the e2e suites, `overflow-check` and the desktop build, because they need a running server, Chrome windows or a long build.
- **CI:** I did not run GitHub Actions. Finding 1 ("CI should be red") is inferred from the same lockfile and Prettier version.
