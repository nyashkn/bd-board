import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { BdAdapter } from './bd-contract.ts'
import type {
  Bead,
  BeadDetail,
  BeadLink,
  BeadUpdate,
  Comment,
  Project,
  ProjectComment,
  ProjectCounts,
  ProjectKnowledge,
  ProjectKnowledgeEntry,
  RelatedBead,
} from './types.ts'
import { summarizeBeads } from './counts.ts'
import { parseKnowledgeCommentText } from './knowledge.ts'
import { coalesced } from './coalesce.ts'
import { COMMENTS_LIMIT, KNOWLEDGE_LIMIT, deriveChildren } from './snapshot.ts'
import type { ProjectSnapshot, SnapshotBead } from './snapshot.ts'
import { loadRegistry } from './registry.ts'
import {
  applyProbeConcurrency,
  BdBufferError,
  BdTimeoutError,
  execFileGroup,
  isReadCall,
  queued,
  timeoutFromEnv,
} from './bd-queue.ts'
import type { Priority } from './bd-queue.ts'
import { parseDoltShow } from './connectors/select.ts'
import type { ProbeReply } from './connectors/select.ts'
import { bdNotFoundMessage, classifyBdVersion } from './bd-errors.ts'
import type { BdStatus } from './bd-errors.ts'
import {
  actorArgs,
  parseConfigActor,
  resolveCommentAuthor,
} from './comment-author.ts'
import type { CommentAuthor } from './comment-author.ts'

import type { RegistryEntry } from './registry.ts'

const execFileAsync = promisify(execFile)

const BD_FALLBACK = '/opt/homebrew/bin/bd'
const MAX_BUFFER = 64 * 1024 * 1024
export { COMMENTS_LIMIT, KNOWLEDGE_LIMIT }

function bdCandidates(): string[] {
  const candidates: string[] = []

  // (a) BD_BIN when set and non-empty
  const bdBin = process.env['BD_BIN']
  if (bdBin) {
    candidates.push(bdBin)
  }

  // (b) $HOME/.local/bin/bd — the wrapper
  const home = os.homedir()
  if (home) {
    candidates.push(path.join(home, '.local', 'bin', 'bd'))
  }

  // (c) "bd" from PATH
  candidates.push('bd')

  // (d) Fallback
  candidates.push(BD_FALLBACK)

  return candidates
}

function isExecutable(file: string): boolean {
  try {
    fsSync.accessSync(file, fsSync.constants.X_OK)
    return fsSync.statSync(file).isFile()
  } catch {
    return false
  }
}

/** Absolute path of the first usable bd candidate (the shim needs a path in REAL_BD). */
export function resolveRealBd(
  candidates: string[] = bdCandidates(),
  executable: (file: string) => boolean = isExecutable,
): string {
  for (const c of candidates) {
    if (c.includes('/')) {
      if (executable(c)) return c
      continue
    }
    for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
      if (dir && executable(path.join(dir, c))) return path.join(dir, c)
    }
  }
  throw new Error(bdNotFoundMessage(candidates, process.env['BD_BIN']))
}

function shimPath(): string {
  const fromEnv = process.env['BD_READONLY_SHIM']
  const here = fileURLToPath(
    new URL('../../scripts/readonly/bd-readonly', import.meta.url),
  )
  const options = [
    fromEnv,
    here,
    path.join(process.cwd(), 'scripts', 'readonly', 'bd-readonly'),
  ]
  return (
    options.find((f): f is string => Boolean(f) && isExecutable(f!)) ?? here
  )
}

export interface BdLaunch {
  candidates: string[]
  /** Extra environment for the child (read-only shim settings). */
  env?: Record<string, string>
}

/**
 * Which binary to spawn for a project. A readonly project runs the shim with
 * REAL_BD set to the normally resolved bd; filterLabel is only honoured together
 * with readonly. Everything else behaves exactly as before.
 */
export function planLaunch(
  entry: Pick<RegistryEntry, 'readonly' | 'filterLabel'> | undefined,
  deps: {
    candidates?: string[]
    shim?: () => string
    realBd?: () => string
  } = {},
): BdLaunch {
  const candidates = deps.candidates ?? bdCandidates()
  if (!entry?.readonly) return { candidates }
  return {
    candidates: [(deps.shim ?? shimPath)()],
    env: {
      REAL_BD: (deps.realBd ?? (() => resolveRealBd(candidates)))(),
      BD_FILTER_LABEL: entry.filterLabel ?? '',
    },
  }
}

async function launchFor(dir: string): Promise<BdLaunch> {
  // Same folder registered twice: a readonly entry wins, never the other way round.
  const same = (await loadRegistry()).filter((e) => e.path === dir)
  return planLaunch(same.find((e) => e.readonly) ?? same[0])
}

export function bdErrorMessage(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): string {
  const stdoutTrim = stdout.trim()
  const stderrTrim = stderr.trim()

  // Try to parse stdout as JSON and extract message or error
  if (stdoutTrim) {
    try {
      const json = JSON.parse(stdoutTrim) as Record<string, unknown>

      // Check for message field
      if (typeof json.message === 'string' && json.message) {
        let result = json.message
        if (typeof json.hint === 'string' && json.hint) {
          result += ` (${json.hint})`
        }
        return result
      }

      // Check for error field
      if (typeof json.error === 'string' && json.error) {
        let result = json.error
        if (typeof json.hint === 'string' && json.hint) {
          result += ` (${json.hint})`
        }
        return result
      }
    } catch {
      // Not JSON, continue to stderr
    }
  }

  // Fall back to stderr
  if (stderrTrim) {
    return `bd exited with status ${exitCode}: ${stderrTrim}`
  }

  // Last resort
  return `bd exited with status ${exitCode}`
}

type BdResult = {
  bin: string
  env: NodeJS.ProcessEnv
  code: number
  stdout: string
  stderr: string
}

/**
 * One bd process per project at a time (more on a Dolt server); identical in-flight reads
 * share a process. Interval polls pass 'background' so user calls go ahead of them.
 */
export function bdExec(
  dir: string,
  args: string[],
  timeout = timeoutFromEnv(process.env),
  priority: Priority = 'user',
): Promise<BdResult> {
  return queued(dir, args, () => spawnBd(dir, args, timeout), priority)
}

async function spawnBd(
  dir: string,
  args: string[],
  timeout: number,
): Promise<BdResult> {
  const { candidates, env: extra } = await launchFor(dir)
  const env = { ...process.env, ...extra }

  for (const candidate of candidates) {
    try {
      const { stdout, stderr } = await execFileGroup(candidate, args, {
        cwd: dir,
        env,
        maxBuffer: MAX_BUFFER,
        timeout,
      })
      return { bin: candidate, env, code: 0, stdout, stderr }
    } catch (err: unknown) {
      const error = err as {
        code?: string | number | null
        signal?: string | null
        stdout?: string
        stderr?: string
      }

      if (err instanceof BdTimeoutError) {
        throw new Error(
          `bd ${args[0] ?? ''} timed out after ${timeout / 1000}s and was stopped` +
            (isReadCall(args)
              ? ''
              : '; the command may have been applied, so check before retrying'),
        )
      }
      if (err instanceof BdBufferError) {
        throw new Error('bd output exceeded buffer')
      }
      if (error.signal) {
        const why = (error.stderr ?? '').trim()
        throw new Error(
          `bd ${args[0] ?? ''} killed by ${error.signal}` +
            (why ? `: ${why}` : '') +
            (isReadCall(args)
              ? ''
              : '; the command may have been applied, so check before retrying'),
        )
      }
      if (error.code === 'ENOENT') {
        continue
      }
      if (typeof error.code === 'number') {
        return {
          bin: candidate,
          env,
          code: error.code,
          stdout: error.stdout ?? '',
          stderr: error.stderr ?? '',
        }
      }
      throw new Error(
        bdErrorMessage(error.stdout ?? '', error.stderr ?? String(err), null),
      )
    }
  }

  // Exhausted all candidates
  throw new Error(bdNotFoundMessage(candidates, process.env['BD_BIN']))
}

async function bdRaw(
  dir: string,
  args: string[],
  priority: Priority = 'user',
): Promise<string> {
  const result = await bdExec(dir, args, undefined, priority)
  if (result.code !== 0) {
    throw new Error(bdErrorMessage(result.stdout, result.stderr, result.code))
  }
  return result.stdout
}

async function bdJson<T>(
  dir: string,
  args: string[],
  priority: Priority = 'user',
): Promise<T> {
  const raw = await bdRaw(dir, args, priority)
  const trimmed = raw.trim()
  if (!trimmed) return [] as unknown as T
  return JSON.parse(trimmed) as T
}

async function bdJsonLines<T>(dir: string, args: string[]): Promise<T[]> {
  const raw = await bdRaw(dir, args)
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

function buildCounts(
  rows: { status: string; c: string | number }[],
): ProjectCounts {
  const totals: ProjectCounts = {
    open: 0,
    in_progress: 0,
    blocked: 0,
    closed: 0,
    deferred: 0,
    total: 0,
  }
  for (const row of rows) {
    const n = Number(row.c)
    totals.total += n
    switch (row.status) {
      case 'open':
        totals.open += n
        break
      case 'in_progress':
      case 'hooked':
        totals.in_progress += n
        break
      case 'blocked':
        totals.blocked += n
        break
      case 'closed':
        totals.closed += n
        break
      case 'deferred':
        totals.deferred += n
        break
    }
  }
  return totals
}

export function buildCountsFromGroups(
  groups: { group: string; count: number }[],
): ProjectCounts {
  return buildCounts(groups.map((g) => ({ status: g.group, c: g.count })))
}

async function counts(
  dir: string,
  priority: Priority = 'user',
): Promise<ProjectCounts> {
  try {
    return summarizeBeads(await listBeadsIn(dir, priority))
  } catch {
    return {
      open: 0,
      in_progress: 0,
      blocked: 0,
      closed: 0,
      deferred: 0,
      total: 0,
    }
  }
}

function projectPolicy(
  entry: RegistryEntry,
): Pick<Project, 'readonly' | 'filterLabel'> {
  if (!entry.readonly) return {}
  return {
    readonly: true,
    ...(entry.filterLabel ? { filterLabel: entry.filterLabel } : {}),
  }
}

async function discoverProjects(): Promise<Project[]> {
  const entries = await loadRegistry()
  const results: Project[] = []

  for (const entry of entries) {
    const policy = projectPolicy(entry)
    // Check if folder exists
    if (!fsSync.existsSync(entry.path)) {
      results.push({
        id: entry.id,
        ...policy,
        name: entry.label,
        dir: entry.path,
        beadsPath: '',
        prefix: null,
        external: false,
        missing: true,
        error: 'folder no longer exists',
        counts: {
          open: 0,
          in_progress: 0,
          blocked: 0,
          closed: 0,
          deferred: 0,
          total: 0,
        },
      })
      continue
    }

    // Probe beads location
    try {
      const probeResult = await bdJson<{
        path?: string
        database_path?: string
        prefix?: string
      }>(entry.path, ['where', '--json'], 'background')

      if (!probeResult.path) {
        results.push({
          id: entry.id,
          ...policy,
          name: entry.label,
          dir: entry.path,
          beadsPath: '',
          prefix: null,
          external: false,
          missing: false,
          error: 'bd where returned no beads path',
          counts: {
            open: 0,
            in_progress: 0,
            blocked: 0,
            closed: 0,
            deferred: 0,
            total: 0,
          },
        })
        continue
      }

      const expectedBeads = path.join(entry.path, '.beads')
      const external = probeResult.path !== expectedBeads

      const projectCounts = await counts(entry.path, 'background')
      results.push({
        id: entry.id,
        ...policy,
        name: entry.label,
        dir: entry.path,
        beadsPath: probeResult.path,
        prefix: probeResult.prefix || null,
        external,
        missing: false,
        error: null,
        counts: projectCounts,
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      results.push({
        id: entry.id,
        ...policy,
        name: entry.label,
        dir: entry.path,
        beadsPath: '',
        prefix: null,
        external: false,
        missing: false,
        error,
        counts: {
          open: 0,
          in_progress: 0,
          blocked: 0,
          closed: 0,
          deferred: 0,
          total: 0,
        },
      })
    }
  }

  return results.sort((a, b) => {
    const diff = b.counts.total - a.counts.total
    return diff !== 0 ? diff : a.name.localeCompare(b.name)
  })
}

async function resolveDir(projectId: string): Promise<string> {
  const entries = await loadRegistry()
  const entry = entries.find((e) => e.id === projectId)
  if (!entry) {
    throw new Error(`unknown project id: ${projectId}`)
  }
  return entry.path
}

/** Defence in depth: every write goes through here, so a readonly project refuses before any process runs. */
export async function resolveWritableDir(projectId: string): Promise<string> {
  const entries = await loadRegistry()
  const entry = entries.find((e) => e.id === projectId)
  if (!entry) throw new Error(`unknown project id: ${projectId}`)
  if (entry.readonly) {
    throw new Error(`project "${entry.label}" is read-only; writes are refused`)
  }
  return entry.path
}

interface DependencyEdge {
  from: string
  to: string
  type: string
}

/**
 * Edges only exist in the `bd list`/`bd export` shape, where each entry carries
 * `depends_on_id`. `bd show` reuses the same field name for expanded beads, so
 * entries without `depends_on_id` are skipped.
 */
function parseDependencyEdges(raw: Record<string, unknown>): DependencyEdge[] {
  const list = Array.isArray(raw['dependencies'])
    ? (raw['dependencies'] as Record<string, unknown>[])
    : []
  const ownerId = typeof raw['id'] === 'string' ? raw['id'] : ''

  return list.flatMap((entry) => {
    const to = entry['depends_on_id']
    if (typeof to !== 'string' || !to) return []
    const from =
      typeof entry['issue_id'] === 'string' ? entry['issue_id'] : ownerId
    if (!from) return []
    return [{ from, to, type: String(entry['type'] ?? 'blocks') }]
  })
}

function collectEdges(
  rawBeads: Record<string, unknown>[],
  knownIds: Set<string>,
): DependencyEdge[] {
  const seen = new Set<string>()
  const edges: DependencyEdge[] = []

  for (const raw of rawBeads) {
    for (const edge of parseDependencyEdges(raw)) {
      if (!knownIds.has(edge.from) || !knownIds.has(edge.to)) continue
      const key = `${edge.from}|${edge.to}|${edge.type}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push(edge)
    }
  }

  return edges
}

function pushLink(
  target: Map<string, BeadLink[]>,
  id: string,
  link: BeadLink,
): void {
  const list = target.get(id) ?? []
  list.push(link)
  target.set(id, list)
}

type IdRow = Record<string, unknown>

/**
 * Stamps `waiting_on` ([] when bd answered and the bead waits on nothing; open blockers, from `bd blocked --json`) and `ready` (from
 * `bd ready --json`) onto beads. A list bd could not give (undefined) stamps nothing, so
 * consumers fall back to status-only rules instead of showing a false zero.
 */
export function applyReadiness(
  beads: Bead[],
  blocked?: IdRow[],
  ready?: IdRow[],
): Bead[] {
  if (!blocked && !ready) return beads
  const waiting = new Map<string, string[]>()
  for (const row of blocked ?? []) {
    const by = Array.isArray(row['blocked_by'])
      ? (row['blocked_by'] as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        )
      : []
    if (typeof row['id'] === 'string' && by.length > 0)
      waiting.set(row['id'], by)
  }
  const readyIds = new Set(ready?.map((r) => r['id']))
  return beads.map((b) => ({
    ...b,
    ...(blocked ? { waiting_on: waiting.get(b.id) ?? [] } : {}),
    ...(ready ? { ready: readyIds.has(b.id) } : {}),
  }))
}

/**
 * Dashboard counts agree with `bd blocked`: a waiting bead moves out of the bucket of its
 * status into Blocked (beads whose status is already blocked are not counted twice).
 */
export function applyBlockedToCounts(
  base: ProjectCounts,
  blocked: IdRow[],
): ProjectCounts {
  const next = { ...base }
  for (const row of blocked) {
    const status = String(row['status'])
    if (status === 'blocked' || status === 'closed') continue
    const key =
      status === 'in_progress' || status === 'hooked'
        ? 'in_progress'
        : status === 'deferred'
          ? 'deferred'
          : 'open'
    // Deferred beads are tallied under `deferred` only; open ones under `open`.
    if (next[key] > 0) next[key] -= 1
    next.blocked += 1
  }
  return next
}

export function buildBeadGraph(
  rawBeads: Record<string, unknown>[],
  readiness: { blocked?: IdRow[]; ready?: IdRow[] } = {},
): Bead[] {
  const beads = rawBeads.map(mapRawBead)
  const knownIds = new Set(beads.map((b) => b.id))
  const edges = collectEdges(rawBeads, knownIds)

  const linksById = new Map<string, BeadLink[]>()
  const parentById = new Map<string, string>()

  for (const edge of edges) {
    pushLink(linksById, edge.from, {
      id: edge.to,
      type: edge.type,
      direction: 'outgoing',
    })
    pushLink(linksById, edge.to, {
      id: edge.from,
      type: edge.type,
      direction: 'incoming',
    })
    if (edge.type === 'parent-child') parentById.set(edge.from, edge.to)
  }

  const withLinks = beads.map((bead) => {
    const links = linksById.get(bead.id)
    const parent = bead.parent ?? parentById.get(bead.id)
    return {
      ...bead,
      ...(parent ? { parent } : {}),
      ...(links ? { links } : {}),
    }
  })

  return deriveChildren(
    applyReadiness(withLinks, readiness.blocked, readiness.ready),
  )
}

// bd metadata is a flat object; keep string values only (artifacts is JSON text).
function stringMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const entries = Object.entries(value).filter(
    (e): e is [string, string] => typeof e[1] === 'string',
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

function mapRawBead(raw: Record<string, unknown>): Bead {
  return {
    id: raw['id'] as string,
    title: raw['title'] as string,
    description: raw['description'] as string | undefined,
    acceptance_criteria: raw['acceptance_criteria'] as string | undefined,
    design: raw['design'] as string | undefined,
    notes: raw['notes'] as string | undefined,
    status: raw['status'] as string,
    priority: Number(raw['priority'] ?? 2),
    issue_type: raw['issue_type'] as string,
    assignee: raw['assignee'] as string | undefined,
    owner: raw['owner'] as string | undefined,
    created_at: raw['created_at'] as string | undefined,
    updated_at: raw['updated_at'] as string | undefined,
    closed_at: raw['closed_at'] as string | undefined,
    labels: Array.isArray(raw['labels']) ? (raw['labels'] as string[]) : [],
    parent: raw['parent'] as string | undefined,
    spec_id: (raw['spec_id'] as string | undefined) || undefined,
    external_ref: (raw['external_ref'] as string | undefined) || undefined,
    metadata: stringMetadata(raw['metadata']),
    comment_count:
      raw['comment_count'] !== undefined
        ? Number(raw['comment_count'])
        : undefined,
    dependency_count:
      raw['dependency_count'] !== undefined
        ? Number(raw['dependency_count'])
        : undefined,
    dependent_count:
      raw['dependent_count'] !== undefined
        ? Number(raw['dependent_count'])
        : undefined,
  }
}

function mapComment(raw: Record<string, unknown>): Comment {
  return {
    id: String(raw['id'] ?? ''),
    author: (raw['author'] ?? raw['created_by']) as string | undefined,
    text: String(raw['text'] ?? raw['body'] ?? ''),
    created_at: raw['created_at'] as string | undefined,
  }
}

function mapProjectComment(raw: Record<string, unknown>): ProjectComment {
  const text = String(raw['text'] ?? '')
  const parsed = parseKnowledgeCommentText(text)
  return {
    id: String(raw['id'] ?? ''),
    bead_id: String(raw['bead_id'] ?? raw['issue_id'] ?? ''),
    bead_title: String(raw['bead_title'] ?? raw['title'] ?? '') || undefined,
    author: (raw['author'] ?? raw['created_by']) as string | undefined,
    text,
    created_at: raw['created_at'] as string | undefined,
    knowledge_type: parsed?.type,
  }
}

function mapKnowledgeEntry(
  raw: Record<string, unknown>,
): ProjectKnowledgeEntry | null {
  const comment = mapProjectComment(raw)
  const parsed = parseKnowledgeCommentText(comment.text)
  if (!parsed) return null
  return {
    ...comment,
    type: parsed.type,
    content: parsed.content,
    knowledge_type: parsed.type,
  }
}

async function listBeads(projectId: string): Promise<Bead[]> {
  return listBeadsIn(await resolveDir(projectId))
}

async function listBeadsIn(
  dir: string,
  priority: Priority = 'user',
): Promise<Bead[]> {
  // blocked/ready are bd's own answer to "what waits" and "what can start"; a failure
  // (old bd) leaves them undefined and the UI falls back to status only.
  const optional = (args: string[]) =>
    bdJson<Record<string, unknown>[]>(dir, args, priority).catch(
      () => undefined,
    )
  const [raw, blocked, ready] = await Promise.all([
    bdJson<Record<string, unknown>[]>(
      dir,
      ['list', '--all', '--json'],
      priority,
    ),
    optional(['blocked', '--json']),
    optional(['ready', '--json', '-n', '0']),
  ])
  return buildBeadGraph(raw, { blocked, ready })
}

/** Pure: `bd show <id> --json` (first element) plus `bd comments <id> --json` to the detail. */
export function buildBeadDetail(
  raw: Record<string, unknown>,
  rawComments: Record<string, unknown>[],
): BeadDetail {
  const rawDeps = Array.isArray(raw['dependencies'])
    ? (raw['dependencies'] as Record<string, unknown>[])
    : []

  const dependencies: RelatedBead[] = rawDeps.map((d) => ({
    id: String(d['id'] ?? ''),
    title: String(d['title'] ?? ''),
    status: String(d['status'] ?? 'open'),
    issue_type: String(d['issue_type'] ?? 'task'),
    dependency_type: String(d['dependency_type'] ?? ''),
  }))

  return {
    ...mapRawBead(raw),
    dependencies,
    comments: rawComments.map(mapComment),
  }
}

async function getBeadDetail(
  projectId: string,
  id: string,
): Promise<BeadDetail> {
  const dir = await resolveDir(projectId)

  // show first: its comment_count says whether `bd comments` is worth a process. The
  // per-project queue runs one bd at a time anyway, so overlapping them gains nothing.
  const rawArr = await bdJson<Record<string, unknown>[]>(dir, [
    'show',
    id,
    '--json',
  ])
  const raw = rawArr[0] ?? {}
  const rawComments =
    mapRawBead(raw).comment_count === 0
      ? []
      : await bdJson<Record<string, unknown>[]>(dir, [
          'comments',
          id,
          '--json',
        ]).catch(() => [] as Record<string, unknown>[])
  return buildBeadDetail(raw, rawComments)
}

function parseJsonRows(raw: string | undefined): IdRow[] | null {
  try {
    const text = raw?.trim()
    if (text === undefined) return null
    return text ? (JSON.parse(text) as IdRow[]) : []
  } catch {
    return null
  }
}

/** Pure: the three bd outputs (raw text) to a snapshot. `ready`/`blocked` undefined = bd failed. */
export function buildSnapshot(
  exported: string,
  ready: string | undefined,
  blocked: string | undefined,
): ProjectSnapshot {
  const rows = exported
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  const beads: SnapshotBead[] = rows.map((raw) => ({
    ...mapRawBead(raw),
    comments: (Array.isArray(raw['comments'])
      ? (raw['comments'] as Record<string, unknown>[])
      : []
    ).map(mapComment),
    edges: parseDependencyEdges(raw),
  }))
  const readyRows = parseJsonRows(ready)
  const blockedRows = parseJsonRows(blocked)
  return {
    beads,
    ready: readyRows && readyRows.map((r) => String(r['id'])),
    blocked:
      blockedRows &&
      blockedRows.map((r) => ({
        id: String(r['id']),
        blocked_by: Array.isArray(r['blocked_by'])
          ? (r['blocked_by'] as unknown[]).filter(
              (x): x is string => typeof x === 'string',
            )
          : [],
      })),
    cursor: createHash('sha1')
      .update(`${exported}\0${ready ?? ''}\0${blocked ?? ''}`)
      .digest('hex')
      .slice(0, 16),
  }
}

/**
 * Everything the UI reads, from three bd calls run one after another (parallel is slower on the
 * embedded lock). Concurrent callers for a project share one run, see coalesce.ts.
 */
async function getSnapshot(projectId: string): Promise<ProjectSnapshot> {
  const dir = await resolveDir(projectId)
  return coalesced(dir, async () => {
    const exported = await bdRaw(dir, ['export'])
    // ready/blocked are optional: an old bd leaves them undefined and the UI falls back to status.
    const ready = await bdRaw(dir, ['ready', '--json', '-n', '0']).catch(
      () => undefined,
    )
    const blocked = await bdRaw(dir, ['blocked', '--json']).catch(
      () => undefined,
    )
    return buildSnapshot(exported, ready, blocked)
  })
}

async function getBeadComments(
  projectId: string,
  id: string,
): Promise<Comment[]> {
  const rows = await bdJson<Record<string, unknown>[]>(
    await resolveDir(projectId),
    ['comments', id, '--json'],
  )
  return rows.map(mapComment)
}

export function buildProjectKnowledge(
  issues: Record<string, unknown>[],
): ProjectKnowledge {
  const rawComments = issues.flatMap((issue) => {
    const issueComments = Array.isArray(issue['comments'])
      ? (issue['comments'] as Record<string, unknown>[])
      : []
    return issueComments.map((c) => ({ ...c, title: issue['title'] }))
  })

  const byDateDesc = (a: { created_at?: string }, b: { created_at?: string }) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? '')

  const comments = rawComments
    .map(mapProjectComment)
    .sort(byDateDesc)
    .slice(0, COMMENTS_LIMIT)

  const knowledge = rawComments
    .map(mapKnowledgeEntry)
    .filter((entry): entry is ProjectKnowledgeEntry => entry !== null)
    .sort(byDateDesc)
    .slice(0, KNOWLEDGE_LIMIT)

  return { comments, knowledge }
}

async function getProjectKnowledge(
  projectId: string,
): Promise<ProjectKnowledge> {
  const dir = await resolveDir(projectId)
  try {
    const issues = await bdJsonLines<Record<string, unknown>>(dir, ['export'])
    return buildProjectKnowledge(issues)
  } catch {
    return { comments: [], knowledge: [] }
  }
}

async function updateBeadStatus(
  projectId: string,
  id: string,
  status: string,
): Promise<void> {
  const dir = await resolveWritableDir(projectId)
  await bdRaw(dir, ['update', id, '--status', status])
}

function buildUpdateBeadArgs(
  id: string,
  opts: BeadUpdate,
  existingLabels: string[] = [],
): string[] {
  const args = ['update', id]

  if (opts.title !== undefined) args.push('--title', opts.title)
  if (opts.description !== undefined)
    args.push('--description', opts.description)
  if (opts.acceptance_criteria !== undefined)
    args.push('--acceptance', opts.acceptance_criteria)
  if (opts.design !== undefined) args.push('--design', opts.design)
  if (opts.notes !== undefined) args.push('--notes', opts.notes)
  if (opts.priority !== undefined)
    args.push('--priority', String(opts.priority))
  if (opts.issue_type !== undefined) args.push('--type', opts.issue_type)
  if (opts.assignee !== undefined) args.push('--assignee', opts.assignee)

  if (opts.labels !== undefined) {
    if (opts.labels.length > 0) {
      args.push('--set-labels', opts.labels.join(','))
    } else {
      for (const label of existingLabels) {
        args.push('--remove-label', label)
      }
    }
  }

  return args
}

async function updateBead(
  projectId: string,
  id: string,
  opts: BeadUpdate,
): Promise<void> {
  const dir = await resolveWritableDir(projectId)
  const existing =
    opts.labels !== undefined ? await getBeadDetail(projectId, id) : undefined
  const args = buildUpdateBeadArgs(id, opts, existing?.labels ?? [])
  if (args.length <= 2) return
  await bdRaw(dir, args)
}

async function previewDeleteBead(
  projectId: string,
  id: string,
): Promise<string> {
  const dir = await resolveWritableDir(projectId)
  const out = await bdRaw(dir, buildPreviewDeleteBeadArgs(id))
  return out.trim()
}

async function deleteBead(projectId: string, id: string): Promise<void> {
  const dir = await resolveWritableDir(projectId)
  try {
    await bdRaw(dir, buildDeleteBeadArgs(id))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Unable to delete bead. ${message}`)
  }
}

function buildPreviewDeleteBeadArgs(id: string): string[] {
  return ['delete', id, '--cascade']
}

function buildDeleteBeadArgs(id: string): string[] {
  return ['delete', id, '--cascade', '--force']
}

async function createBead(
  projectId: string,
  opts: { title: string; description?: string; type?: string; parent?: string },
): Promise<string> {
  const dir = await resolveWritableDir(projectId)
  const args = ['create', '--title', opts.title, '--silent']
  if (opts.description) args.push('-d', opts.description)
  if (opts.type) args.push('--type', opts.type)
  if (opts.parent) args.push('--parent', opts.parent)
  const out = await bdRaw(dir, args)
  return out.trim()
}

async function addComment(
  projectId: string,
  id: string,
  text: string,
): Promise<void> {
  const dir = await resolveWritableDir(projectId)
  await bdRaw(dir, [...actorArgs(process.env), 'comment', id, text])
}

/** The author `bd comment` will record for this project (bd's own resolution order, see comment-author.ts). */
async function getCommentAuthor(projectId: string): Promise<CommentAuthor> {
  const dir = await resolveDir(projectId)
  const quiet = async (bin: string, args: string[]) => {
    try {
      return (await execFileAsync(bin, args, { cwd: dir })).stdout
    } catch {
      return ''
    }
  }
  const configActor = process.env['BD_BOARD_AUTHOR']
    ? ''
    : parseConfigActor(
        await bdRaw(dir, ['config', 'get', 'actor']).catch(() => ''),
      )
  const gitName = (await quiet('git', ['config', 'user.name'])).trim()
  return resolveCommentAuthor({ env: process.env, configActor, gitName })
}

/** Is bd runnable, and new enough? Cheap (`bd --version`); not tied to a project. */
async function getBdStatus(): Promise<BdStatus> {
  const candidates = bdCandidates()
  for (const c of candidates) {
    try {
      const { stdout } = await execFileAsync(c, ['--version'])
      return classifyBdVersion(stdout, process.env['BD_BIN'])
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') continue
      return {
        state: 'missing',
        message: `bd failed to run (${c}): ${(err as Error).message}`,
      }
    }
  }
  return {
    state: 'missing',
    message: bdNotFoundMessage(candidates, process.env['BD_BIN']),
  }
}

async function enableEventsJournal(projectId: string): Promise<void> {
  const dir = await resolveWritableDir(projectId)
  await bdRaw(dir, ['config', 'set', 'events-journal', 'true'])
}

const PROBE_TIMEOUT_MS = 2000

/**
 * Which Dolt mode is this project in (`bd dolt show --json`), plus its registry `sources`.
 * Never throws: a failure or a 2 s timeout (queued like any bd call, and the process is killed)
 * comes back as `{ error, sources }`. With explicit `sources` it does not run bd.
 */
export async function probeDoltMode(projectId: string): Promise<ProbeReply> {
  let sources: string[] = []
  try {
    const entry = (await loadRegistry()).find((e) => e.id === projectId)
    if (!entry) return { error: `unknown project id: ${projectId}` }
    sources = entry.sources ?? []
    // Explicit sources decide the order; no bd call is needed (or wanted) to resolve them.
    if (sources.length)
      return { error: 'not probed: explicit sources', sources }
    const r = await bdExec(
      entry.path,
      ['dolt', 'show', '--json'],
      PROBE_TIMEOUT_MS,
      'background',
    )
    if (r.code !== 0) {
      return { error: bdErrorMessage(r.stdout, r.stderr, r.code), sources }
    }
    const probe = parseDoltShow(r.stdout)
    if (!('error' in probe)) applyProbeConcurrency(entry.path, probe)
    return { ...probe, sources }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), sources }
  }
}

export const bdAdapter: BdAdapter = {
  discoverProjects,
  listBeads,
  getBeadDetail,
  getProjectKnowledge,
  getSnapshot,
  getBeadComments,
  updateBeadStatus,
  updateBead,
  previewDeleteBead,
  deleteBead,
  createBead,
  addComment,
  enableEventsJournal,
  getCommentAuthor,
  getBdStatus,
}

export {
  discoverProjects,
  listBeads,
  getBeadDetail,
  getProjectKnowledge,
  getSnapshot,
  getBeadComments,
  updateBeadStatus,
  updateBead,
  buildUpdateBeadArgs,
  previewDeleteBead,
  deleteBead,
  buildPreviewDeleteBeadArgs,
  buildDeleteBeadArgs,
  createBead,
  addComment,
  enableEventsJournal,
  getCommentAuthor,
  getBdStatus,
  resolveDir,
  counts,
}
