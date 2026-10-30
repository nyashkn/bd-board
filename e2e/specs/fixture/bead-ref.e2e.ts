import { openApp, world } from './helpers.js'

const w = world()

const chip = () =>
  $(`[role="dialog"] a[href*="bead=${encodeURIComponent(w.art.target)}"]`)

describe(':::bead references in a description', () => {
  before(async () => {
    await openApp(`/p/${w.art.id}?bead=${encodeURIComponent(w.art.refBead)}`)
    await chip().waitForDisplayed({ timeout: 30000 })
  })

  it('renders a chip with the id and the target title; unknown ids stay plain links', async () => {
    expect(await chip().getText()).toContain(w.art.targetTitle)
    await expect($('[role="dialog"] a[href*="bead=demo-missing"]')).toExist()
  })

  it('hover shows a preview card with the target title', async () => {
    await chip().moveTo()
    const card = $('[data-testid="bead-ref-card"]')
    await card.waitForDisplayed({ timeout: 5000 })
    expect(await card.getText()).toContain(w.art.targetTitle)
    expect(await card.getText()).toContain('Target description line.')
    await browser.keys('Escape')
    await card.waitForDisplayed({ reverse: true })
  })

  it('a plain click opens the target bead', async () => {
    await chip().click()
    await browser.waitUntil(
      async () =>
        (await browser.getUrl()).includes(
          `bead=${encodeURIComponent(w.art.target)}`,
        ),
      { timeout: 15000, timeoutMsg: 'target bead did not open' },
    )
  })
})
