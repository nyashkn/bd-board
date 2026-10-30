# Read-layer POC: measurements

These are the measurements behind [read-layer.md](../read-layer.md). The grid is MECE: every connector is crossed with every operation class, and each cell is either measured or N/A with a reason.

## Setup

- **Data.** A copy of a real tracker: 234 beads, 719 comments, 350 dependencies and 519 labels. Its embedded Dolt database is 90 MiB with 1,390 commits, or 22.6 MB after `dolt gc`. Only counts and timings are reported here.
- **Tools.** bd 1.3.2 and Dolt 2.5.1 on an Apple-silicon laptop.
- **Network.** The client is about 170 ms RTT from the nearest Cloudflare edge.
- **Statistics.** Times are medians, with p95 in brackets where N ≥ 10. Unless a row says otherwise, N is 7 to 31 after one warm-up. Below N=10 the "p95" is the maximum.
- **Simulated remote.** The remote-server rows went through a local TCP proxy that adds a fixed delay. There was no loss, jitter or TLS.
- **R2 rows.** These used a private throwaway bucket and Worker, deleted after the run. The Worker served a synthetic, scrambled snapshot of the same size. The Dolt-over-R2 run pushed the copied database itself.

## Connectors

| Connector     | What it is                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Embedded `bd` | `bd` CLI on the default embedded Dolt engine                                                                   |
| Server `bd`   | `bd` CLI on a project whose Dolt runs as a local `dolt sql-server`                                             |
| SQL local     | Raw SQL over one persistent connection to that server                                                          |
| SQL remote    | The same, through a simulated RTT of 50 ms and 150 ms                                                          |
| R2 Worker     | Immutable `snap-<commit>.jsonl.gz` plus `manifest.json` (ETag/304), served by a token-gated Worker             |
| Dolt over R2  | R2 used directly as a Dolt remote (`s3://…?endpoint=…&region=auto`), with a full local replica on each machine |

## The grid

| Operation                           | Embedded `bd`                                                                       | Server `bd`                                               | SQL local                                           | SQL remote (50 / 150 ms)                             | R2 Worker                                                                                                         | Dolt over R2                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Cold start**                      | first call 410 ms (warm OS cache, N=1)                                              | server start 90 ms, then first call 121 ms (N=1)          | connect ≈ 3.5 RTT                                   | ≈ 175 / 525 ms connect                               | 1029 ms after deploy, 691 ms after 7 min idle (N=1 each)                                                          | clone a replica 4.7 s; first push to an empty bucket 11.2 s                                      |
| **Bulk read** (whole project)       | `export` 414 (803); `list` 430 (754)                                                | `export` 95 (134); `list` 89 (107)                        | issues + comments + deps 6.4 ms; 6.9 ms with labels | 167 / 470 ms                                         | snapshot 339 ms + gunzip 1.2 + parse 1.4; full refresh 590 ms                                                     | local reads on the replica: `list` 380 ms, `export` 370 ms                                       |
| **Point read** (one bead)           | `show` ≈ 400; `comments` ≈ 205                                                      | `show` 72; `comments` 70                                  | 1 ms (4 queries)                                    | 212 / 613 ms                                         | N/A: served from the snapshot                                                                                     | `show` 350 ms (local)                                                                            |
| **Change detect** (nothing changed) | `bd vc status` 229                                                                  | 84; `bd sql HASHOF` 79                                    | `HASHOF('HEAD')` 0.1 ms                             | 53 / 153 ms                                          | manifest 304: 244 ms, 0 B body                                                                                    | no-op pull or fetch: 2.6 s; signed GET of the remote manifest 0.29 s (not proven as a signal)    |
| **Delta** (what changed)            | N/A: no delta command; use feed ids                                                 | N/A (same)                                                | `DOLT_DIFF(from, HEAD, 'issues')` < 1 ms            | 53 / 153 ms                                          | N/A: full snapshot only                                                                                           | pull 5.2 s                                                                                       |
| **Single write**                    | comment 372; status 381; create 529; delete 385; label 317                          | comment 100; status 112; create 142; delete 95; label 104 | N/A: bd owns writes                                 | N/A                                                  | inbox POST 422 ms; applying it on the owner's machine adds one `bd` write                                         | incremental push after one comment 12.3 s (15.0)                                                 |
| **Write → visible**                 | `events tail --follow`: 1008 (1796)                                                 | `events tail --follow`: 815 (1031)                        | `HASHOF` poll every 100 ms: 175 (217)               | not measured (expected ≈ RTT plus the poll interval) | derived: about 3 s (inbox 0.4 + `bd` write 0.4 + export 0.4 + publish 1.3 + refresh 0.6) plus both poll intervals | push + pull 17.5 s (20.8)                                                                        |
| **Concurrent**                      | 8 parallel `show` 4289 (lock serializes); a write next to 3 reads 1508 vs 372 alone | 8 parallel `show` 126; a write next to reads 114, flat    | 32 pooled reads 10.9 ms                             | 4 RTT for 1, 8 or 32                                 | not measured                                                                                                      | push race on different beads: the loser gets exit 1 after about 16 s and converges in about 32 s |
| **Conflict** (same bead)            | N/A: one database                                                                   | N/A                                                       | N/A                                                 | N/A                                                  | N/A: single writer                                                                                                | pull exits 1 (`CONFLICT … in issues`); writes on that replica fail until a human resolves it     |

All values in the first four connector columns are in ms unless shown otherwise.

### Idle cost of watching for changes (60 s, N=1 each)

| Method                             | Client CPU              | Other                                              |
| ---------------------------------- | ----------------------- | -------------------------------------------------- |
| Embedded `bd events tail --follow` | 1.67 s (2.8% of a core) | 114 MB RSS; it slows each write from 372 to 444 ms |
| Embedded `bd vc status` every 2 s  | 6.43 s (10.7%)          | 30 process spawns                                  |
| Server `bd events tail --follow`   | 0.08 s                  | server +0.13 s                                     |
| SQL `HASHOF` every 100 ms          | 0.11 s                  | server +0.62 s (1% of a core)                      |

## Facts found

- **Commit cadence.** `bd` commits every write to Dolt in both modes, and `HASHOF('HEAD')` moved on 66 of 66 writes, delete included. That makes the head hash a valid change cursor.
- **The embedded lock.** It serializes every `bd` process, reads and writes alike, and the total is worse than running them one after another. Server mode removes the contention.
- **The events feed is about one second behind** in both modes, which looks like a roughly 1 s poll inside `bd`. A head-hash poll on an open SQL connection sees a write in about 175 ms.
- **Multi-id `show`** costs about 270 ms per id in embedded mode, and about 6 ms per id in server mode.
- **Export contents.** `export` carries comments, labels and dependencies. It also includes rows that `list` hides (for example `gate`), has no `parent` field, and leaves dependency targets without their title, status and type.
- **bd 1.3.2 cannot use an `s3://` remote.** `bd dolt push/pull`, `bd sync` and `bd init --remote` all fail with `unknown url scheme: 's3'`. Plain `dolt` 2.5.1 works against R2 when run inside `.beads/embeddeddolt/<db>`, and `bd` reads and writes the result normally.
- **A 304 from the R2 Worker saves bytes, not time.** It costs the same round trip as a 200 when the manifest is 371 B.
- **Free tier.** One client polling a Worker manifest every 30 s uses 86,400 Class B operations a month, 0.9% of the 10 M free allowance.

## What this means

| Use                               | Best measured option                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Local project, zero config        | Embedded `bd` with one process per project at a time and a client-side snapshot: ≈ 0.8 s per refresh, 0 calls per bead open     |
| Local project, fast               | Server mode: 4-5x faster `bd` with no bd-board code. Add SQL for 0.1 ms change detection and 175 ms write-to-visible.           |
| Remote, live                      | A central Dolt sql-server: 0.2-0.6 s bulk read and ≤ 0.15 s change probe at 50-150 ms RTT                                       |
| Remote, backup or occasional sync | Dolt over R2: reads are local and fast, but freshness is 17.5 s, a no-op poll costs 2.6 s, and bd 1.3.2 needs raw `dolt` for it |
| Viewer without Dolt (web, phone)  | R2 Worker snapshot: 0.6 s refresh, 244 ms no-change poll, read-only unless an inbox is built                                    |

## Not measured

- A truly cold disk.
- Remote SQL write-to-visible.
- Real WAN behaviour for SQL: jitter, loss and TLS.
- Concurrent readers on the R2 Worker.
- `bd sync` on R2, which can't be measured because bd 1.3.2 rejects `s3://`.
- `bd serve`, which refuses temporary workspaces.
- What makes a push take 12 s. Untraced; it is probably many round trips.
