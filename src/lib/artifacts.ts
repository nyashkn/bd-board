import type { Bead } from './types.ts'

export interface Artifact {
  path: string
  label: string
  stage?: string
}

export type ArtifactKind = 'markdown' | 'html' | 'image' | 'text' | 'json'

export interface ArtifactFile {
  kind: ArtifactKind
  /** Text, or a data: URL for images. */
  content: string
  bytes: number
  /** Last modified, ms since epoch. */
  mtime: number
}

export interface ArtifactGroup {
  /** Child bead for an epic's aggregated rows; undefined for the bead itself. */
  child?: { id: string; title: string }
  artifacts: Artifact[]
}

/**
 * Reads bd metadata `artifacts` (a JSON array string, or an already-parsed
 * array). Anything malformed yields fewer or no artifacts, never a throw.
 */
export function parseArtifacts(metadata: unknown): Artifact[] {
  if (!metadata || typeof metadata !== 'object') return []
  let value = (metadata as Record<string, unknown>)['artifacts']
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  const out: Artifact[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const { path, label, stage } = item as Record<string, unknown>
    if (typeof path !== 'string' || !path.trim()) continue
    out.push({
      path: path.trim(),
      label: typeof label === 'string' && label.trim() ? label.trim() : path,
      stage:
        typeof stage === 'string' && stage.trim() ? stage.trim() : undefined,
    })
  }
  return out
}

/** The bead's own artifacts: spec_id first (label "Spec"), then metadata. */
export function beadArtifacts(
  bead: Pick<Bead, 'spec_id' | 'metadata'>,
): Artifact[] {
  const list = parseArtifacts(bead.metadata)
  const spec = bead.spec_id?.trim()
  return spec ? [{ path: spec, label: 'Spec' }, ...list] : list
}

export type ArtifactTarget =
  | { kind: 'local' }
  | { kind: 'remote'; href: string }
  | { kind: 'invalid' }

/**
 * Local paths are read from the project; only http(s) URLs are remote (never
 * fetched, only linked); any other scheme (javascript:, data:, file:) is invalid.
 */
export function classifyArtifactPath(path: string): ArtifactTarget {
  const text = path.trim()
  if (/^https?:\/\/\S+$/i.test(text)) {
    try {
      return { kind: 'remote', href: new URL(text).href }
    } catch {
      return { kind: 'invalid' }
    }
  }
  // 2+ chars so a Windows drive ("C:\x") stays a (refused) local path.
  if (/^[a-z][a-z0-9+.-]+:/i.test(text)) return { kind: 'invalid' }
  return { kind: 'local' }
}

export type ExternalRef =
  | { kind: 'link'; href: string }
  | { kind: 'text'; text: string }

/** external_ref is never a file: http(s) becomes a link, anything else text. */
export function parseExternalRef(ref: string | undefined): ExternalRef | null {
  const text = ref?.trim()
  if (!text) return null
  if (/^https?:\/\/\S+$/i.test(text)) {
    try {
      return { kind: 'link', href: new URL(text).href }
    } catch {
      // fall through to plain text
    }
  }
  return { kind: 'text', text }
}

/** Own artifacts, then (for any bead with children) one group per child. */
export function artifactGroups(bead: Bead): ArtifactGroup[] {
  const groups: ArtifactGroup[] = []
  const own = beadArtifacts(bead)
  if (own.length) groups.push({ artifacts: own })
  for (const child of bead.childBeads ?? []) {
    const artifacts = beadArtifacts(child)
    if (artifacts.length) {
      groups.push({ child: { id: child.id, title: child.title }, artifacts })
    }
  }
  return groups
}
