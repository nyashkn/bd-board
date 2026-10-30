import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * A throwaway world for the fixture-backed suites: a temp root holding a fake
 * HOME (with its own project registry) and real `bd init` projects. Nothing here
 * reads or writes the real registry or any real project.
 */
export interface World {
  root: string
  home: string
  /** Sentinel text of the file the escaping artifact path points at. */
  outsideSecret: string
  art: {
    id: string
    dir: string
    bead: string
    /** Bead whose description holds a `:::bead` directive pointing at `target`. */
    refBead: string
    target: string
    targetTitle: string
  }
  ro: { id: string; dir: string; bead: string; described: string }
  rof: { id: string; dir: string; wo: string; child: string; other: string }
  /** Created but NOT in the registry: a spec registers it itself, so project and bead counts elsewhere hold. */
  ask: { id: string; dir: string; bead: string }
}

export const OUTSIDE_SECRET = 'OUTSIDE-SECRET-DO-NOT-RENDER'

// 1x1 transparent PNG.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='

const PAGE_HTML = `<!doctype html><title>page</title>
<h1 id="h">sandbox-pending</h1>
<script>
  var out = []
  try { out.push('parent:' + parent.document.title) } catch (e) { out.push('parent-blocked') }
  try { top.document.title = 'HACKED'; out.push('top-write') } catch (e) { out.push('top-blocked') }
  try { out.push('storage:' + window.localStorage.length) } catch (e) { out.push('storage-blocked') }
  document.title = 'CHILD'
  document.getElementById('h').textContent = out.join('|')
</script>`

function cleanEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home }
  for (const key of Object.keys(env)) {
    if (key.startsWith('BEADS_') || key === 'BD_BIN') delete env[key]
  }
  return env
}

export function bd(dir: string, home: string, args: string[]): string {
  return execFileSync('bd', args, {
    cwd: dir,
    env: cleanEnv(home),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function initProject(root: string, home: string, name: string): string {
  const dir = path.join(root, name)
  mkdirSync(dir, { recursive: true })
  bd(dir, home, ['init', '-p', name, '--non-interactive'])
  return dir
}

export function createWorld(): World {
  const root = mkdtempSync(path.join(tmpdir(), 'bdb-e2e-'))
  const home = path.join(root, 'home')
  mkdirSync(path.join(home, '.config', 'bd-board'), { recursive: true })
  writeFileSync(path.join(root, 'outside.md'), OUTSIDE_SECRET)

  const art = initProject(root, home, 'art')
  mkdirSync(path.join(art, 'docs'))
  writeFileSync(
    path.join(art, 'docs', 'spec.md'),
    '# Spec heading\n\nspec body',
  )
  writeFileSync(
    path.join(art, 'docs', 'notes.md'),
    '# Notes heading\n\nSome **bold** words',
  )
  writeFileSync(path.join(art, 'docs', 'page.html'), PAGE_HTML)
  writeFileSync(
    path.join(art, 'docs', 'pic.png'),
    Buffer.from(PNG_1X1, 'base64'),
  )
  const artifacts = [
    { path: 'docs/notes.md', label: 'Notes md' },
    { path: 'docs/page.html', label: 'Page html' },
    { path: 'docs/pic.png', label: 'Pic png' },
    { path: 'docs/missing.md', label: 'Missing md' },
    { path: '../outside.md', label: 'Escaping md' },
    { path: 'https://example.com/remote-doc', label: 'Remote doc' },
  ]
  const artBead = bd(art, home, [
    'create',
    '--title',
    'Artifacts demo',
    '--silent',
    '--spec-id',
    'docs/spec.md',
    '--external-ref',
    'https://example.com/ticket/42',
    '--metadata',
    // bd metadata is flat: `artifacts` is JSON text (the TS adapter drops non-string values)
    JSON.stringify({ artifacts: JSON.stringify(artifacts) }),
  ])

  const targetTitle = 'Referenced target bead'
  const target = bd(art, home, [
    'create',
    '--title',
    targetTitle,
    '--description',
    'Target description line.',
    '--silent',
  ])
  const refBead = bd(art, home, [
    'create',
    '--title',
    'Bead with a reference',
    '--description',
    `See also:\n\n:::bead ${target} demo-missing`,
    '--silent',
  ])

  const ro = initProject(root, home, 'ro')
  const roBead = bd(ro, home, [
    'create',
    '--title',
    'Read-only bead',
    '--silent',
  ])
  bd(ro, home, ['create', '--title', 'Second read-only bead', '--silent'])
  // The word lives only in the description: the command palette must still find it.
  const described = bd(ro, home, [
    'create',
    '--title',
    'Plain looking bead',
    '--description',
    'Remember the pangolin migration before release.',
    '--silent',
  ])

  const rof = initProject(root, home, 'rof')
  const wo = bd(rof, home, [
    'create',
    '--title',
    'Labelled bead',
    '--type',
    'epic',
    '--label',
    'wo',
    '--silent',
  ])
  const child = bd(rof, home, [
    'create',
    '--title',
    'Labelled child',
    '--parent',
    wo,
    '--silent',
  ])
  const other = bd(rof, home, [
    'create',
    '--title',
    'Unlabelled bead',
    '--type',
    'epic',
    '--label',
    'infra',
    '--silent',
  ])

  const ask = initProject(root, home, 'ask')
  const askBead = bd(ask, home, [
    'create',
    '--title',
    'Question demo',
    '--silent',
  ])

  writeFileSync(
    path.join(home, '.config', 'bd-board', 'projects.json'),
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'art', path: art, label: 'art' },
        { id: 'ro', path: ro, label: 'ro', readonly: true },
        {
          id: 'rof',
          path: rof,
          label: 'rof',
          readonly: true,
          filterLabel: 'wo',
        },
      ],
    }),
  )

  return {
    root,
    home,
    outsideSecret: OUTSIDE_SECRET,
    art: { id: 'art', dir: art, bead: artBead, refBead, target, targetTitle },
    ro: { id: 'ro', dir: ro, bead: roBead, described },
    rof: { id: 'rof', dir: rof, wo, child, other },
    ask: { id: 'ask', dir: ask, bead: askBead },
  }
}

export function destroyWorld(world: World): void {
  rmSync(world.root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 300,
  })
}

/** Count and a hash of every issue plus its comments, read straight from bd (no shim). */
export function ledger(
  world: World,
  dir: string,
): { count: number; hash: string } {
  const list = bd(dir, world.home, ['list', '--all', '--json', '-n', '0'])
  const issues = JSON.parse(list) as { id: string }[]
  const hash = createHash('sha256').update(list)
  for (const { id } of issues) {
    hash.update(bd(dir, world.home, ['comments', id, '--json']))
  }
  return { count: issues.length, hash: hash.digest('hex') }
}
