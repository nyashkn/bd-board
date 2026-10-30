import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { configFromEnv, mergeConfig, parseRumConfig } from './rum-config.ts'

import type { RumConfigResult } from './rum-config.ts'

export function rumConfigPath(): string {
  return path.join(os.homedir(), '.config', 'bd-board', 'rum.json')
}

/**
 * Server-side RUM config for the web build: ~/.config/bd-board/rum.json, overridden per key by
 * `O2_RUM_*` env vars. Read on every request, so it can change without a rebuild. A missing or
 * unreadable file is just "no file".
 */
export function readServerRumConfig(
  env: Record<string, string | undefined> = process.env,
  file: string = rumConfigPath(),
): Record<string, unknown> {
  let fromFile: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      fromFile = parsed as Record<string, unknown>
  } catch {
    // absent or malformed: RUM stays off unless the env enables it
  }
  const merged = mergeConfig(fromFile, configFromEnv(env, 'O2_RUM_'))
  if (!merged.userName && env.BD_BOARD_AUTHOR?.trim())
    merged.userName = env.BD_BOARD_AUTHOR.trim()
  return merged
}

/** What the browser is told: only a valid, enabled config, else `{ enabled: false }`. */
export function rumConfigResponse(
  raw: Record<string, unknown> = readServerRumConfig(),
): Record<string, unknown> {
  const result: RumConfigResult = parseRumConfig(raw)
  return result.state === 'on'
    ? { enabled: true, ...result.config }
    : { enabled: false }
}
