# Snapshot Worker

A token-gated Cloudflare Worker that serves bd-board snapshots from R2, plus the writer that publishes them. It backs the optional `http-snapshot` connector described in [docs/read-layer.md](../../docs/read-layer.md): a read-only viewer for people without Dolt or `bd`.

Nothing in this repository deploys it. Everything below runs locally unless the "Deploy" section is followed by the owner.

## How it works

| Route             | Token       | Behaviour                                                                                                                                                 |
| ----------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /manifest`   | read, write | `200` with `etag` and `cache-control: no-cache`, or `304` when `If-None-Match` matches.                                                                   |
| `GET /snap/<key>` | read, write | Immutable gzip snapshot, `cache-control: private, max-age=31536000, immutable`, with an ETag. Keys match `^snap-[0-9a-f]{8,64}\.jsonl\.gz$`.              |
| `PUT /snap/<key>` | write       | Stores the body only if the key is absent. The key must equal `snap-` plus a prefix of the body's sha256, and the body must be gzip.                      |
| `PUT /manifest`   | write       | Compare-and-swap. Send `If-Match: <current etag>`, or `If-None-Match: *` for the first write. A lost race gets `412`. The `key` must exist in the bucket. |
| anything else     | none        | `404`. A missing or wrong token on the routes above gets `401`.                                                                                           |

The manifest is `{version: 1, key, sha256, size, counts: {issues, comments}, head, created_at}`. Readers verify `sha256` after downloading the snapshot.

The write token is separate from the read token and also reads (the writer needs the manifest ETag). If a secret is unset or empty, requests that need it are refused: the Worker fails closed.

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
pnpm exec wrangler secret put WRITE_TOKEN             # different value, only the machine that publishes
pnpm exec wrangler deploy
```

Afterwards: confirm `curl https://<worker-host>/manifest` returns `401`, run the writer once, and confirm `GET /manifest` returns `200` then `304` with `If-None-Match`.

Operational notes:

- Rotate a token with `wrangler secret put` again; there is no per-client identity or revocation. Prefer Cloudflare Access service tokens in front of the Worker if you need that.
- A failed manifest write can leave an orphan snapshot. Delete old snapshots by age, always keeping the one the manifest names and the previous one.
- There is no rate limiting. Add a Cloudflare rate-limit rule if the URL is exposed publicly.
