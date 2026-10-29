import { openApp, world } from './helpers.js'

/** WebDriver's Control key code (webdriverio's `Key.Ctrl`; the package is not importable from here). */
const CTRL = '\uE009'
const SEARCH = 'input[aria-label="Search beads"]'
const PALETTE_INPUT = 'input[aria-label="Search all beads"]'

/** Presses Ctrl+K until the palette shows: the first press can land before the page hydrates. */
async function openPalette() {
  const input = $(PALETTE_INPUT)
  for (let i = 0; i < 6 && !(await input.isDisplayed()); i++) {
    await browser.keys([CTRL, 'k'])
    await input.waitForDisplayed({ timeout: 2000 }).catch(() => undefined)
  }
  await input.waitForDisplayed()
}

describe('command palette (real server, real bd)', () => {
  before(async () => {
    await openApp(`/p/${world().art.id}`)
    await $(SEARCH).waitForDisplayed({ timeout: 30000 })
  })

  it('opens over another input, finds a description-only word, and Enter opens the bead', async () => {
    const w = world()
    await $(SEARCH).click()
    await openPalette()
    const input = $(PALETTE_INPUT)
    await expect($('[role="dialog"]')).toBeDisplayed()

    await input.setValue('pangolin')
    // Another project, read-only, description-only hit.
    const row = $('[cmdk-item]')
    await row.waitForDisplayed({ timeout: 15000 })
    await expect(row).toHaveText(expect.stringContaining(w.ro.described))
    await expect(row).toHaveText(expect.stringContaining('Plain looking bead'))
    await expect(row.$('mark')).toHaveText('pangolin')

    await browser.keys('Enter')
    await browser.waitUntil(async () =>
      (await browser.getUrl()).includes(`/p/${w.ro.id}`),
    )
    expect(await browser.getUrl()).toContain(`bead=${w.ro.described}`)
    await expect($('[role="dialog"]')).toHaveText(
      expect.stringContaining('Plain looking bead'),
    )
  })

  it('Esc closes and restores focus to the input that had it', async () => {
    await openApp(`/p/${world().art.id}`)
    await $(SEARCH).click()
    await openPalette()
    await browser.keys('Escape')
    await $(PALETTE_INPUT).waitForExist({ reverse: true })
    expect(
      await browser.execute(
        () => document.activeElement?.getAttribute('aria-label') ?? '',
      ),
    ).toBe('Search beads')
  })

  it('turns a typed filter into a chip that Backspace removes', async () => {
    await openPalette()
    const input = $(PALETTE_INPUT)
    await input.setValue('type:epic ')
    const chip = $('button[aria-label="Remove filter type:epic"]')
    await chip.waitForDisplayed()
    await browser.keys('Backspace')
    await chip.waitForExist({ reverse: true })
  })
})
