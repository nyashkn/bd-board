import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { openApp, world } from '../fixture/helpers.js'

const CTRL = '\uE009'
const SHIFT = '\uE008'
const PALETTE_INPUT = 'input[aria-label="Search all beads"]'
const SEARCH = 'input[aria-label="Search beads"]'

interface Hit {
  method: string
  url: string
  origin: string
  body: string
}

const port = () => process.env.E2E_RUM_PORT ?? ''
const logPath = () => process.env.E2E_RUM_LOG ?? ''
const configFile = () =>
  path.join(world().home, '.config', 'bd-board', 'rum.json')

function hits(): Hit[] {
  return readFileSync(logPath(), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Hit)
}

function writeConfig(extra: Record<string, unknown> | null) {
  if (extra === null) {
    rmSync(configFile(), { force: true })
    return
  }
  mkdirSync(path.dirname(configFile()), { recursive: true })
  writeFileSync(
    configFile(),
    JSON.stringify({
      enabled: true,
      site: `127.0.0.1:${port()}`,
      insecureHTTP: true,
      organizationIdentifier: 'kn',
      clientToken: 'e2e-not-a-real-token',
      env: 'e2e',
      sampleRate: 100,
      replaySampleRate: 0,
      ...extra,
    }),
  )
}

/** The SDK flushes when the page is hidden; fake that instead of waiting out its 30 s timer. */
async function flush() {
  await browser.execute(() => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

async function waitForHits(pred: (all: Hit[]) => boolean) {
  await browser.waitUntil(
    async () => {
      await flush()
      return pred(hits())
    },
    { timeout: 20000, interval: 1000, timeoutMsg: 'ingest never got the data' },
  )
}

async function usePalette() {
  const input = $(PALETTE_INPUT)
  for (let i = 0; i < 6 && !(await input.isDisplayed()); i++) {
    await browser.keys([CTRL, 'k'])
    await input.waitForDisplayed({ timeout: 2000 }).catch(() => undefined)
  }
  await input.setValue('pangolin')
  await browser.keys([CTRL, SHIFT, '.'])
  await $('[cmdk-item]')
    .waitForExist({ timeout: 15000 })
    .catch(() => undefined)
  // the keystroke percentile flushes 1.5 s after typing stops
  await browser.pause(2200)
  await browser.keys('Escape')
}

describe('RUM against a fake intake', () => {
  beforeEach(async () => {
    // let the previous page's last flush land before the log is cleared
    await browser.url('about:blank')
    await browser.pause(1500)
    writeFileSync(logPath(), '')
  })
  afterEach(() => writeConfig(null))

  it('is off by default: nothing is sent and no request leaves for the intake', async () => {
    writeConfig(null)
    await openApp(`/p/${world().art.id}`)
    await $(SEARCH).waitForDisplayed({ timeout: 30000 })
    await usePalette()
    await flush()
    await browser.pause(2000)
    expect(hits()).toHaveLength(0)
    const origins = await browser.execute(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => new URL(e.name).origin),
    )
    expect(origins.filter((o) => o.includes(port()))).toEqual([])
  })

  it('a config that is enabled but invalid stays off', async () => {
    writeConfig({ site: 'https://not-a-host/with/path' })
    await openApp(`/p/${world().art.id}`)
    await flush()
    await browser.pause(1500)
    expect(hits()).toHaveLength(0)
  })

  it('full: sends views, resources, actions and the palette timings, only to the intake', async () => {
    const w = world()
    writeConfig({ profile: 'full', userName: 'e2e-author' })
    await openApp(`/p/${w.art.id}?bead=${w.art.bead}&q=needle`)
    await $(SEARCH).waitForDisplayed({ timeout: 30000 })
    await usePalette()
    await waitForHits((all) => {
      const text = all.map((h) => h.body).join('\n')
      return (
        text.includes('"type":"view"') &&
        text.includes('"type":"resource"') &&
        text.includes('palette.open') &&
        text.includes('palette.search.p50') &&
        text.includes('bd.call.list') &&
        text.includes('palette.scope')
      )
    })
    const all = hits()
    const text = all.map((h) => h.body).join('\n')
    expect(text).toContain('bead=')
    expect(text).toContain('q=needle')
    expect(text).toContain('e2e-author')
    expect(text).toContain('"type":"action"')
    // every request went to the fake intake, with the token and org in the URL
    for (const h of all) expect(h.url).toContain('/rum/v1/kn')
    const origins = await browser.execute(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => new URL(e.name).origin),
    )
    const allowed = new Set([
      new URL(await browser.getUrl()).origin,
      `http://127.0.0.1:${port()}`,
    ])
    expect(origins.filter((o) => !allowed.has(o))).toEqual([])
  })

  it('standard: no query strings, no user, own timings still sent', async () => {
    const w = world()
    writeConfig({ profile: 'standard', userName: 'e2e-author' })
    await openApp(`/p/${w.art.id}?bead=${w.art.bead}&q=needle`)
    await $(SEARCH).waitForDisplayed({ timeout: 30000 })
    await usePalette()
    await waitForHits((all) =>
      all.some((h) => h.body.includes('palette.search.p50')),
    )
    const text = hits()
      .map((h) => h.body)
      .join('\n')
    expect(text).not.toContain('bead=')
    expect(text).not.toContain('q=needle')
    expect(text).not.toContain('e2e-author')
    expect(text).toContain('"type":"view"')
  })
})
