import { readFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { kindOfSource } from './connectors/select.ts'

export interface RegistryEntry {
  id: string
  path: string
  label: string
  /** Optional. true: bd runs through the read-only shim and the UI blocks writes. */
  readonly?: boolean
  /** Optional, only honoured together with `readonly`: see scripts/readonly. */
  filterLabel?: string
  /** Optional, ordered: connector URLs (`bd:`, `mysql://`, `https://`) tried first to last. */
  sources?: string[]
}

export class RegistryError extends Error {}

/** Validates the optional fields; a wrong type must fail loudly, never silently drop read-only. */
export function parseRegistryEntry(raw: unknown, index: number): RegistryEntry {
  const e = raw as Record<string, unknown> | null
  const where = `registry project #${index + 1}`
  if (!e || typeof e !== 'object')
    throw new RegistryError(`${where} is not an object`)
  for (const key of ['id', 'path', 'label'] as const) {
    if (typeof e[key] !== 'string') {
      throw new RegistryError(`${where}: "${key}" must be a string`)
    }
  }
  if (e['readonly'] !== undefined && typeof e['readonly'] !== 'boolean') {
    throw new RegistryError(`${where}: "readonly" must be a boolean`)
  }
  const label = e['filterLabel']
  if (label !== undefined && (typeof label !== 'string' || !label.trim())) {
    throw new RegistryError(
      `${where}: "filterLabel" must be a non-empty string`,
    )
  }
  const sources = e['sources']
  if (
    sources !== undefined &&
    (!Array.isArray(sources) ||
      !sources.every((s) => typeof s === 'string' && kindOfSource(s)))
  ) {
    throw new RegistryError(
      `${where}: "sources" must be an array of bd:, mysql:// or https:// URLs`,
    )
  }
  return {
    id: e['id'] as string,
    path: e['path'] as string,
    label: e['label'] as string,
    ...(e['readonly'] !== undefined ? { readonly: e['readonly'] } : {}),
    ...(label !== undefined ? { filterLabel: label.trim() } : {}),
    ...(sources !== undefined ? { sources: sources as string[] } : {}),
  }
}

export interface Registry {
  version: number
  projects: RegistryEntry[]
}

export function registryPath(): string {
  const home = os.homedir()
  return path.join(home, '.config', 'bd-board', 'projects.json')
}

export async function loadRegistry(): Promise<RegistryEntry[]> {
  const regPath = registryPath()

  try {
    let content: string
    try {
      content = await readFile(regPath, 'utf8')
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        return []
      }
      throw error
    }
    const registry = JSON.parse(content) as Registry

    if (registry.version !== 1) {
      throw new Error(
        `unsupported registry version ${registry.version}; expected 1`,
      )
    }

    return registry.projects.map(parseRegistryEntry)
  } catch (error) {
    if (
      error instanceof RegistryError ||
      (error instanceof Error &&
        error.message.includes('unsupported registry version'))
    ) {
      throw error
    }
    // Treat parse errors or file read errors as empty registry
    return []
  }
}
