#!/usr/bin/env bash
# Zips the hidden source maps of a build and POSTs them to OpenObserve's source-map API so RUM
# error stacks show original code. DRY RUN by default: prints what it would do, sends nothing.
#
#   O2_RUM_SOURCEMAPS=1 pnpm build            # emits hidden .map files (vite.config.ts)
#   O2_SM_URL=https://openobserve.example.com O2_SM_ORG=kn O2_SM_TOKEN=... \
#     bash scripts/upload-sourcemaps.sh --service bd-board-web --env production [--send]
#
# Env (never commit values):
#   O2_SM_URL    base URL of the OpenObserve UI/API (not the RUM ingest host)
#   O2_SM_ORG    organization identifier
#   O2_SM_TOKEN  API token with the `sourcemaps` permission, sent as a Bearer header (the header
#                scheme is unverified; if it answers 401 try Basic `-u user:token`)
# Flags: --service  must equal the RUM `service` (bd-board-web | bd-board-desktop)
#        --env      must equal the RUM `env`;  --version defaults to package.json
#        --dir      assets dir holding *.map (default: .output/public/assets, then dist/assets)
#        --send     really upload (otherwise dry run)
# Service, env and version must match what the SDK reports, or OpenObserve cannot pair them.
# Upload the desktop maps (dist/ after `pnpm desktop:prepare`) under bd-board-desktop separately.
# OpenObserve documents source maps as an Enterprise feature; on a build without it, skip this.
set -euo pipefail
cd "$(dirname "$0")/.."

service="" env="" version="" dir="" send=0
while [ $# -gt 0 ]; do
  case "$1" in
    --service) service="$2"; shift 2 ;;
    --env) env="$2"; shift 2 ;;
    --version) version="$2"; shift 2 ;;
    --dir) dir="$2"; shift 2 ;;
    --send) send=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
[ -n "$service" ] && [ -n "$env" ] || { echo "--service and --env are required" >&2; exit 2; }
version="${version:-$(node -p "require('./package.json').version")}"
if [ -z "$dir" ]; then
  for d in .output/public/assets dist/assets; do [ -d "$d" ] && dir="$d" && break; done
fi
[ -n "$dir" ] && [ -d "$dir" ] || { echo "no build found; run O2_RUM_SOURCEMAPS=1 pnpm build" >&2; exit 1; }
count=$(find "$dir" -maxdepth 1 -name '*.map' | wc -l | tr -d ' ')
[ "$count" -gt 0 ] || { echo "no .map files in $dir; build with O2_RUM_SOURCEMAPS=1" >&2; exit 1; }

zip_path="$(mktemp -d)/sourcemaps.zip"
(cd "$dir" && zip -q -j "$zip_path" ./*.map)
echo "maps: $count in $dir -> $zip_path ($(du -h "$zip_path" | cut -f1)); limits: 100 MB zip, 5 MB per map"
echo "service=$service env=$env version=$version"

: "${O2_SM_URL:?set O2_SM_URL}" "${O2_SM_ORG:?set O2_SM_ORG}"
url="${O2_SM_URL%/}/api/${O2_SM_ORG}/sourcemaps"
if [ "$send" -ne 1 ]; then
  echo "DRY RUN. Would POST (multipart: file, service, env, version) to: $url"
  echo "Re-run with --send and O2_SM_TOKEN set to upload."
  exit 0
fi
: "${O2_SM_TOKEN:?set O2_SM_TOKEN}"
curl --fail-with-body -sS -X POST "$url" \
  -H "Authorization: Bearer ${O2_SM_TOKEN}" \
  -F "file=@${zip_path}" -F "service=${service}" -F "env=${env}" -F "version=${version}"
echo
