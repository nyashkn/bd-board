import { invoke } from '@tauri-apps/api/core'

import { configFromEnv, mergeConfig, parseRumConfig } from './rum-config.ts'

import type { RumConfigResult, RumProfile } from './rum-config.ts'
import type { RumSdk } from './rum.ts'

declare const __APP_VERSION__: string
export const APP_VERSION =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

/**
 * Where the config comes from: the desktop `rum_config` command, or the web server's
 * `/api/rum-config`, layered over `VITE_O2_RUM_*` build-time defaults. Nothing is hard-coded;
 * with neither, RUM stays off and nothing leaves the machine.
 */
export async function loadRumConfig(
  desktop: boolean,
): Promise<RumConfigResult> {
  const build = configFromEnv(
    import.meta.env as unknown as Record<string, string | undefined>,
    'VITE_O2_RUM_',
  )
  let runtime: unknown
  try {
    if (desktop) {
      runtime = await invoke<unknown>('rum_config')
    } else {
      const res = await fetch('/api/rum-config', { cache: 'no-store' })
      if (res.ok) runtime = await res.json()
    }
  } catch {
    // no runtime config reachable: build-time values alone decide
  }
  const over =
    runtime && typeof runtime === 'object' && !Array.isArray(runtime)
      ? (runtime as Record<string, unknown>)
      : {}
  return parseRumConfig(mergeConfig(build, over))
}

/** The full SDK (replay) only when the profile can use it; the slim one otherwise. */
export async function loadRumSdk(profile: RumProfile): Promise<RumSdk> {
  if (profile === 'full') {
    return (await import('@openobserve/browser-rum'))
      .openobserveRum as unknown as RumSdk
  }
  return (await import('@openobserve/browser-rum-slim'))
    .openobserveRum as unknown as RumSdk
}
