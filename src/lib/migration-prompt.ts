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

const SAFETY = (path: string) => `## Safety steps (do these first, in order)
1. Stop everything that uses the project: every bd process, agent session, git hook and the bd-board app. A live embedded process holds the lock, and anything written during the move is lost.
2. Back up to JSONL and note the counts (write them down for the report):
\`\`\`bash
cd "${path}"
bd export -o ~/beads-backup.jsonl
wc -l ~/beads-backup.jsonl
bd count
\`\`\`
   Add \`--include-memories\` to \`bd export\` if the project uses \`bd remember\`. The JSONL is not a full backup: no Dolt history, branches or non-issue tables.
3. Check what points at the old location and note it, to re-add after the move:
\`\`\`bash
bd backup status
bd dolt remote list
bd where
\`\`\`
   Also look at \`.beads/dolt-backup.json\` (if present) and \`.beads/config.yaml\` for settings to copy back.
4. Never use \`--force\`, \`--reinit-local\` or \`--discard-remote\`. They destroy local or remote history. If bd refuses an operation, stop and report; do not override it.`

const ROLLBACK = `## Rollback
Nothing was deleted. Stop all bd processes, then swap the directories back. If anything was written after the move, run \`bd export -o ~/beads-after.jsonl\` first and \`bd import ~/beads-after.jsonl\` on the old project afterwards.
\`\`\`bash
mv .beads ../beads-new-rollback
mv ../beads-embedded-rollback .beads
bd count
bd dolt show --json
\`\`\`
\`bd count\` must give the old count and bd dolt show must say "embedded": true.`

const VERIFY = `bd count
bd list --all
bd export | wc -l`

function reinit(initLine: string, verify: string[]): string {
  return `## Procedure
\`\`\`bash
# 1. Move the embedded database aside (this is the rollback copy; do not delete it).
mv .beads ../beads-embedded-rollback

# 2. Re-init with the same prefix so ids stay stable.
${initLine}

# 3. Load the backup.
bd import ~/beads-backup.jsonl
\`\`\`
Copy back any settings noted from the old \`.beads/config.yaml\` with \`bd config set\`, and re-add the Dolt remotes and backup targets noted earlier. \`bd init\` aborts over an existing database; that is the data-safety contract, do not work around it.

## Verify
\`\`\`bash
${verify.join('\n')}
${VERIFY}
\`\`\`
bd count and the bd export line count must equal the backup counts. Spot-check a few ids, statuses and a bead with comments.`
}

function optionBody(option: MigrationOption, prefix: string): string {
  switch (option) {
    case 'shared-server':
      return `## Target: local shared-server
One bd-managed Dolt server for all projects under ~/.beads/shared-server. Do not pick proxied-server; it is experimental in bd 1.3.2. bd 1.3.2 has no embedded-to-server migrate subcommand, so the move is export, re-init, import.

${reinit(
  `bd init -p ${prefix} --shared-server --non-interactive --skip-agents --skip-hooks`,
  [
    'bd dolt show --json   # "embedded": false, "shared_server": true, "connection_ok": true',
  ],
)}

The first bd call that needs the server starts it. \`bd dolt status\` and \`bd dolt stop\` manage it.`
    case 'bucket-remote':
      return `## Target: bucket remote (S3, R2, GCS), for backup or occasional sync only
The project stays embedded, so reads stay local and fast; freshness is not. This does not speed bd up. Choose the shared-server option for speed.
- bd 1.3.2 cannot do this: \`bd dolt push\`, \`bd dolt pull\`, \`bd sync\` and \`bd init --remote\` fail with "unknown url scheme: 's3'". Use plain dolt (2.5.1) inside the embedded database directory; bd then reads and writes the result normally.
- Measured on R2 (234 beads, ~170 ms RTT): write visible on another replica 17.5 s; push 12.3 s; pull 5.2 s; no-op poll 2.6 s; clone 4.7 s.
- Two replicas editing the same bead between syncs conflict; the pull exits 1 and writes on that replica fail until a human resolves it.
- Credentials come from the standard AWS chain (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY), never in the url. Ask the person for the bucket and endpoint; do not guess.
- Run schema upgrades (\`bd migrate\`) on one designated machine only.
- Something other than bd-board must run the sync on a timer.

Stop bd while dolt runs. Then, after the safety steps:
\`\`\`bash
ls .beads/embeddeddolt            # the database directory name is <db>
cd .beads/embeddeddolt/<db>
dolt remote add r2 's3://<bucket>/<db>?endpoint=https://<account>.r2.cloudflarestorage.com&region=auto'
dolt push r2 main                 # first push, from the machine that has the data
dolt pull r2 main                 # later syncs; a new machine runs dolt clone <url>
\`\`\`
Verify from the project folder: bd count equals the noted count. Rollback is removing the remote with dolt remote remove r2; the local data is untouched.`
    case 'remote-server':
      return `## Target: remote dolt sql-server
Needs a server you control, with TLS and a database user. Ask the person for host, port, user and database; do not guess. Measured through a simulated 50-150 ms link: 0.2-0.6 s per bulk read. Each bd call pays several round trips, so bd itself feels slow at 150 ms.
- Credentials: set BEADS_DOLT_PASSWORD (highest priority) and BEADS_DOLT_SERVER_TLS=1, or use the credentials file ~/.config/beads/credentials (override with BEADS_CREDENTIALS_FILE; INI section [host:port], key password; mode 600). Never put a password on a command line or in the repository. --server-tls on bd init applies to that run only.
- To join an existing database on the server, add \`--database <name>\` to bd init.

${reinit(
  `bd init -p ${prefix} --server --server-host <host> --server-port <port> --server-user <user> --server-tls --non-interactive --skip-agents --skip-hooks`,
  [
    'bd dolt test',
    'bd dolt show --json   # "embedded": false, "connection_ok": true',
  ],
)}`
  }
}

export function buildMigrationPrompt(
  ctx: MigrationContext,
  option: MigrationOption,
): string {
  const prefix = ctx.prefix || '<prefix>'
  return `You are moving one bd (beads) project to a faster setup. Follow the steps in order. If anything differs from what is described, stop and report; do not improvise.

## Context
- Project path: ${ctx.path}
- Issue prefix: ${ctx.prefix || 'unknown (read it with: bd config get issue_prefix)'}
- Current mode: ${ctx.mode}
- bd version: ${ctx.bdVersion || 'unknown (check with: bd --version)'}

${WHY}

${SAFETY(ctx.path)}

${optionBody(option, prefix)}

${ROLLBACK}

## Report back
Report the before and after counts (bd count, backup line count), the mode shown by bd dolt show --json, and anything you changed or could not do.`
}
