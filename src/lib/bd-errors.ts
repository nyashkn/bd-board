import {
  MIN_BD_VERSION_LIVE_UPDATES,
  isBdOlderThan,
  parseBdVersion,
} from './bd-version.ts'

export const BD_INSTALL_COMMAND = 'brew install beads'

/** What to do about a missing bd; the same sentence is built in Rust (desktop.rs), keep them in step. */
export function bdFixHint(bdBin?: string): string {
  return `Install bd ${MIN_BD_VERSION_LIVE_UPDATES} or newer (${BD_INSTALL_COMMAND}), or set BD_BIN to the full path of the binary (.env.local for the web app, the environment for the desktop app; now: ${bdBin?.trim() || 'unset'}).`
}

export function bdNotFoundMessage(tried: string[], bdBin?: string): string {
  return `bd not found (tried: ${tried.join(', ')}). ${bdFixHint(bdBin)}`
}

export function bdTooOldMessage(raw: string, bdBin?: string): string {
  const v = parseBdVersion(raw)?.join('.') ?? raw.trim()
  return `bd ${v} is too old: bd board needs ${MIN_BD_VERSION_LIVE_UPDATES} or newer. Upgrade it (brew upgrade beads), or set BD_BIN to a newer binary (now: ${bdBin?.trim() || 'unset'}).`
}

export type BdStatus =
  | { state: 'ok'; version: string }
  | { state: 'too_old'; version: string; message: string }
  | { state: 'missing'; message: string }

/** Classifies the output of `bd --version`; an unparseable version is not called old. */
export function classifyBdVersion(raw: string, bdBin?: string): BdStatus {
  const parsed = parseBdVersion(raw)
  if (isBdOlderThan(raw, MIN_BD_VERSION_LIVE_UPDATES))
    return {
      state: 'too_old',
      version: parsed!.join('.'),
      message: bdTooOldMessage(raw, bdBin),
    }
  return { state: 'ok', version: parsed?.join('.') ?? raw.trim() }
}
