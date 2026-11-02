# bd-board tasks. `just ci` is THE gate: what CI runs; run it before pushing.
# Thin wrappers over package.json scripts and cargo. No recipe kills or backgrounds a process.

set dotenv-load := false

default:
    @just --list

# The gate: what CI runs (frontend + rust jobs). NOT in ci: audit, feed-smoke, e2e (see `validate`).
ci: check rust

# ci plus the prod dependency audit and the feed smoke test (needs network and bd).
validate: ci audit feed-smoke

# Frontend gate: types, format check, lint, unit tests, release version, snapshot worker.
check: typecheck fmt-check-web lint unit release-version snapshot-worker

# Rust gate: format check, clippy, tests.
rust: fmt-check-rust clippy rust-test

# Web dev server on :3009 (foreground; Ctrl-C to stop). Not in ci.
dev:
    pnpm dev

# TypeScript, no emit.
typecheck:
    pnpm typecheck

# Prettier check only (`pnpm check`); `just check` is the whole frontend gate.
fmt-check-web:
    pnpm check

# Zero warnings allowed.
lint:
    pnpm exec eslint --max-warnings=0

# Vitest, once.
unit:
    pnpm test

# The release version must agree across package.json, Cargo.toml and Cargo.lock.
release-version:
    node scripts/check-release-version.mjs

# Typecheck and test the snapshot worker (installs its pinned deps first).
snapshot-worker:
    pnpm --dir workers/snapshot install --frozen-lockfile
    pnpm test:snapshot-worker

# Rewrite formatting: prettier + eslint --fix, then cargo fmt. Not in ci (it writes files).
fmt:
    pnpm format
    cd src-tauri && cargo fmt --all

# cargo fmt, check only.
fmt-check-rust:
    cd src-tauri && cargo fmt --all --check

# Same flags as CI: all targets, the wdio feature, warnings are errors.
clippy:
    cd src-tauri && cargo clippy --all-targets --features wdio -- -D warnings

# tests/real_bd.rs skips itself when `bd` is not on PATH.
rust-test:
    cd src-tauri && cargo test

# Prod dependency advisories. Needs network, so NOT in `ci`; `validate` runs it.
audit:
    pnpm audit:prod

# Feed smoke test against a real bd. Needs `bd` on PATH, so NOT in `ci`; `validate` runs it.
feed-smoke:
    pnpm test:feed-smoke
