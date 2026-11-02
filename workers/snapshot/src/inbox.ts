// Inbox item validation, shared by the Worker (POST /inbox) and the applier (scripts/apply-inbox.ts).
// Pure: no Worker or Node imports, so both sides can load it.

export interface InboxItem {
  op: 'comment.add'
  bead: string
  body: string
  author: string
  client_id: string
}

export const BEAD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_BODY_BYTES = 16 * 1024
// \p{C} is control, format, surrogate, private-use and unassigned: not printable.
const PRINTABLE_AUTHOR = /^[^\p{C}]{1,64}$/u
// Control characters (NUL, CR, escapes, C1) and bidi overrides, except \n and \t: they can hide or
// rewrite text in a terminal or a viewer. shortcut: lone surrogates are not checked.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\x00-\x08\x0B-\x1F\x7F-\x9F\u202A-\u202E\u2066-\u2069]/
const KEYS = ['op', 'bead', 'body', 'author', 'client_id']

/** Validate an untrusted value. Returns the item (client_id lower-cased) or a reason string. */
export function parseInboxItem(v: unknown): InboxItem | string {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    return 'item must be an object'
  const m = v as Record<string, unknown>
  const extra = Object.keys(m).find((k) => !KEYS.includes(k))
  if (extra !== undefined) return `unknown field ${extra.slice(0, 32)}`
  const { op, bead, body, author, client_id } = m
  if (op !== 'comment.add') return 'op must be comment.add'
  if (typeof bead !== 'string' || !BEAD_ID.test(bead))
    return 'bead is not a valid bead id'
  if (typeof body !== 'string' || body.length === 0 || UNSAFE_TEXT.test(body))
    return 'body must be non-empty text without control characters'
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES)
    return 'body is larger than 16 KiB'
  if (
    typeof author !== 'string' ||
    !PRINTABLE_AUTHOR.test(author) ||
    UNSAFE_TEXT.test(author)
  )
    return 'author must be 1-64 printable characters'
  if (typeof client_id !== 'string' || !UUID.test(client_id))
    return 'client_id must be a UUID'
  return { op, bead, body, author, client_id: client_id.toLowerCase() }
}
