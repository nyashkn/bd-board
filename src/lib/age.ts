const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** "3h", "5d", "2mo", "1y": minutes < 1h, hours < 48h, days < 90d, months < 24mo, then years. */
export function formatSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms < MIN) return '<1m'
  if (ms < HOUR) return `${Math.floor(ms / MIN)}m`
  if (ms < 48 * HOUR) return `${Math.floor(ms / HOUR)}h`
  if (ms < 90 * DAY) return `${Math.floor(ms / DAY)}d`
  const days = ms / DAY
  if (days < 730) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

/** "12d ago" / "just now"; empty for a missing or unparsable timestamp. `now` is injected for tests. */
export function formatAge(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const ms = now - t
  if (ms < MIN) return 'just now'
  return `${formatSpan(ms)} ago`
}

/** Elapsed time between two ISO timestamps, "" when either is missing/invalid or negative. */
export function formatDuration(
  fromIso: string | undefined,
  toMs: number | undefined,
): string {
  if (!fromIso || toMs === undefined) return ''
  const from = Date.parse(fromIso)
  if (Number.isNaN(from) || toMs < from) return ''
  return formatSpan(toMs - from)
}
