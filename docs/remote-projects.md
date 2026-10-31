# Remote projects and moving to shared-server mode

Two setup topics for the [read layer](read-layer.md). Both are `bd` setup steps you run yourself; bd-board never creates, migrates or syncs a server. (Reading a server over SQL is the `dolt-sql` connector, below.) All numbers come from [reports/read-layer-poc.md](reports/read-layer-poc.md) (bd 1.3.2, Dolt 2.5.1, a 234-bead project).

- [A. Make a project faster: embedded to shared-server](#a-make-a-project-faster-embedded-to-shared-server)
- [B. Remote projects](#b-remote-projects)
- [Reading a hub over SQL (dolt-sql)](#reading-a-hub-over-sql-dolt-sql)
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

In the owner's order of preference. There are two shapes, and they differ in where the data you read lives:

- **A local ledger, synced.** The project has a real `.beads/` on your machine, kept current with `bd federation sync` or `bd dolt pull` (and a bucket remote in option 2). bd-board reads it through `bd-cli` like any local project, writes go through `bd`, and the data is exactly as fresh as the last sync; bd-board does not show when that was, so run the sync on a timer you control and check `bd federation status`.
- **Direct read-only SQL.** Nothing is synced: bd-board connects to the server and reads over SQL (`dolt-sql`, see below). Always current within a second, no local `bd` needed, read-only.

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
- **Latency.** Each `bd` call pays several round trips, so expect `bd` itself to feel slow at 150 ms. That is where the dolt-sql connector helps: bd-board sees `embedded: false` in `bd dolt show --json`, treats the project as server mode, and reads it over one SQL connection (one round trip per refresh).
- **Writes** still go through `bd`, one writer at a time per bead as usual; there is no sync step and no conflict state.

### Reading a hub over SQL (dolt-sql)

Desktop app only. The `dolt-sql` connector reads the beads straight from the Dolt server, read-only, on one connection per project; the web build skips it. It is used automatically for a local project in server mode, and for a remote hub when you list the hub as a source.

**1. Create a SELECT-only user on the server.** Hub grants can be global (on one hub, pull needs `CLONE_ADMIN` and push needs `SUPER`), so never reuse the account you push or pull with: bd-board only reads, and the read-only transaction it opens does not stop DDL or `CALL` in Dolt 2.5.1. Run as an admin:

```sql
CREATE USER 'bd_board_reader'@'%' IDENTIFIED BY '<password>';
GRANT SELECT ON mydb.* TO 'bd_board_reader'@'%';
```

(Checked on a local Dolt 2.5.1 server: this user can run every query bd-board sends, including `DOLT_DIFF`, and is refused `INSERT`, `CREATE TABLE` and `CALL`.) Require TLS on the server (`listener.require_secure_transport: true`).

**2. List the hub as a source, with the names of the variables that hold the login.** (`credentials_ref` is one field shared by the connectors: an object like the one below for dolt-sql, a plain `BD_BOARD_SNAPSHOT_*` string for an http snapshot; each connector accepts only its own form.) Never put the user or password in `projects.json`: a `mysql://` URL with a user or password is rejected at load, and `credentials_ref` takes variable **names** only, and only two forms are accepted: exactly `DOLT_REMOTE_USER` / `DOLT_REMOTE_PASSWORD`, or a name starting with `BD_BOARD_DOLT_` (for example `BD_BOARD_DOLT_HUB_PASSWORD`). Any other name, such as `AWS_SECRET_ACCESS_KEY`, is rejected when the registry loads, so an entry cannot point an unrelated secret at a host. A host other than `localhost`, `127.0.0.0/8` or `::1` also needs `?tls=true` (or `BEADS_DOLT_SERVER_TLS=1`); without it the source is refused before any password is read.

```json
{
  "id": "hub",
  "path": "/path/to/placeholder-dir",
  "label": "Hub",
  "sources": ["mysql://dolt-hub.example:3306/mydb?tls=true", "bd:"],
  "credentials_ref": {
    "user": "DOLT_REMOTE_USER",
    "password": "DOLT_REMOTE_PASSWORD"
  }
}
```

Set `DOLT_REMOTE_USER` and `DOLT_REMOTE_PASSWORD` in the environment of the app. An app started from Finder does not see your shell variables: set them with `launchctl setenv`, or start the app from a terminal. Without `credentials_ref`, an explicit `mysql://` source uses the `[host:port]` entry of `~/.config/beads/credentials` (bd's own `BEADS_DOLT_*` variables are only used for the server `bd dolt show` reports, never for a host named in `sources`). TLS is verified against the bundled web PKI roots; a private CA is not supported yet. A keychain reference is not implemented.

**3. What you get, and what you do not.**

- A refresh and a change probe are one round trip each (so about one RTT, 0.3 s at 290 ms; measured only against a local server, not a real hub); a write made by anyone through `bd` shows up within about a second.
- Everything is shown: closed beads and gates too.
- Writes stay on `bd`. A project that lists only `mysql://` sources (no `bd:`) has no local `bd` to write through, so it is **read-only** in the UI and every write command refuses it. List `bd:` as well if the directory is a real bd project that should stay writable.
- Ready and blocked come from the local `bd`, so a hub with no local `bd` shows them as unavailable (a small note on the board), not as a guess.
- Off-network (refused, timed out) the read fails within 2 s, the router tries the next source (for `["mysql://…", "bd:"]` that is the local ledger), and if none works the board keeps the last snapshot and says "Hub unreachable, showing last snapshot (age)". A wrong password, missing grants, an unknown bd schema version or a missing `tls=true` is different: it is shown as "source misconfigured (dolt-sql)" and does not fall back. Error text never contains the host, user, password or URL.
- It reads the Dolt head, so commits made with `dolt-auto-commit` set to `batch` (uncommitted until `bd dolt commit`) are not seen until committed.
- The hub's R2 replica is a Dolt remote, not a bd-board format: bd-board never reads it.

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

Read-only, for viewers without Dolt (a browser or phone). The Worker and writer are in `workers/snapshot/` (not deployed by this repo); the client connector is `http-snapshot` (bead `bdb-84h.12`). Measured in the POC: 0.6 s refresh, 244 ms no-change poll.

```json
{
  "id": "ledger",
  "path": "/path/to/ledger",
  "sources": ["https://snap.example.com/manifest.json"],
  "credentials_ref": "BD_BOARD_SNAPSHOT_LEDGER",
  "readonly": true
}
```

- **Source URL.** The Worker's address; a trailing `/manifest.json` or `/manifest` is dropped and the connector requests `<base>/manifest` and `<base>/snap/<key>`. Only `https://` is accepted.
- **Token.** `credentials_ref` is the _name_ of an environment variable that holds the Worker's **read** token (never the token itself). The name must match `BD_BOARD_SNAPSHOT_[A-Z0-9_]+`; the registry (web and desktop parsers) rejects any other name, so an entry cannot make the server send an unrelated secret such as `AWS_SECRET_ACCESS_KEY` to its own source. Set it in the environment of the bd-board web server. The fetch runs on that server, so the token never reaches the browser, RUM or logs, and the Worker needs no CORS. The desktop app has no HTTP client yet and skips this source (the next source in `sources` is used).
- **Read-only.** Writes are refused with a clear error and never retried or sent to another source; the board hides write controls while this source is active (and, until the first read, whenever the first source is `https://`). A project that only has an http snapshot should also set `"readonly": true` in the registry, as in the example. Ready and blocked are not in a snapshot, so they are unavailable and the board uses the link-based rule.
- **Freshness.** The open project polls the manifest every 30 s (`If-None-Match`, so an unchanged snapshot costs a 304). A changed manifest downloads the snapshot, checks its size and sha256, inflates it (capped at 64 MiB) and refreshes the board. A manifest whose `created_at` goes backwards is treated as a replay: it is ignored with a warning and the last verified snapshot stays on screen. The snapshot is requested with `accept-encoding: identity`, and a response carrying a `content-encoding` is refused, because the sha256 covers the gzip bytes themselves.
- **Errors.** A network error (including a body that dies mid-download) or HTTP 5xx falls back to the next source. A 401 stops with "snapshot token rejected" and does not fall back.

## The `sources` list

A project in `~/.config/bd-board/projects.json` can list where to read from, in preference order; bd-board uses the first that works (added by bead `bdb-84h.8`):

```json
{
  "id": "ledger",
  "path": "/path/to/ledger",
  "sources": [
    "bd:",
    "mysql://127.0.0.1:3307/mydb",
    "https://snap.example.com/manifest.json"
  ]
}
```

When absent, the default order is: embedded project, `bd`; server-mode project, Dolt SQL, then `bd`. Writes always go through `bd`. A list without any `bd:` entry makes the project read-only. `credentials_ref` (names of environment variables for the SQL user and password) belongs to the same entry; see [Reading a hub over SQL](#reading-a-hub-over-sql-dolt-sql).
