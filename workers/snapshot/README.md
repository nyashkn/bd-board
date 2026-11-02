# Snapshot Worker

A token-gated Cloudflare Worker that serves bd-board snapshots from R2, plus the writer that publishes them. It backs the optional `http-snapshot` connector described in [docs/read-layer.md](../../docs/read-layer.md): a viewer for people without Dolt or `bd`. It is read-only except for the [write-back inbox](#write-back-inbox).

Nothing in this repository deploys it. Everything below runs locally unless the "Deploy" section is followed by the owner.

## How it works

| Route             | Token       | Behaviour                                                                                                                                                 |
| ----------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /manifest`   | read, write | `200` with `etag` and `cache-control: private, no-cache`, or `304` when `If-None-Match` matches.                                                          |
| `GET /snap/<key>` | read, write | Immutable gzip snapshot, `cache-control: private, max-age=31536000, immutable`, with an ETag. Keys match `^snap-[0-9a-f]{16,64}\.jsonl\.gz$`.             |
| `PUT /snap/<key>` | write       | Stores the body only if the key is absent. The key must equal `snap-` plus a prefix of the body's sha256, and the body must be gzip.                      |
| `PUT /manifest`   | write       | Compare-and-swap. Send `If-Match: <current etag>`, or `If-None-Match: *` for the first write. A lost race gets `412`. The `key` must exist in the bucket. |
| anything else     | none        | `404`. A missing or wrong token on the routes above gets `401`.                                                                                           |

The manifest is `{version: 1, key, sha256, size, counts: {issues, comments}, head, created_at}`. Readers verify `sha256` after downloading the snapshot.

The write token is separate from the read token and also reads (the writer needs the manifest ETag). If a secret is unset or empty, requests that need it are refused: the Worker fails closed.

## Write-back inbox

A viewer without Dolt or `bd` can queue a comment; the owner's machine applies it with `bd comments add`. Viewers hold `INBOX_TOKEN`, which can only queue items. It cannot read snapshots or the queue.

| Route                       | Token | Behaviour                                                                                                                                                                                                          |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /inbox`               | inbox | Body `{op, bead, body, author, client_id}`, `Content-Length` required (`411`), at most 128 KiB (`413`). Stored as `inbox/<client_id>.json` if absent; answers `202`, or `429` when more than 500 items are queued. |
| `GET /inbox`                | write | `{items, more, cursor}`: one page of up to 100 pending items. While `more`, pass `?cursor=<cursor>` for the next page.                                                                                             |
| `GET /inbox/_marker`        | write | A small object replaced on every accepted `POST`. Poll it with `If-None-Match` (`304` while nothing was queued) so the applier lists only when it changed.                                                         |
| `DELETE /inbox/<client_id>` | write | Acknowledge one item. `204`, also when it is already gone. With `?dead=1` the item is first copied to `inbox-dead/<client_id>.json` (dead letter).                                                                 |

Validation (`422` on failure, nothing stored): `op` must be `comment.add`; `bead` matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; `body` is 1 to 16 KiB with no control characters (newline and tab are allowed) and no bidi overrides; `author` is 1 to 64 printable characters; `client_id` is a UUID; no other fields. A `POST` with a `client_id` that is already queued answers `202` and keeps the first copy, so a viewer can retry safely.

Apply the queue on the owner's machine (run it from cron or a timer, one instance at a time):

```bash
SNAPSHOT_URL=https://snapshots.example.com \
SNAPSHOT_WRITE_TOKEN=<write token> \
  node --experimental-strip-types --no-warnings scripts/apply-inbox.ts [--dry-run] <project-dir>
```

Per item it re-validates and runs `bd comments add --author=<author> (inbox) -- <bead> <body>` (one argument array, no shell). The author gets the `(inbox)` suffix so a viewer cannot pose as a real actor, and the body ends with `(via inbox, <client_id>)`. It records the `client_id` in `<project-dir>/.beads/inbox-applied.json`, then acknowledges.

Exactly once: the item is saved as `pending` before `bd` runs. If the process dies anywhere after that, the next run reads the bead's comments (`bd comments <bead> --json`); a comment carrying the footer counts as applied and is only acknowledged, otherwise the item is retried. The id is recorded before the ack, so a crash between them only repeats the ack. A lock file next to the record (`inbox-applied.json.lock`, holding the pid) refuses a second concurrent run; a lock whose process is gone is taken over.

A bd failure keeps the item and the run exits 1. After 3 failed attempts, or when an item fails validation, the item is moved to `inbox-dead/` and acknowledged so it cannot stall the queue; the run reports `dead`. The write token is not passed to `bd` and is never logged. `--dry-run` prints the commands and changes nothing.

Limits: the local record must survive (it is under the gitignored `.beads/`). There is no per-token daily cap beyond the 500-item queue bound; add a Cloudflare rate-limit rule on `POST /inbox`. The Worker answers `503` to every request if `INBOX_TOKEN` equals `WRITE_TOKEN`. The UI does not use the inbox yet: `src/lib/connectors/inbox.ts` exports `queueComment` for the http-snapshot connector to call.

## Publish a snapshot

```bash
SNAPSHOT_URL=https://snapshots.example.com \
SNAPSHOT_WRITE_TOKEN=<write token> \
  node --experimental-strip-types --no-warnings scripts/publish-snapshot.ts [--dry-run] <project-dir>
```

It runs `bd export` in the project directory, gzips it, uploads `snap-<sha256 prefix>.jsonl.gz`, then moves the manifest with `If-Match`. It does nothing when the export matches the sha256 the manifest already names. `head` is the Dolt commit from `bd vc status --json`, or the sha256 if that is unavailable. `SNAPSHOT_URL` must be `https` (plain `http` is accepted only for `localhost`).

## Local development (no Cloudflare account needed)

```bash
cd workers/snapshot
pnpm install                                 # this package is its own pnpm workspace, with its own lockfile
pnpm test                                    # vitest in miniflare, simulated R2
pnpm typecheck
printf 'READ_TOKEN=local-read\nWRITE_TOKEN=local-write\n' > .dev.vars   # git-ignored
pnpm dev                                     # wrangler dev, local R2 under .wrangler/
```

Then, from the repo root, in another shell:

```bash
SNAPSHOT_URL=http://localhost:8787 SNAPSHOT_WRITE_TOKEN=local-write \
  node --experimental-strip-types --no-warnings scripts/publish-snapshot.ts <project-dir>
curl -i -H 'authorization: Bearer local-read' http://localhost:8787/manifest
```

`wrangler dev` uses a local R2 simulation unless the binding has `remote: true`. Do not add that for local work.

From the repo root, `pnpm test:snapshot-worker` runs the typecheck and tests. CI runs it in the frontend job after `pnpm --dir workers/snapshot install --frozen-lockfile`.

## Deploy (NOT done by this PR)

These steps create real Cloudflare resources and are for the owner to run later. Replace the placeholders.

```bash
cd workers/snapshot   # already there if you followed the local steps
pnpm exec wrangler r2 bucket create <bucket>          # keep it private: no r2.dev URL, no custom domain
# set bucket_name in wrangler.jsonc to <bucket>
pnpm exec wrangler secret put READ_TOKEN              # long random value, one per reader group
pnpm exec wrangler secret put WRITE_TOKEN             # different value, only the machine that publishes and applies the inbox
pnpm exec wrangler secret put INBOX_TOKEN             # third value, handed to viewers that may queue comments
pnpm exec wrangler deploy
```

Afterwards: confirm `curl https://<worker-host>/manifest` and `curl -X POST https://<worker-host>/inbox` return `401`, run the writer once, and confirm `GET /manifest` returns `200` then `304` with `If-None-Match`.

Operational notes:

- Rotate a token with `wrangler secret put` again; there is no per-client identity or revocation. Prefer Cloudflare Access service tokens in front of the Worker if you need that.
- A failed manifest write can leave an orphan snapshot. Delete old snapshots by age, always keeping the one the manifest names and the previous one.
- There is no rate limiting. Add a Cloudflare rate-limit rule if the URL is exposed publicly.
