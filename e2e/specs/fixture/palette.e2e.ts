import { openApp, world } from './helpers.js'

/** WebDriver's Control key code (webdriverio's `Key.Ctrl`; the package is not importable from here). */
const CTRL = '\uE009'
const SEARCH = 'input[aria-label="Search beads"]'
const SCOPE = '[data-testid="palette-scope"]'
const SHIFT = '\uE008'
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

    // Opens scoped to the current project (art): the read-only project's bead is out of scope.
    await expect($(SCOPE)).toHaveText(expect.stringContaining('art'))
    await input.setValue('pangolin')
    await $('p=No beads match.').waitForDisplayed({ timeout: 15000 })
    // Ctrl+Shift+. widens to every project, and the polite live region says so.
    await browser.keys([CTRL, SHIFT, '.'])
    await expect($(SCOPE)).toHaveText('All projects')
    await expect($('[role="dialog"] [role="status"]')).toHaveText(
      expect.stringContaining('Searching All projects'),
    )
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

  it('the pill opens a project list: arrows/click pick, Esc closes only the list, project: chip overrides', async () => {
    const w = world()
    await openApp(`/p/${w.art.id}`)
    await $(SEARCH).click()
    await openPalette()
    // Remembered from the previous test: All projects.
    await expect($(SCOPE)).toHaveText('All projects')
    await $(SCOPE).click()
    const list = $('[role="listbox"][aria-label="Search scope"]')
    await list.waitForDisplayed()
    await browser.keys('Escape')
    await list.waitForExist({ reverse: true })
    await expect($(PALETTE_INPUT)).toBeDisplayed() // the palette stayed open
    // Pick the read-only project from the list.
    await $(SCOPE).click()
    await list.$(`li=${w.ro.id}`).click()
    await expect($(SCOPE)).toHaveText(w.ro.id)
    const input = $(PALETTE_INPUT)
    await input.setValue('pangolin')
    await $('[cmdk-item]').waitForDisplayed({ timeout: 15000 })
    // A project: chip for another project overrides the pill.
    await input.setValue(`pangolin project:${w.art.id} `)
    await $('p=No beads match.').waitForDisplayed({ timeout: 15000 })
    await input.setValue('')
    await browser.keys('Backspace') // drop the chip
  })

  it('Ctrl+Shift+L opens the list, Ctrl+Shift+. cycles without opening it', async () => {
    const w = world()
    await browser.keys([CTRL, SHIFT, 'l'])
    await $('[role="listbox"][aria-label="Search scope"]').waitForDisplayed()
    await browser.keys('Escape')
    await expect($(SCOPE)).toHaveText(w.ro.id)
    await browser.keys([CTRL, SHIFT, '.'])
    await expect($(SCOPE)).not.toHaveText(w.ro.id)
    await expect($('[role="listbox"][aria-label="Search scope"]')).not.toExist()
    // End on All projects for the rest of the session.
    for (let i = 0; i < 4 && (await $(SCOPE).getText()) !== 'All projects'; i++)
      await browser.keys([CTRL, SHIFT, '.'])
    await expect($(SCOPE)).toHaveText('All projects')
  })

  it('"Open project" rows navigate, and Ctrl+Enter on a pill item opens that project too', async () => {
    const w = world()
    const chip = $(`button[aria-label="Remove filter project:${w.art.id}"]`)
    if (await chip.isExisting()) await chip.click()
    await $(PALETTE_INPUT).setValue('x')
    await browser.keys('Backspace')
    const row = $(`[cmdk-item]*=Open project ${w.ro.id}`)
    await row.waitForDisplayed()
    await row.click()
    await browser.waitUntil(async () =>
      (await browser.getUrl()).includes(`/p/${w.ro.id}`),
    )
    await $(PALETTE_INPUT).waitForExist({ reverse: true })
    await openPalette()
    await $(SCOPE).click()
    await $('[role="listbox"][aria-label="Search scope"]').waitForDisplayed()
    // Highlight the art project (list order: All projects, then each project) and Ctrl+Enter.
    await $(`[role="option"]=${w.art.id}`).moveTo()
    await browser.keys([CTRL, 'Enter'])
    await browser.waitUntil(async () =>
      (await browser.getUrl()).includes(`/p/${w.art.id}`),
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
