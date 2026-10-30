/** The connector kinds a project can be read through. */
export type ConnectorKind = 'bd-cli' | 'dolt-sql' | 'http-snapshot'

export interface Candidate {
  kind: ConnectorKind
  url: string
}

/** What `bd dolt show --json` says about a project, or why it could not be asked. */
export type DoltProbe =
  | {
      embedded: boolean
      host?: string
      port?: number
      database?: string
      connectionOk?: boolean
      schemaVersion?: number
    }
  | { error: string }

/** The probe plus the project's registry `sources`, which the client has no other cheap way to read. */
export type ProbeReply = DoltProbe & { sources?: string[] }

/** The registry's accepted `sources` schemes and the connector each one names. */
const SCHEMES: [prefix: string, kind: ConnectorKind][] = [
  ['bd:', 'bd-cli'],
  ['mysql://', 'dolt-sql'],
  ['https://', 'http-snapshot'],
]

export function kindOfSource(url: string): ConnectorKind | undefined {
  return SCHEMES.find(([prefix]) => url.startsWith(prefix))?.[1]
}

/** Parses `bd dolt show --json` defensively: anything unexpected is an error, never a guess. */
export function parseDoltShow(stdout: string): DoltProbe {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return { error: 'bd dolt show did not print JSON' }
  }
  const o = raw as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || typeof o['embedded'] !== 'boolean') {
    return { error: 'bd dolt show printed an unexpected shape' }
  }
  const str = (k: string) => (typeof o[k] === 'string' ? o[k] : undefined)
  const num = (k: string) => (typeof o[k] === 'number' ? o[k] : undefined)
  const ok = o['connection_ok']
  return {
    embedded: o['embedded'],
    ...(str('host') !== undefined ? { host: str('host') } : {}),
    ...(num('port') !== undefined ? { port: num('port') } : {}),
    ...(str('database') !== undefined ? { database: str('database') } : {}),
    ...(typeof ok === 'boolean' ? { connectionOk: ok } : {}),
    ...(num('schema_version') !== undefined
      ? { schemaVersion: num('schema_version') }
      : {}),
  }
}

/**
 * The connectors to try, best first. Explicit `sources` win in their order; otherwise the owner's
 * preference order applies: local embedded bd, then a reachable Dolt sql-server, then bd. Pure: it
 * never starts, stops or migrates a server.
 */
export function resolveCandidates(
  sources: string[],
  probe: DoltProbe,
): Candidate[] {
  if (sources.length > 0) {
    return sources.flatMap((url) => {
      const kind = kindOfSource(url)
      return kind ? [{ kind, url }] : []
    })
  }
  const bd: Candidate = { kind: 'bd-cli', url: 'bd:' }
  if (
    !('error' in probe) &&
    probe.embedded === false &&
    probe.connectionOk === true &&
    probe.host &&
    probe.port !== undefined &&
    probe.database
  ) {
    const url = `mysql://${probe.host}:${probe.port}/${encodeURIComponent(probe.database)}`
    return [{ kind: 'dolt-sql', url }, bd]
  }
  return [bd]
}

const CONNECTION_CODES =
  /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EPIPE)\b/
const CONNECTION_TEXT =
  /connection (refused|reset|lost|closed|timed out)|can't connect|cannot connect|failed to fetch|network error|socket hang up|server has gone away|broken pipe/i

/**
 * Connection class (the source is unreachable, so another may work) versus domain class (the source
 * answered: "not found", a validation error). Tauri rejects with plain strings, so read both.
 */
export function isConnectionError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string' && CONNECTION_CODES.test(code)) return true
  const msg = err instanceof Error ? err.message : String(err)
  return CONNECTION_CODES.test(msg) || CONNECTION_TEXT.test(msg)
}
