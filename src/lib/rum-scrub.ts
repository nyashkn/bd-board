import type { RumProfile } from './rum-config.ts'

/** Loose view of the SDK event: only the fields the scrubber touches. */
export interface ScrubEvent {
  type?: string
  view?: { url?: string; referrer?: string; name?: string }
  resource?: {
    url?: string
    request?: { headers?: Record<string, unknown> }
    response?: { headers?: Record<string, unknown> }
  }
  error?: { message?: string; stack?: string }
  action?: { type?: string; target?: { name?: string } }
  usr?: unknown
  context?: Record<string, unknown>
  [key: string]: unknown
}

const AUTO_ACTIONS = new Set(['click', 'tap', 'scroll', 'swipe', 'back'])

export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut < 0 ? url : url.slice(0, cut)
}

/**
 * Applies a privacy profile to one event, in place. Returns false to drop it.
 *  full     pass-through: everything (URLs with ?bead=/q=, click targets, user, error text).
 *  standard query strings stripped, error text capped, no user, click targets masked.
 *  minimal  standard, plus no click events: performance and errors only.
 */
export function scrubEvent(
  event: ScrubEvent,
  profile: RumProfile,
  secrets: readonly string[] = [],
): boolean {
  dropSecrets(event, secrets)
  if (profile === 'full') return true
  if (event.view?.url) event.view.url = stripQuery(event.view.url)
  if (event.view?.referrer)
    event.view.referrer = stripQuery(event.view.referrer)
  if (event.resource?.url) event.resource.url = stripQuery(event.resource.url)
  if (event.error?.message)
    event.error.message = event.error.message.slice(0, 200)
  delete event.usr
  // Our own `custom` actions carry fixed names; only the SDK's click-style ones name page text.
  if (
    event.type === 'action' &&
    event.action?.type &&
    AUTO_ACTIONS.has(event.action.type)
  ) {
    if (profile === 'minimal') return false
    if (event.action.target) event.action.target.name = 'masked'
  }
  return true
}

const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie)$/i

/** Every profile, `full` included: never a credential header, never our own client token. */
function dropSecrets(event: ScrubEvent, secrets: readonly string[]): void {
  for (const headers of [
    event.resource?.request?.headers,
    event.resource?.response?.headers,
  ]) {
    if (headers)
      for (const key of Object.keys(headers))
        if (SECRET_HEADER.test(key)) delete headers[key]
  }
  const live = secrets.filter(Boolean)
  if (!live.length) return
  const redact = (v: string) =>
    live.reduce((t, x) => t.split(x).join('[redacted]'), v)
  const { error, resource, view } = event
  if (error?.message) error.message = redact(error.message)
  if (error?.stack) error.stack = redact(error.stack)
  if (resource?.url) resource.url = redact(resource.url)
  if (view?.url) view.url = redact(view.url)
}
