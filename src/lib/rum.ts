import { scrubEvent } from './rum-scrub.ts'

import type { RumConfig, RumProfile } from './rum-config.ts'
import type { ScrubEvent } from './rum-scrub.ts'

/**
 * OpenObserve RUM facade. Every export is a cheap no-op while RUM is off (one string compare, no
 * allocation), so call sites need no guards. While the config is still loading ('pending', the
 * first moments after paint) a bounded queue holds early events.
 *
 * Privacy contract: `ctx` is always safe to send (names, counts, durations). `detail` may name
 * projects or beads and is sent in the `full` profile only.
 */

type Mode = 'pending' | 'on' | 'off'
type Ctx = Record<string, string | number | boolean>

/** The subset of the SDK this module calls; tests pass a fake. */
export interface RumSdk {
  init: (config: Record<string, unknown>) => void
  startView: (name: string) => void
  addAction: (name: string, context?: object) => void
  addError: (error: unknown, context?: object) => void
  addDurationVital: (
    name: string,
    options: { startTime: number; duration: number; context?: object },
  ) => void
  setUser: (user: { id?: string; name?: string }) => void
}

type Op =
  | ['vital', string, number, number, Ctx | undefined, Ctx | undefined]
  | ['action', string, Ctx | undefined, Ctx | undefined]
  | ['error', unknown, Ctx | undefined]
  | ['view', string]

const QUEUE_CAP = 100
const PCT_RING = 256
const PCT_FLUSH_MS = 1500

let mode: Mode = 'pending'
let profile: RumProfile = 'full'
let sdk: RumSdk | null = null
let queue: Op[] = []

export const rumMode = (): Mode => mode

/** Milliseconds for a later `rumDuration`; 0 when off (the value is then never read). */
export function rumNow(): number {
  return mode === 'off' ? 0 : performance.now()
}

function emit(op: Op): void {
  if (mode === 'pending') {
    if (queue.length < QUEUE_CAP) queue.push(op)
    return
  }
  if (!sdk) return
  const merge = (ctx?: Ctx, detail?: Ctx) =>
    profile === 'full' && detail ? { ...ctx, ...detail } : ctx
  try {
    switch (op[0]) {
      case 'vital':
        sdk.addDurationVital(op[1], {
          startTime: performance.timeOrigin + op[2],
          duration: op[3],
          context: merge(op[4], op[5]),
        })
        break
      case 'action':
        sdk.addAction(op[1], merge(op[2], op[3]))
        break
      case 'error':
        sdk.addError(op[1], op[2])
        break
      case 'view':
        sdk.startView(op[1])
        break
    }
  } catch {
    // telemetry must never break the app
  }
}

/** A duration that started at `t0` (from `rumNow`, or 0 for "since page start") and ends now. */
export function rumDuration(
  name: string,
  t0: number,
  ctx?: Ctx,
  detail?: Ctx,
): void {
  if (mode === 'off') return
  emit(['vital', name, t0, performance.now() - t0, ctx, detail])
}

export function rumAction(name: string, ctx?: Ctx, detail?: Ctx): void {
  if (mode === 'off') return
  emit(['action', name, ctx, detail])
}

export function rumError(error: unknown, ctx?: Ctx): void {
  if (mode === 'off') return
  emit(['error', error, ctx])
}

export function rumView(name: string): void {
  if (mode === 'off') return
  emit(['view', name])
}

const marked = new Set<string>()
/** Once per page load: time since navigation start (cold-load phases). */
export function rumMarkCold(name: string, ctx?: Ctx, detail?: Ctx): void {
  if (mode === 'off' || marked.has(name)) return
  marked.add(name)
  rumDuration(name, 0, ctx, detail)
}

/** Wraps an async bd/IPC call: duration, command name and ok/error. Never args or output. */
export function tracked<TArgs extends unknown[], TResult>(
  cmd: string,
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) =>
    mode === 'off' ? fn(...args) : trace(cmd, fn, args)
}

async function trace<TArgs extends unknown[], TResult>(
  cmd: string,
  fn: (...args: TArgs) => Promise<TResult>,
  args: TArgs,
): Promise<TResult> {
  const t0 = performance.now()
  const first = args[0] as { data?: { project?: unknown } } | undefined
  const project = first?.data?.project
  const detail = typeof project === 'string' ? { project } : undefined
  try {
    const out = await fn(...args)
    rumDuration(`bd.call.${cmd}`, t0, { ok: true }, detail)
    return out
  } catch (err) {
    rumDuration(`bd.call.${cmd}`, t0, { ok: false }, detail)
    throw err
  }
}

// Per-keystroke search cost, reported as p50/p95 once typing pauses.
const ring = new Float64Array(PCT_RING)
let ringN = 0
let ringTimer: ReturnType<typeof setTimeout> | undefined

export function rumKeystroke(ms: number): void {
  if (mode !== 'on') return
  ring[ringN++ % PCT_RING] = ms
  clearTimeout(ringTimer)
  ringTimer = setTimeout(flushKeystrokes, PCT_FLUSH_MS)
}

export function flushKeystrokes(): void {
  const n = Math.min(ringN, PCT_RING)
  if (!n) return
  const sorted = Array.from(ring.subarray(0, n)).sort((a, b) => a - b)
  ringN = 0
  const at = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))]
  const now = performance.now()
  const ctx = { samples: n }
  emit(['vital', 'palette.search.p50', now - at(0.5), at(0.5), ctx, undefined])
  emit([
    'vital',
    'palette.search.p95',
    now - at(0.95),
    at(0.95),
    ctx,
    undefined,
  ])
}

/** Hashes the author so the id is stable without being the raw name. */
export async function hashId(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(`bd-board:${value}`)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest).slice(0, 6), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
  } catch {
    // insecure context (plain http, non-localhost): no SubtleCrypto
    let h = 5381
    for (const ch of value) h = ((h << 5) + h + ch.charCodeAt(0)) | 0
    return (h >>> 0).toString(16)
  }
}

export function turnRumOff(): void {
  mode = 'off'
  queue = []
  sdk = null
}

export interface ActivateOptions {
  config: RumConfig
  sdk: RumSdk
  desktop: boolean
  version: string
}

/** The SDK init config for a profile; exported so tests can pin the privacy dials. */
export function sdkInitConfig({
  config,
  desktop,
  version,
}: Omit<ActivateOptions, 'sdk'>): Record<string, unknown> {
  const full = config.profile === 'full'
  return {
    applicationId: config.applicationId,
    clientToken: config.clientToken,
    site: config.site,
    organizationIdentifier: config.organizationIdentifier,
    apiVersion: 'v1',
    insecureHTTP: config.insecureHTTP,
    service: config.service ?? (desktop ? 'bd-board-desktop' : 'bd-board-web'),
    env: config.env,
    version,
    sessionSampleRate: config.sampleRate,
    sessionReplaySampleRate: full ? config.replaySampleRate : 0,
    defaultPrivacyLevel: full ? 'allow' : 'mask',
    enablePrivacyForActionName: !full,
    trackResources: true,
    trackLongTasks: true,
    trackUserInteractions: config.profile !== 'minimal',
    trackViewsManually: true,
    // Cookies are unreliable on tauri:// pages; see README.
    ...(desktop ? { sessionPersistence: 'local-storage' } : {}),
    beforeSend: (event: ScrubEvent) => scrubEvent(event, config.profile),
  }
}

/** Starts the SDK and replays what was queued. Sync, so tests can drive it with a fake. */
export function activateRum(opts: ActivateOptions): void {
  profile = opts.config.profile
  sdk = opts.sdk
  sdk.init(sdkInitConfig(opts))
  mode = 'on'
  if (profile === 'full' && opts.config.userName) {
    const name = opts.config.userName
    void hashId(name).then((id) => sdk?.setUser({ id, name }))
  }
  const pending = queue
  queue = []
  for (const op of pending) emit(op)
}

export interface StartOptions {
  desktop: boolean
  version: string
  loadConfig: () => Promise<
    | { state: 'off' }
    | { state: 'invalid'; reason: string }
    | { state: 'on'; config: RumConfig }
  >
  /** `full` loads the replay-capable SDK, anything else the slim one. */
  loadSdk: (profile: RumProfile) => Promise<RumSdk>
}

let started = false

export async function startRum(opts: StartOptions): Promise<void> {
  if (started) return
  started = true
  try {
    const result = await opts.loadConfig()
    if (result.state === 'invalid') {
      console.warn(`[bd-board] RUM disabled: ${result.reason}`)
    }
    if (result.state !== 'on') return turnRumOff()
    const sdkInstance = await opts.loadSdk(result.config.profile)
    activateRum({ ...opts, config: result.config, sdk: sdkInstance })
  } catch (err) {
    console.warn(
      `[bd-board] RUM disabled: ${err instanceof Error ? err.message : 'failed to start'}`,
    )
    turnRumOff()
  }
}

/** Test seam. */
export function resetRumForTests(): void {
  mode = 'pending'
  profile = 'full'
  sdk = null
  queue = []
  started = false
  marked.clear()
  ringN = 0
  clearTimeout(ringTimer)
}
