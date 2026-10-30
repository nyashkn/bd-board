# Remote projects and moving to shared-server mode

Two setup topics for the [read layer](read-layer.md). Both are `bd` setup steps you run yourself; bd-board adds no code for them. All numbers come from [reports/read-layer-poc.md](reports/read-layer-poc.md) (bd 1.3.2, Dolt 2.5.1, a 234-bead project).

- [A. Make a project faster: embedded to shared-server](#a-make-a-project-faster-embedded-to-shared-server)
- [B. Remote projects](#b-remote-projects)
- [The `sources` list](#the-sources-list)

## A. Make a project faster: embedded to shared-server

**Decision.** bd-board only detects the mode (`bd dolt show --json` reports `embedded: true` or `false`). It never migrates a project. This is a manual step, per project.

**Recommended mode: shared-server.** One bd-managed Dolt server for all your projects, under `~/.beads/shared-server`. Proxied-server (`--proxied-server`) is experimental in bd 1.3.2; do not pick it for this.

**Why.** Embedded Dolt takes a process lock, so every `bd` call spawns a cold engine and parallel calls queue behind each other. A server removes both.

| Operation (median)  | Embedded | Server |
| ------------------- | -------- | ------ |
| `list`              | 430 ms   | 89 ms  |
| `show`              | ~400 ms  | 72 ms  |
| One write (comment) | 372 ms   | 100 ms |
| 8 parallel `show`   | 4.3 s    | 0.13 s |

### Before you start

1. **Stop everything that uses the project**: every `bd` process, agent session, hook and the bd-board app. A live embedded process holds the lock, and anything that writes during the move is lost.
2. **Back up to JSONL and note the counts.**

   ```bash
   bd export -o ~/beads-backup.jsonl
   wc -l ~/beads-backup.jsonl
   bd count
   ```

   `bd export` writes issues with their labels, dependencies and comments. It is not a full backup: no Dolt history, branches or non-issue tables. Add `--include-memories` if you use `bd remember`.

3. **Check what points at the old location.** `bd backup status` and `.beads/dolt-backup.json` (if present) can hold an absolute path to the old embedded database. `bd dolt remote list` shows Dolt remotes. Note them; you re-add them after the move. Auto-backup is off in server mode by default (`bd backup --help`).
4. **Keep the old `.beads/`.** The steps below move it aside, not delete it. It is your rollback.

### Procedure

bd 1.3.2 has no embedded-to-server `migrate` subcommand: `bd migrate --help` lists only proxied, server and shared conversions. So the procedure is export, re-init, import.

```bash
cd <project>

# 1. Move the embedded database aside (rollback copy).
mv .beads ../<project>-beads-embedded

# 2. Re-init in shared-server mode, same prefix as before.
bd init -p <prefix> --shared-server --non-interactive --skip-agents --skip-hooks

# 3. Load the backup.
bd import ~/beads-backup.jsonl

# 4. Check.
bd dolt show --json        # "embedded": false, "shared_server": true, "connection_ok": true
bd count                   # must equal the count you noted
bd list --all              # spot-check ids, statuses, a bead with comments
bd export | wc -l          # must equal the backup line count
```

Notes:

- Use the **same prefix** (`bd config get issue_prefix` on the old project, or look at an id) so ids stay stable; import keeps the ids from the file.
- The new `.beads/` is a fresh one. Copy back any settings you changed in the old `.beads/config.yaml` (`bd config set …`, for example `events-journal`), and re-add Dolt remotes and backup targets noted above.
- `--skip-agents` and `--skip-hooks` keep `bd init` from rewriting `AGENTS.md` or git hooks; drop them if you want those regenerated.
- If a project's `.beads/` is tracked in git or redirected, check `bd where` first.
- `bd init` refuses to run over an existing database and aborts (it has a data-safety contract, see `bd help init-safety`). Never reach for `--reinit-local`, `--force` or `--discard-remote` here: they exist to destroy local or remote history.
- The first `bd` call that needs the shared server starts it. `bd dolt status` and `bd dolt stop` manage it.

### Rollback

Nothing was deleted, so rollback is a directory swap. Stop all `bd` processes first.

```bash
mv .beads ../<project>-beads-shared      # keep the new one until you are sure
mv ../<project>-beads-embedded .beads
bd count                                 # back to the old count
bd dolt show --json                      # "embedded": true
```

Anything written after the move exists only in the shared-server copy: `bd export -o after.jsonl` before you swap, then `bd import after.jsonl` on the embedded project. The empty database stays on the shared server; it is harmless.

### What was verified

On a throwaway project (synthetic beads, a temporary `HOME` so the real shared server was not touched) with bd 1.3.2: the export, move-aside, `bd init --shared-server`, `bd import` and check sequence above (issue count and a comment with its author came through), the rollback swap, and that `bd init` over an existing database aborts. Not tried: dependencies and labels in the round trip, a project with Dolt remotes or backup targets, a large project, and a git-tracked or redirected `.beads/`.

## B. Remote projects

In the owner's order of preference. bd-board sees a remote project the way it sees a local one: through the `bd` on your machine.

### 1. A central Dolt sql-server (recommended for live use)

Run `dolt sql-server` on a host you control and point each machine's `bd` at it. Measured through a simulated link (no jitter, loss or TLS) at 50 and 150 ms RTT: 0.2-0.6 s per bulk read and at most 0.15 s per change probe.

Server side (one time), with a config file so you can require TLS:

```bash
dolt sql-server --config server.yaml
```

Set `listener.host`, `listener.port`, `listener.tls_cert`, `listener.tls_key` and `listener.require_secure_transport: true` in `server.yaml` (`dolt sql-server --help` lists the keys). Create a database user for each person with a password; do not expose the port without TLS and a firewall.

Client side:

```bash
export BEADS_DOLT_PASSWORD=<password>
export BEADS_DOLT_SERVER_TLS=1
bd init -p <prefix> --server --server-host db.example.com --server-port 3306 --server-user <user> --server-tls
bd dolt test
```

- **Credentials.** `BEADS_DOLT_PASSWORD` has top priority. Otherwise bd reads `~/.config/beads/credentials` (override with `BEADS_CREDENTIALS_FILE`), an INI file keyed by the connection:

  ```ini
  [db.example.com:3306]
  password = <password>
  ```

  Keep the file mode 600. `bd dolt set` never stores a password or TLS flag, so `--server-tls` on `init` applies to that run only; set `BEADS_DOLT_SERVER_TLS=1` or use the credentials file for later commands. A desktop app started from Finder does not inherit shell variables, so use the credentials file there.

- **Joining an existing server database.** Use `bd init --server --server-host … --database <name>` (`--database` names the existing database), then `bd dolt show --json` to check.
- **Latency.** Each `bd` call pays several round trips, so expect `bd` itself to feel slow at 150 ms. That is where the dolt-sql connector helps: bd-board then sees `embedded: false` in `bd dolt show --json`, treats the project as server mode, and reads it over one SQL connection. Until that connector lands, bd-board reads through `bd` as before.
- **Writes** still go through `bd`, one writer at a time per bead as usual; there is no sync step and no conflict state.

### 2. A bucket remote (S3, R2, GCS)

For **backup or occasional sync only**. Every machine keeps a full local replica and reads are local and fast; freshness is not.

- **`bd` cannot do it in 1.3.2.** `bd dolt push`, `bd dolt pull`, `bd sync` and `bd init --remote` all fail with `unknown url scheme: 's3'`. Plain `dolt` 2.5.1 works, run inside the embedded database directory, and `bd` then reads and writes the result normally:

  ```bash
  cd <project>/.beads/embeddeddolt/<db>
  dolt remote add r2 's3://<bucket>/<db>?endpoint=https://<account>.r2.cloudflarestorage.com&region=auto'
  dolt push r2 main        # first push, from the machine that has the data
  dolt pull r2 main        # later syncs; a new machine runs `dolt clone <url>` instead
  ```

  `dolt remote --help` documents the `s3://` form, which needs a store with conditional writes (R2 qualifies; no DynamoDB). Stop `bd` on the project while `dolt` runs.

- **Measured on R2** (234 beads, 90 MiB, about 170 ms RTT to the edge):

  | Step                                | Time   |
  | ----------------------------------- | ------ |
  | Write to visible on another replica | 17.5 s |
  | Push (after one comment)            | 12.3 s |
  | Pull                                | 5.2 s  |
  | No-op poll                          | 2.6 s  |
  | Clone a replica                     | 4.7 s  |

- **Conflicts.** Two replicas that edit the same bead between syncs conflict. The pull exits 1 (`CONFLICT … in issues`) and writes on that replica fail until a human resolves it.
- **Credentials** are needed on every machine (`dolt` takes them from the standard AWS chain, for example `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; never in the url).
- **Schema upgrades** must be run on one machine only (run `bd migrate` on the single designated migrator, then publish; see `bd migrate --help` before adding any flag). Migrating two clones separately forks the schema and the next pull cannot merge (`bd migrate --help`).
- Something other than bd-board must run the sync on a timer.

### 3. An http snapshot (R2 plus a Worker)

Read-only, for viewers without Dolt (a browser or phone). **Not built yet**: planned as beads `bdb-84h.12` to `.14`. Measured in the POC: 0.6 s refresh, 244 ms no-change poll. It needs a token-gated Worker, so it is deferred until a no-Dolt viewer is wanted.

## The `sources` list

A project in `~/.config/bd-board/projects.json` can list where to read from, in preference order; bd-board uses the first that works (added by bead `bdb-84h.8`):

```json
{
  "id": "ledger",
  "path": "/path/to/ledger",
  "sources": [
    "bd:",
    "mysql://127.0.0.1:3307/mydb",
    "https://example.com/snap/manifest.json"
  ]
}
```

When absent, the default order is: embedded project, `bd`; server-mode project, Dolt SQL, then `bd`. Writes always go through `bd`.
