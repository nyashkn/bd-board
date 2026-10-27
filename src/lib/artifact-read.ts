import { realpath, stat, readFile } from 'node:fs/promises'
import * as path from 'node:path'

import type { ArtifactFile, ArtifactKind } from './artifacts.ts'

export const ARTIFACT_MAX_BYTES = 2 * 1024 * 1024

const KINDS: Partial<Record<string, { kind: ArtifactKind; mime?: string }>> = {
  '.md': { kind: 'markdown' },
  '.html': { kind: 'html' },
  '.htm': { kind: 'html' },
  '.txt': { kind: 'text' },
  '.json': { kind: 'json' },
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.svg': { kind: 'image', mime: 'image/svg+xml' },
}

function kindOf(file: string) {
  return KINDS[path.extname(file).toLowerCase()]
}

/**
 * Reads one artifact from inside `root`. Refuses absolute paths, `..`,
 * symlinks resolving outside the root, other extensions and files over 2 MB.
 */
export async function readArtifactFile(
  root: string,
  relPath: string,
): Promise<ArtifactFile> {
  if (!relPath || relPath.includes('\0')) throw new Error('Invalid path')
  if (path.isAbsolute(relPath) || path.win32.isAbsolute(relPath)) {
    throw new Error('Path must be relative to the project')
  }
  const type = kindOf(relPath)
  if (!type) throw new Error('File type not allowed')

  const realRoot = await realpath(root)
  let real: string
  try {
    real = await realpath(path.resolve(realRoot, relPath))
  } catch {
    throw new Error('File not found')
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new Error('Path escapes the project')
  }
  // A symlink inside the root may point at another extension.
  const realType = kindOf(real)
  if (!realType) throw new Error('File type not allowed')

  const info = await stat(real)
  if (!info.isFile()) throw new Error('Not a file')
  if (info.size > ARTIFACT_MAX_BYTES)
    throw new Error('File is larger than 2 MB')

  const data = await readFile(real)
  const content = realType.mime
    ? `data:${realType.mime};base64,${data.toString('base64')}`
    : data.toString('utf8')
  return {
    kind: realType.kind,
    content,
    bytes: info.size,
    mtime: Math.round(info.mtimeMs),
  }
}
