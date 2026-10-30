#!/usr/bin/env bash
# Writes ~/.config/bd-board/rum.json (chmod 600) from the RUM client token in the environment.
# The token is read from $OPENOBSERVE_KN_RUM_TOKEN, never echoed, never put on a command line.
# Refuses to overwrite an existing file unless --force. Prints only: written (token length N)
#
#   ~/.claude/bin/infisical-dokploy-shared-services --path=/openobserve \
#     bash scripts/rum-setup.sh            # Infisical injects OPENOBSERVE_KN_RUM_TOKEN
#
# Optional env: RUM_SITE (o2-rum.nl.ds.ke) RUM_ORG (kn) RUM_ENV (production) RUM_PROFILE (full)
# For the web server, run it with the same variables, e.g. O2_RUM_CLIENT_TOKEN=... in its env,
# or just share this file (the web server reads ~/.config/bd-board/rum.json too).
set -euo pipefail

force=0
[ "${1:-}" = "--force" ] && force=1
token="${OPENOBSERVE_KN_RUM_TOKEN:-}"
[ -n "$token" ] || { echo "OPENOBSERVE_KN_RUM_TOKEN is not set" >&2; exit 1; }
file="$HOME/.config/bd-board/rum.json"
if [ -e "$file" ] && [ "$force" -ne 1 ]; then
  echo "$file exists; use --force to overwrite" >&2
  exit 1
fi
mkdir -p "$(dirname "$file")"
umask 077
# The token goes in through the environment, not argv, so it never shows in `ps`.
RUM_TOKEN="$token" RUM_SITE="${RUM_SITE:-o2-rum.nl.ds.ke}" RUM_ORG="${RUM_ORG:-kn}" \
RUM_ENV="${RUM_ENV:-production}" RUM_PROFILE="${RUM_PROFILE:-full}" node -e '
const e = process.env
process.stdout.write(JSON.stringify({
  enabled: true, site: e.RUM_SITE, organizationIdentifier: e.RUM_ORG,
  applicationName: "bd-board", clientToken: e.RUM_TOKEN, env: e.RUM_ENV,
  profile: e.RUM_PROFILE, insecureHTTP: false, sampleRate: 100, replaySampleRate: 100,
}, null, 2) + "\n")
' > "$file"
chmod 600 "$file"
echo "written (token length ${#token})"
