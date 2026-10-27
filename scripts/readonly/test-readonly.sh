#!/usr/bin/env bash
# Runs bd-readonly against a throwaway bd project (fake HOME, temp dir). Needs bd and python3.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SHIM="$HERE/bd-readonly"
BD="$(command -v bd)" || { echo "bd not found" >&2; exit 2; }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/bd-readonly-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME" "$TMP/proj"
cd "$TMP/proj" || exit 2
"$BD" init -p tst --non-interactive >/dev/null 2>&1 || { echo "bd init failed" >&2; exit 2; }

fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
ro() { REAL_BD="$BD" BD_FILTER_LABEL="${LABEL:-}" "$SHIM" "$@"; }
ids() { python3 -c 'import json,sys;print(" ".join(sorted(x["id"] for x in json.load(sys.stdin))))'; }

WO=$("$BD" create --title "wo epic" --type epic --label wo --silent)
OTHER=$("$BD" create --title "other epic" --type epic --label infra --silent)
CHILD=$("$BD" create --title "wo child" --parent "$WO" --silent)
LOOSE=$("$BD" create --title "loose" --silent)
before=$("$BD" list --all --json | python3 -c 'import json,sys;print(json.dumps(sorted((x["id"],x["title"],x["status"]) for x in json.load(sys.stdin))))')

# reads work, no filter
LABEL=""
check "list unfiltered shows all 4" '[ "$(ro list --all --json | ids | wc -w)" -eq 4 ]'
check "show works" 'ro show "$WO" --json >/dev/null'
check "count unfiltered works" '[ "$(ro count --by-status --json | python3 -c "import json,sys;print(json.load(sys.stdin)[\"total\"])")" -eq 4 ]'
check "events tail allowed" 'ro events tail --json --since 0 --limit 1 2>&1 | grep -qv "bd-readonly:"'

# writes refused, nothing changes
check "update refused" '! ro update "$WO" --title hacked 2>/dev/null'
check "comments add refused" '! ro comments add "$WO" hi 2>/dev/null'
check "config set refused" '! ro config set events-journal true 2>/dev/null'
check "create refused" '! ro create --title x 2>/dev/null'
check "delete refused" '! ro delete "$WO" --force 2>/dev/null'
check "refusal says read-only" 'ro update "$WO" --title x 2>&1 | grep -q "read-only"'
after=$("$BD" list --all --json | python3 -c 'import json,sys;print(json.dumps(sorted((x["id"],x["title"],x["status"]) for x in json.load(sys.stdin))))')
check "ledger unchanged" '[ "$before" = "$after" ]'
check "no comment added" '[ "$("$BD" comments "$WO" --json | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")" -eq 0 ]'

# filter on: matching epic and its direct child only
LABEL=wo
check "filtered list = epic + child" '[ "$(ro list --all --json | ids)" = "$(echo $CHILD $WO | tr " " "\n" | sort | tr "\n" " " | sed "s/ $//")" ]'
check "filtered list without --json refused" '! ro list --all 2>/dev/null'
check "filtered count = 2" '[ "$(ro count --by-status --json | python3 -c "import json,sys;print(json.load(sys.stdin)[\"total\"])")" -eq 2 ]'
check "filtered export drops others" '[ "$(ro export | grep -c "\"id\"")" -eq 2 ]'
check "filtered update still refused" '! ro update "$WO" --title hacked 2>/dev/null'

# BD_FILTER_TYPE=task: labelled tasks (the child inherits wo from its epic), epic no longer matches
check "BD_FILTER_TYPE=task keeps the child only" '[ "$(BD_FILTER_TYPE=task ro list --all --json | ids)" = "$CHILD" ]'

echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
