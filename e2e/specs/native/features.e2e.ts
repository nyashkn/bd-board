import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { resetApp } from '../../helpers.js'
import type { World } from '../../world.js'

const world = JSON.parse(process.env.E2E_WORLD ?? 'null') as World | null
const SHOTS =
  process.env.E2E_SHOTS ?? path.join(tmpdir(), 'bd-board-native-e2e-screenshots')
mkdirSync(SHOTS, { recursive: true })

// WebDriver key codes (webdriverio's Key is not importable from here).
const META = '\uE03D'
const CTRL = '\uE009'
const SEARCH = 'input[aria-label="Search beads"]'
const PALETTE_INPUT = 'input[aria-label="Search all beads"]'

let step = 0
async function shot(name: string) {
  step += 1
  await browser.saveScreenshot(
    path.join(SHOTS, `${String(step).padStart(2, '0')}-${name}.png`),
  )
}

async function go(target: string) {
  await resetApp('/')
  await browser.execute((t: string) => window.location.replace(t), target)
}

/** Cmd+K (macOS); falls back to Ctrl+K. The first press can land before hydration. */
async function openPalette() {
  const input = $(PALETTE_INPUT)
  for (let i = 0; i < 6 && !(await input.isDisplayed()); i++) {
    await browser.keys([i % 2 === 0 ? META : CTRL, 'k'])
    await input.waitForDisplayed({ timeout: 2000 }).catch(() => undefined)
  }
  await input.waitForDisplayed()
}

describe('new features in the real desktop window', () => {
  before(() => {
    if (!world) throw new Error('E2E_WORLD missing; run through wdio.conf.ts')
  })

  it('1. Cmd+K palette finds a description-only word; Enter opens the modal; Esc restores focus', async () => {
    const w = world!
    await go(`/p/${w.art.id}`)
    await $(SEARCH).waitForDisplayed({ timeout: 30000 })
    await $(SEARCH).click()
    await openPalette()
    await shot('palette-open')

    await $(PALETTE_INPUT).setValue('pangolin')
    const row = $('[cmdk-item]')
    await row.waitForDisplayed({ timeout: 15000 })
    await expect(row).toHaveText(expect.stringContaining('Plain looking bead'))
    await shot('palette-hit')

    await browser.keys('Enter')
    await browser.waitUntil(async () =>
      (await browser.getUrl()).includes(`bead=${w.ro.described}`),
    )
    await $('[role="dialog"]').waitForDisplayed({ timeout: 15000 })
    await expect($('[role="dialog"]')).toHaveText(
      expect.stringContaining('Plain looking bead'),
    )
    await shot('palette-enter-modal')

    // Esc on a fresh palette restores focus to the input that had it.
    await go(`/p/${w.art.id}`)
    await $(SEARCH).waitForDisplayed({ timeout: 30000 })
    await $(SEARCH).click()
    await openPalette()
    await browser.keys('Escape')
    await $(PALETTE_INPUT).waitForExist({ reverse: true })
    expect(
      await browser.execute(
        () => document.activeElement?.getAttribute('aria-label') ?? '',
      ),
    ).toBe('Search beads')
    await shot('palette-esc-focus')
  })

  it('2. a typed filter becomes a chip that Backspace removes', async () => {
    await openPalette()
    await $(PALETTE_INPUT).setValue('status:open ')
    const chip = $('button[aria-label="Remove filter status:open"]')
    await chip.waitForDisplayed({ timeout: 10000 })
    await shot('chip-created')
    await browser.keys('Backspace')
    await chip.waitForExist({ reverse: true })
    await shot('chip-removed')
    await browser.keys('Escape')
  })

  it('3. a bead is a real link; click opens the modal; Back does not reopen it', async () => {
    const w = world!
    await go(`/p/${w.art.id}?view=status`)
    const card = $(`[data-bead-id="${w.art.bead}"]`)
    await card.waitForDisplayed({ timeout: 30000 })
    expect(await card.getTagName()).toBe('a')
    expect(await card.getAttribute('href')).toContain('bead=')
    await shot('bead-link')

    await card.click()
    await $('[role="dialog"]').waitForDisplayed({ timeout: 15000 })
    expect(await browser.getUrl()).toContain('bead=')
    await shot('bead-modal')

    await browser.keys('Escape')
    await $('[role="dialog"]').waitForDisplayed({ reverse: true })
    await browser.back()
    await browser.pause(1000)
    expect(await $('[role="dialog"]').isExisting()).toBe(false)
    await shot('after-back')
  })

  it('4. switching Board to Hierarchy keeps the search', async () => {
    const w = world!
    await go(`/p/${w.rof.id}`)
    await $(SEARCH).waitForDisplayed({ timeout: 30000 })
    await $(SEARCH).setValue('Labelled')
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('q=Labelled'),
      {
        timeoutMsg: 'search never reached the URL',
      },
    )
    await $('[role="tab"][aria-label="Hierarchy"]').click()
    await browser.waitUntil(async () =>
      (await browser.getUrl()).includes('tab=hierarchy'),
    )
    expect(await browser.getUrl()).toContain('q=Labelled')
    expect(await $(SEARCH).getValue()).toBe('Labelled')
    await shot('hierarchy-keeps-search')
  })

  it('5. the modal header has a copy-id button', async () => {
    const w = world!
    await go(`/p/${w.art.id}?bead=${encodeURIComponent(w.art.bead)}`)
    await $('[role="dialog"]').waitForDisplayed({ timeout: 30000 })
    const copy = $('button[aria-label="Copy bead id"]')
    await expect(copy).toBeDisplayed()
    await copy.click()
    // Clipboard writes may be refused by the webview; the live region only fills on success.
    const copied = await browser
      .waitUntil(
        async () =>
          (await browser.execute(() => document.body.innerText)).includes(
            'Copied id',
          ),
        { timeout: 3000 },
      )
      .catch(() => false)
    console.log(`copy-id live region "Copied id" appeared: ${copied}`)
    await shot('copy-id')
  })

  it('6. a filter that hides everything explains the empty board', async () => {
    const w = world!
    await go(`/p/${w.art.id}?q=zzzznomatch`)
    const status = $('[role="status"]')
    await status.waitForDisplayed({ timeout: 30000 })
    await expect(status).toHaveText(
      expect.stringContaining('No beads match the filters'),
    )
    await shot('empty-reason')
  })

  it('7. dashboard and rail totals agree for the fixture', async () => {
    await resetApp('/')
    const read = () =>
      browser.execute(() => ({
        rail: [
          ...document.querySelectorAll('nav[aria-label="Projects"] li a'),
        ].map((a) => (a as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
        main:
          (
            document.querySelector('main')
          )?.innerText.replace(/\s+/g, ' ') ?? '',
      }))
    await browser.waitUntil(async () => (await read()).rail.length >= 3, {
      timeout: 20000,
      timeoutMsg: 'rail never listed the fixture projects',
    })
    const { rail, main } = await read()
    console.log('RAIL', JSON.stringify(rail))
    await shot('dashboard-counts')
    // Fixture: ro 3, rof 2 (label-filtered), art 1, all open.
    const expected = { ro: 3, rof: 2, art: 1 }
    for (const [name, n] of Object.entries(expected)) {
      expect(rail).toContain(`${name} ${n}`)
      expect(main).toMatch(new RegExp(`${name} .*?${n} Open`))
    }
    expect(main).toContain('6 beads in all')
    expect(main).toContain('6 open')
  })
})
