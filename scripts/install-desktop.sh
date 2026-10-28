#!/usr/bin/env bash
# Installs the built "bd board" desktop bundle into /Applications (or ~/Applications) and opens it.
# macOS only, never needs sudo, never kills a process: a running copy is asked to quit and waited for.
#
# Overrides (for testing against a throwaway location, never needed day to day):
#   APP_NAME  app name, default "bd board"
#   BUNDLE    built .app to install, default src-tauri/target/release/bundle/macos/<APP_NAME>.app
#   DEST      install directory, default /Applications (falls back to ~/Applications if not writable)
#   NO_OPEN=1 skip the final `open`
#   REBUILD=1 run `pnpm desktop:build` even if the bundle exists
set -euo pipefail

step() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "install-desktop.sh only supports macOS (this is $(uname -s))"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="${APP_NAME:-bd board}"
BUNDLE="${BUNDLE:-$ROOT/src-tauri/target/release/bundle/macos/$APP_NAME.app}"

if [ "${REBUILD:-}" = 1 ] || [ ! -d "$BUNDLE" ]; then
  step "building the desktop bundle (pnpm desktop:build)"
  (cd "$ROOT" && pnpm desktop:build)
else
  step "using the built bundle: $BUNDLE"
fi
[ -d "$BUNDLE" ] || die "bundle not found after build: $BUNDLE"

if [ -n "${DEST:-}" ]; then
  [ -d "$DEST" ] && [ -w "$DEST" ] || die "DEST is not a writable directory: $DEST"
elif [ -w /Applications ]; then
  DEST=/Applications
else
  DEST="$HOME/Applications"
  step "/Applications is not writable for this user; installing to $DEST instead (no sudo)"
  mkdir -p "$DEST"
fi
TARGET="$DEST/$APP_NAME.app"

is_running() { [ "$(osascript -e "application \"$APP_NAME\" is running" 2>/dev/null)" = true ]; }

if is_running; then
  step "asking \"$APP_NAME\" to quit"
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null
  for _ in $(seq 1 20); do
    is_running || break
    sleep 0.5
  done
  is_running && die "\"$APP_NAME\" is still running after 10 s; quit it yourself and rerun (nothing was changed, nothing was killed)"
  step "\"$APP_NAME\" has quit"
else
  step "\"$APP_NAME\" is not running"
fi

step "copying to $TARGET"
rm -rf "$TARGET.new"
ditto "$BUNDLE" "$TARGET.new"
rm -rf "$TARGET"
mv "$TARGET.new" "$TARGET"

if [ "${NO_OPEN:-}" = 1 ]; then
  step "NO_OPEN=1: not opening"
else
  step "opening $TARGET"
  open "$TARGET"
fi
step "done"
