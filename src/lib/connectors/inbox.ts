// Write-back inbox client for the http-snapshot connector (bdb-84h.14): a viewer without Dolt or bd
// queues a comment on the snapshot Worker; the owner's machine applies it with `bd comments add`.
// Not wired into the UI yet: the bead modal's comment box stays read-only until that follow-up.

export interface QueueCommentInput {
  bead: string
  body: string
  author: string
  /** Reuse the same id when retrying so the Worker and the applier see one comment. */
  clientId?: string
}

/** The inbox lives next to the manifest: `https://host/x/manifest` -> `https://host/x/inbox`. */
export function inboxUrl(manifestUrl: string) {
  const url = new URL(manifestUrl)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new Error('the inbox URL must be https (http only for localhost)')
  return new URL('inbox', url).toString()
}

/** Queue one comment. Resolves with the client id once the Worker answers 202; throws otherwise. */
export async function queueComment(
  manifestUrl: string,
  token: string,
  input: QueueCommentInput,
  doFetch: typeof fetch = fetch,
): Promise<{ clientId: string }> {
  const clientId = input.clientId ?? crypto.randomUUID()
  const res = await doFetch(inboxUrl(manifestUrl), {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      op: 'comment.add',
      bead: input.bead,
      body: input.body,
      author: input.author,
      client_id: clientId,
    }),
  })
  if (res.status !== 202) {
    const detail = (await res.text().catch(() => '')).slice(0, 200)
    throw new Error(`queue comment failed: HTTP ${res.status} ${detail}`.trim())
  }
  return { clientId }
}
