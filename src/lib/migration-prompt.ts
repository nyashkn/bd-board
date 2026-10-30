/**
 * Builds the prompt a person pastes to an AI agent to move one embedded bd project to a faster
 * setup. bd-board never migrates by itself; this only produces text. Steps and numbers come from
 * docs/remote-projects.md (bd 1.3.2).
 */

export type MigrationOption =
  | 'shared-server'
  | 'bucket-remote'
  | 'remote-server'

export const MIGRATION_OPTIONS: { value: MigrationOption; label: string }[] = [
  { value: 'shared-server', label: 'Local shared-server (recommended)' },
  { value: 'bucket-remote', label: 'Bucket remote (S3, R2, GCS)' },
  { value: 'remote-server', label: 'Remote dolt sql-server' },
]

export interface MigrationContext {
  /** Project folder, as registered in bd-board. */
  path: string
  /** Issue prefix when known. */
  prefix?: string | null
  /** From `bd dolt show --json`. */
  mode: 'embedded' | 'server' | 'unknown'
  /** From `bd --version`, when bd-board already knows it. */
  bdVersion?: string | null
}

const WHY = `Why: embedded Dolt takes a process lock, so every bd call starts a cold engine and parallel calls queue. A server removes both. Measured medians (bd 1.3.2, 234 beads), embedded -> server:
- bd list: 430 ms -> 89 ms
- bd show: ~400 ms -> 72 ms
- one write (comment): 372 ms -> 100 ms
- 8 parallel bd show: 4.3 s -> 0.13 s`

/** Single-quotes a string for a POSIX shell. */
export const shQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'"

/** A newline or other control character cannot be shown safely in a prompt; the UI disables copy. */
export function pathProblem(path: string): string | null {
  for (const ch of path) {
    const c = ch.codePointAt(0)!
    if (c < 0x20 || c === 0x7f)
      return 'The project path contains a newline or control character.'
  }
  return null
}

const PREFIX_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const VERSION_RE = /^[\w.+-]+$/

/** Inline code that survives a backtick in the text. */
const code = (s: string) => (s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``)

interface Ids {
  /** `cd <quoted path> || exit 1`, the first line of every shell block. */
  cd: string
  path: string
  prefix: string
  backup: string
  aside: string
}

const guard = (target: string) =>
  `test ! -e ${target} || { echo "target exists"; exit 1; }`

const SAFETY = (i: Ids) => `## Safety steps (do these first, in order)
1. Stop everything that uses the project: every bd process, agent session, git hook and the bd-board app. A live embedded process holds the lock, and anything written during the move is lost.
2. Back up to JSONL and note the counts (write them down for the report). Every shell block below starts with a cd because your working directory may reset between commands; keep it.
\`\`\`bash
${i.cd}
${guard(i.backup)}
bd export -o ${i.backup}
wc -l ${i.backup}
bd count
\`\`\`
   Add \`--include-memories\` to \`bd export\` if the project uses \`bd remember\`. The JSONL is not a full backup: no Dolt history, branches or non-issue tables.
3. Check what points at the old location and note it, to re-add after the move:
\`\`\`bash
${i.cd}
bd backup status
bd dolt remote list
bd where
\`\`\`
   STOP and report if \`bd where\` does not show the workspace as ${code(i.path + '/.beads')} (a redirected or shared workspace needs a different plan). Also look at \`.beads/dolt-backup.json\` (if present) and \`.beads/config.yaml\` for settings to copy back.
4. Never use \`--force\`, \`--reinit-local\` or \`--discard-remote\`. They destroy local or remote history. If bd refuses an operation, stop and report; do not override it.`

const ROLLBACK = (i: Ids) => {
  const shared = `../${i.prefix}-beads-shared`
  const after = `~/beads-after-${i.prefix}.jsonl`
  return `## Rollback
Nothing was deleted. Stop all bd processes, then swap the directories back. If anything was written after the move, the export below keeps it; run \`bd import\` on that file in the old project afterwards.
\`\`\`bash
${i.cd}
${guard(after)}
bd export -o ${after}
${guard(shared)}
mv .beads ${shared}
${guard('.beads')}
mv ${i.aside} .beads
bd count
bd dolt show --json
\`\`\`
\`bd count\` must give the old count and \`bd dolt show --json\` must say "embedded": true.`
}

function reinit(i: Ids, initLine: string, verify: string[]): string {
  return `## Procedure
\`\`\`bash
${i.cd}
# 1. Move the embedded database aside (this is the rollback copy; do not delete it).
${guard(i.aside)}
mv .beads ${i.aside}

# 2. Re-init with the same prefix so ids stay stable.
${initLine} || exit 1

# 3. Load the backup (only into this project's new workspace, never a parent's).
test -d .beads || exit 1
bd import ${i.backup}
\`\`\`
Copy back any settings noted from the old \`.beads/config.yaml\` with \`bd config set\`, and re-add the Dolt remotes and backup targets noted earlier. \`bd init\` aborts over an existing database; that is the data-safety contract, do not work around it.

## Verify
\`\`\`bash
${i.cd}
${verify.join('\n')}
bd count
bd list --all
bd export | wc -l
\`\`\`
\`bd count\` and the \`bd export\` line count must equal the backup counts. Spot-check a few ids, statuses and a bead with comments.`
}

function optionBody(option: MigrationOption, i: Ids): string {
  switch (option) {
    case 'shared-server':
      return `## Target: local shared-server
One bd-managed Dolt server for all projects under ~/.beads/shared-server. Do not pick proxied-server; it is experimental in bd 1.3.2. bd 1.3.2 has no embedded-to-server migrate subcommand, so the move is export, re-init, import.

${reinit(
  i,
  `bd init -p ${i.prefix} --shared-server --non-interactive --skip-agents --skip-hooks`,
  [
    'bd dolt show --json   # "embedded": false, "shared_server": true, "connection_ok": true',
  ],
)}

The first bd call that needs the server starts it. \`bd dolt status\` and \`bd dolt stop\` manage it.

${ROLLBACK(i)}`
    case 'bucket-remote':
      return `## Target: bucket remote (S3, R2, GCS), for backup or occasional sync only
The project stays embedded, so reads stay local and fast; freshness is not. This does not speed bd up. Choose the shared-server option for speed.
- bd 1.3.2 cannot do this: \`bd dolt push\`, \`bd dolt pull\`, \`bd sync\` and \`bd init --remote\` fail with "unknown url scheme: 's3'". Use plain dolt (2.5.1) inside the embedded database directory; bd then reads and writes the result normally.
- Measured on R2 (234 beads, ~170 ms RTT): write visible on another replica 17.5 s; push 12.3 s; pull 5.2 s; no-op poll 2.6 s; clone 4.7 s.
- Two replicas editing the same bead between syncs conflict; the pull exits 1 and writes on that replica fail until a human resolves it.
- Credentials come from the standard AWS chain (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY), never in the url. Ask the person for the bucket and endpoint; do not guess.
- Run schema upgrades on one designated machine only (see the help of \`bd migrate\`); never migrate two clones separately.
- Something other than bd-board must run the sync on a timer.

Stop bd while dolt runs. Then, after the safety steps:
\`\`\`bash
${i.cd}
ls .beads/embeddeddolt            # the database directory name is <db>
cd .beads/embeddeddolt/<db> || exit 1
dolt remote add r2 's3://<bucket>/<db>?endpoint=https://<account>.r2.cloudflarestorage.com&region=auto'
dolt push r2 main                 # first push, from the machine that has the data
dolt pull r2 main                 # later syncs; a new machine runs dolt clone <url>
\`\`\`
Verify from the project folder: \`bd count\` equals the noted count. Rollback: stop bd, then in that same database directory run \`dolt remote remove r2\`. The local data is untouched, and nothing was moved, so there is no directory swap.`
    case 'remote-server':
      return `## Target: remote dolt sql-server
Needs a server you control, with TLS and a database user. Ask the person for host, port, user and database; do not guess. Measured through a simulated 50-150 ms link: 0.2-0.6 s per bulk read. Each bd call pays several round trips, so bd itself feels slow at 150 ms.
- Credentials: set BEADS_DOLT_PASSWORD (highest priority) and BEADS_DOLT_SERVER_TLS=1, or use the credentials file ~/.config/beads/credentials (override with BEADS_CREDENTIALS_FILE; INI section [host:port], key password; mode 600). Never put a password on a command line or in the repository. --server-tls on bd init applies to that run only.
- To join an existing database on the server, add \`--database <name>\` to \`bd init\`.

${reinit(
  i,
  `bd init -p ${i.prefix} --server --server-host <host> --server-port <port> --server-user <user> --server-tls --non-interactive --skip-agents --skip-hooks`,
  [
    'bd dolt test',
    'bd dolt show --json   # "embedded": false, "connection_ok": true',
  ],
)}

${ROLLBACK(i)}`
  }
}

export function buildMigrationPrompt(
  ctx: MigrationContext,
  option: MigrationOption,
): string {
  const known = ctx.prefix && PREFIX_RE.test(ctx.prefix) ? ctx.prefix : null
  const prefix = known ?? '<prefix>'
  const version =
    ctx.bdVersion && VERSION_RE.test(ctx.bdVersion) ? ctx.bdVersion : null
  const ids: Ids = {
    cd: `cd ${shQuote(ctx.path)} || exit 1`,
    path: ctx.path,
    prefix,
    backup: `~/beads-backup-${prefix}.jsonl`,
    aside: `../${prefix}-beads-embedded`,
  }
  return `You are moving one bd (beads) project to a faster setup. Follow the steps in order. If anything differs from what is described, stop and report; do not improvise.${known ? '' : ' Wherever you see <prefix>, substitute the real issue prefix first.'}

## Context
- Project path: ${code(ctx.path)}
- Issue prefix: ${known ?? 'unknown (read it with: `bd config get issue_prefix`)'}
- Current mode: ${ctx.mode}
- bd version: ${version ?? 'unknown (check with: `bd --version`)'}

${WHY}

${SAFETY(ids)}

${optionBody(option, ids)}

## Report back
Report the before and after counts (\`bd count\`, backup line count), the mode shown by \`bd dolt show --json\`, and anything you changed or could not do.`
}
