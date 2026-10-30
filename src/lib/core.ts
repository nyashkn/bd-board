import { probeDoltModeFn } from './server.ts'

import { bdCli } from './connectors/bd-cli.ts'
import { isConnectionError, resolveCandidates } from './connectors/select.ts'
import { rumAction } from './rum.ts'
import { toErrorMessage } from './utils.ts'

import type {
  Candidate,
  ConnectorKind,
  ProbeReply,
} from './connectors/select.ts'
import type { Connector } from './connectors/types.ts'

// App-layer entry: the UI imports from here. The connectors live in ./connectors.
export { bdCli }
export type { Connector }

type ConnectorFactory = (url: string) => Connector

// Only bd-cli exists; dolt-sql and http-snapshot register here when they land. Until then the
// router recognises those kinds and skips them.
const factories = new Map<ConnectorKind, ConnectorFactory>()
const registerBuiltins = () => factories.set('bd-cli', () => bdCli)
registerBuiltins()

export function registerConnectorKind(
  kind: ConnectorKind,
  factory: ConnectorFactory,
): void {
  factories.set(kind, factory)
}

/**
 * One router per project, implementing Connector. It resolves the ordered candidates once per
 * session (one probe), uses the first with a registered factory, and on a connection-class error
 * marks that candidate unhealthy, retries the call on the next, and stays there.
 */
const REPROBE_MS = 30_000

function createRouter(project: string): Connector {
  let resolved: Promise<Candidate[]> | undefined
  const unhealthy = new Set<string>()
  const built = new Map<string, Connector>()
  let active: ConnectorKind = 'bd-cli'

  // A probe error is not kept for the whole session: one re-probe is allowed after REPROBE_MS.
  let reprobeAt = Infinity

  const candidates = () => {
    if (Date.now() >= reprobeAt) resolved = undefined
    return (resolved ??= (async () => {
      let reply: ProbeReply
      try {
        reply = await probeDoltModeFn({ data: { project } })
      } catch (err) {
        reply = { error: toErrorMessage(err, 'probe failed') }
      }
      const explicit = (reply.sources ?? []).length > 0
      reprobeAt =
        'error' in reply && !explicit ? Date.now() + REPROBE_MS : Infinity
      return resolveCandidates(reply.sources ?? [], reply)
    })())
  }

  const connectorOf = (c: Candidate) => {
    let conn = built.get(c.url)
    if (!conn) built.set(c.url, (conn = factories.get(c.kind)!(c.url)))
    return conn
  }

  // `retry: false` is for writes: after a connection error the write may already have committed, so
  // the candidate is marked for later calls but this call is never repeated on the next one.
  async function run<T>(
    call: (c: Connector) => Promise<T>,
    { retry = true } = {},
  ): Promise<T> {
    const all = await candidates()
    const usable = all.filter(
      (c) => factories.has(c.kind) && !unhealthy.has(c.url),
    )
    if (usable.length === 0) {
      const kinds = [...new Set(all.map((c) => c.kind))].join(', ')
      throw new Error(`no connector is available for this project (${kinds})`)
    }
    let first: unknown
    for (const [i, cand] of usable.entries()) {
      try {
        const out = await call(connectorOf(cand))
        active = cand.kind
        return out
      } catch (err) {
        if (!isConnectionError(err)) throw err
        // The last candidate is never marked: nothing is left to switch to, so surface the error.
        if (i === usable.length - 1) throw first ?? err
        const next = usable[i + 1]
        if (!unhealthy.has(cand.url)) {
          unhealthy.add(cand.url)
          rumAction('connector.fallback', { from: cand.kind, to: next.kind })
        }
        if (!retry) throw err
        first ??= err
      }
    }
    throw first
  }

  return {
    get id() {
      return active
    },
    listBeads: (a) => run((c) => c.listBeads(a)),
    beadDetail: (a) => run((c) => c.beadDetail(a)),
    projectKnowledge: (a) => run((c) => c.projectKnowledge(a)),
    readArtifact: (a) => run((c) => c.readArtifact(a)),
    commentAuthor: (a) => run((c) => c.commentAuthor(a)),
    addComment: (a) => run((c) => c.addComment(a), { retry: false }),
    updateStatus: (a) => run((c) => c.updateStatus(a), { retry: false }),
    updateBead: (a) => run((c) => c.updateBead(a), { retry: false }),
    createBead: (a) => run((c) => c.createBead(a), { retry: false }),
    previewDelete: (a) => run((c) => c.previewDelete(a)),
    deleteBead: (a) => run((c) => c.deleteBead(a), { retry: false }),
    enableEventsJournal: (a) => run((c) => c.enableEventsJournal(a)),
    // The feed reports problems as messages, not throws, so it picks a connector but does not fail over.
    subscribeFeed: (proj, since, onMessage) => {
      let closed = false
      let stop: (() => void) | undefined
      run(async (c) => {
        if (!closed) stop = c.subscribeFeed(proj, since, onMessage)
      }).catch((err) =>
        onMessage({
          type: 'error',
          message: toErrorMessage(err, 'No connector'),
        }),
      )
      return () => {
        closed = true
        stop?.()
      }
    },
  }
}

const routers = new Map<string, Connector>()

export function connectorFor(project: string): Connector {
  let router = routers.get(project)
  if (!router) routers.set(project, (router = createRouter(project)))
  return router
}

export function resetConnectorsForTests(): void {
  routers.clear()
  factories.clear()
  registerBuiltins()
}
