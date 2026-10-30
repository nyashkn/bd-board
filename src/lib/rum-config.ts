/**
 * OpenObserve RUM config: opt-in, nothing baked in. Sources, in order: the runtime config the
 * app serves (`/api/rum-config`, or the desktop `rum_config` command, both reading
 * ~/.config/bd-board/rum.json), then `VITE_O2_RUM_*` at build time. Invalid = RUM off.
 */

export type RumProfile = 'full' | 'standard' | 'minimal'

export interface RumConfig {
  site: string
  organizationIdentifier: string
  /** SDK 0.4.3 has no `applicationName` option: this is sent as its `applicationId`. */
  applicationName: string
  applicationId?: string
  clientToken: string
  service?: string
  env: string
  profile: RumProfile
  insecureHTTP: boolean
  sampleRate: number
  replaySampleRate: number
  /** Shown as the RUM user name in `full` only. */
  userName?: string
}

export type RumConfigResult =
  | { state: 'off' }
  | { state: 'invalid'; reason: string }
  | { state: 'on'; config: RumConfig }

const PROFILES = new Set<RumProfile>(['full', 'standard', 'minimal'])
const SITE_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function pct(v: unknown, fallback: number, label: string): number {
  if (v === undefined || v === null || v === '') return fallback
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100)
    throw new Error(`${label} must be a number from 0 to 100`)
  return n
}

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === '1' || v === 1
}

/** Pure: takes any parsed JSON, never throws, never echoes the token in a reason. */
export function parseRumConfig(raw: unknown): RumConfigResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { state: 'off' }
  const r = raw as Record<string, unknown>
  if (!bool(r.enabled)) return { state: 'off' }
  try {
    const site = str(r.site)
    if (!SITE_RE.test(site))
      throw new Error('site must be host[:port], no scheme or path')
    const organizationIdentifier = str(r.organizationIdentifier)
    if (!SLUG_RE.test(organizationIdentifier))
      throw new Error('organizationIdentifier is required')
    const clientToken = str(r.clientToken)
    if (!clientToken) throw new Error('clientToken is required')
    const profile = (str(r.profile) || 'full') as RumProfile
    if (!PROFILES.has(profile))
      throw new Error('profile must be full, standard or minimal')
    const service = str(r.service) || undefined
    if (service && !SLUG_RE.test(service)) throw new Error('service is invalid')
    return {
      state: 'on',
      config: {
        site,
        organizationIdentifier,
        applicationName: str(r.applicationName) || 'bd-board',
        applicationId: str(r.applicationId) || undefined,
        clientToken,
        service,
        env: str(r.env) || 'production',
        profile,
        insecureHTTP: bool(r.insecureHTTP),
        sampleRate: pct(r.sampleRate, 100, 'sampleRate'),
        replaySampleRate: pct(r.replaySampleRate, 100, 'replaySampleRate'),
        userName: str(r.userName) || undefined,
      },
    }
  } catch (err) {
    return {
      state: 'invalid',
      reason: err instanceof Error ? err.message : 'invalid config',
    }
  }
}

/** Maps `<prefix>ENABLED`, `<prefix>SITE`, ... env-style keys to the config shape. */
export function configFromEnv(
  env: Record<string, string | undefined>,
  prefix: string,
): Record<string, unknown> {
  const k = (name: string) => env[`${prefix}${name}`]
  return {
    enabled: k('ENABLED'),
    site: k('SITE'),
    organizationIdentifier: k('ORG'),
    applicationName: k('APP_NAME'),
    applicationId: k('APP_ID'),
    clientToken: k('CLIENT_TOKEN'),
    service: k('SERVICE'),
    env: k('ENV'),
    profile: k('PROFILE'),
    insecureHTTP: k('INSECURE_HTTP'),
    sampleRate: k('SAMPLE_RATE'),
    replaySampleRate: k('REPLAY_SAMPLE_RATE'),
    userName: k('USER'),
  }
}

/** Defined keys of `over` win over `base`. */
export function mergeConfig(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...base }
  for (const [key, value] of Object.entries(over))
    if (value !== undefined && value !== '') out[key] = value
  return out
}
