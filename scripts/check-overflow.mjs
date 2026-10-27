#!/usr/bin/env node
// Horizontal-overflow regression guard. jsdom cannot lay out, so this drives a
// real Chrome over the DevTools protocol (no dependency: Node's fetch + WebSocket).
//
//   node scripts/check-overflow.mjs                       # dev server on :3009
//   BASE_URL=http://localhost:3031 PROJECT=my-id node scripts/check-overflow.mjs
//   ONLY=bead-modal,hierarchy  limits pages; SHOTS=/some/dir  saves a PNG per page/width; CHROME=/path/to/chrome overrides discovery.
//
// Point it at a read-only registry (see scripts/readonly) so nothing can be written.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:3009'
const WIDTHS = (process.env.WIDTHS ?? '720,1000,1280,1440')
  .split(',')
  .map(Number)
const SHOTS = process.env.SHOTS
const CHROME = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p))
if (!CHROME) throw new Error('Chrome not found; set CHROME=/path/to/chrome')

const PORT = 9300 + Math.floor(Math.random() * 500)
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bdb-overflow-'))}`,
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const tab = tabs.find((t) => t.type === 'page')
      if (tab) return tab.webSocketDebuggerUrl
    } catch {
      /* chrome still starting */
    }
    await sleep(200)
  }
  throw new Error('Chrome DevTools endpoint never came up')
}

const ws = new WebSocket(await connect())
await new Promise((r) => (ws.onopen = r))
let seq = 0
const pending = new Map()
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  pending.get(msg.id)?.(msg)
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (msg) =>
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result),
    )
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) =>
  (
    await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
  ).result.value

async function waitFor(expression, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await evaluate(`!!(${expression})`)) return true
    await sleep(150)
  }
  return false
}

async function setWidth(width) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await sleep(250)
}

// Elements whose right edge sticks out of the viewport (the first few, for diagnosis).
const MEASURE = `(() => {
  const d = document.documentElement
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width && r.right > d.clientWidth + 1) {
      let p = el, clipped = false
      while ((p = p.parentElement)) {
        const o = getComputedStyle(p).overflowX
        if (o !== 'visible' && p !== document.body && p !== d) { clipped = true; break }
      }
      if (!clipped) out.push((el.tagName + '.' + String(el.className).split(' ').slice(0, 3).join('.')).slice(0, 80))
    }
  }
  return { sw: d.scrollWidth, cw: d.clientWidth, culprits: out.slice(0, 4) }
})()`

if (SHOTS) mkdirSync(SHOTS, { recursive: true })
await send('Page.enable')

// Project id: PROJECT env or the first registered project.
await send('Page.navigate', { url: `${BASE}/` })
await waitFor(`document.querySelector('a[href^="/p/"]')`)
const project =
  process.env.PROJECT ??
  (await evaluate(
    `document.querySelector('a[href^="/p/"]')?.getAttribute('href')?.split('/')[2]`,
  ))
if (!project) throw new Error('no project found; set PROJECT=<id>')

// A bead to open: BEAD env or the first one on the board.
const P = `/p/${project}`
const pages = [
  {
    name: 'projects',
    path: '/',
    ready: `document.querySelector('main a[href^="/p/"]')`,
  },
  {
    name: 'board-status',
    path: `${P}?view=status&closed=all`,
    ready: `document.querySelector('main h3, main [role=button]')`,
  },
  {
    name: 'board-epic',
    path: `${P}?view=epic&closed=all`,
    ready: `document.querySelector('main h3, main [role=button]')`,
  },
  {
    name: 'hierarchy',
    path: `${P}?tab=hierarchy`,
    ready: `document.querySelector('main')`,
  },
  {
    name: 'knowledge',
    path: `${P}?tab=knowledge`,
    ready: `document.querySelector('main')`,
  },
]
let bead = process.env.BEAD
if (!bead) {
  await send('Page.navigate', { url: `${BASE}${P}?view=status&closed=all` })
  await waitFor(
    `/\\b[a-z]{2,6}-(?=[a-z0-9.]*\\d)[a-z0-9.]+/.test(document.body.innerText)`,
    30000,
  )
  bead = await evaluate(
    `(document.body.innerText.match(/\\b[a-z]{2,6}-(?=[a-z0-9.]*\\d)[a-z0-9.]+/) ?? [])[0] ?? ''`,
  )
}
if (bead)
  pages.push({
    name: 'bead-modal',
    path: `${P}?view=status&closed=all&bead=${bead}`,
    ready: `(d => d && !d.querySelector('.animate-spin') && d.innerText.length > 80)(document.querySelector('[role=dialog]'))`,
  })

const rows = []
for (const theme of ['light', 'dark']) {
  for (const pg of pages) {
    if (theme === 'dark' && pg.name !== 'projects') continue
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(pg.name))
      continue
    for (const width of WIDTHS) {
      await setWidth(width)
      await evaluate(`localStorage.setItem('bd-board:theme', '${theme}')`)
      await send('Page.navigate', { url: `${BASE}${pg.path}` })
      await waitFor(pg.ready, 45000)
      await sleep(1200)
      const m = await evaluate(MEASURE)
      rows.push({
        page: pg.name + (theme === 'dark' ? ' (dark)' : ''),
        width,
        ...m,
      })
      if (SHOTS) {
        const { data } = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(
          join(SHOTS, `${pg.name}-${theme}-${width}.png`),
          Buffer.from(data, 'base64'),
        )
      }
    }
  }
}

ws.close()
chrome.kill()
let bad = 0
for (const r of rows) {
  const ok = r.sw <= r.cw
  if (!ok) bad++
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${r.page.padEnd(20)} ${String(r.width).padStart(5)}px  scrollWidth=${r.sw} clientWidth=${r.cw}${ok ? '' : '  ' + r.culprits.join(' | ')}`,
  )
}
if (!bead)
  console.log('note: no bead id found, modal not checked (set BEAD=<id>)')
process.exit(bad ? 1 : 0)
