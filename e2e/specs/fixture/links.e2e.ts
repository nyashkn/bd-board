import { bd } from '../../world.js'
import { openApp, world } from './helpers.js'

const w = world()

const card = () => $(`[data-bead-id="${w.art.bead}"]`)

describe('bead cards are real links (writable fixture project)', () => {
  before(async () => {
    await openApp(`/p/${w.art.id}?view=status`)
    await card().waitForDisplayed({ timeout: 30000 })
  })

  it('the card is an anchor whose href deep-links the bead', async () => {
    expect(await card().getTagName()).toBe('a')
    expect(await card().getAttribute('href')).toContain(
      `bead=${encodeURIComponent(w.art.bead)}`,
    )
  })

  it('a plain click opens the modal over the board and pushes ?bead=', async () => {
    await card().click()
    await $('[role="dialog"]').waitForDisplayed({ timeout: 15000 })
    expect(await browser.getUrl()).toContain(
      `bead=${encodeURIComponent(w.art.bead)}`,
    )
    await browser.keys('Escape')
    await $('[role="dialog"]').waitForDisplayed({ reverse: true })
  })

  it('dragging by the handle still moves the card and does not open it', async () => {
    // Viewport point inside the (empty) In progress column, below its header.
    const [dropX, dropY] = await browser.execute(() => {
      const h = [...document.querySelectorAll('h2')].find(
        (e) => e.textContent === 'In progress',
      )!
      // Far right of the column: the overlay hangs left of the grab point, so this keeps it over the column.
      const r = h.parentElement!.getBoundingClientRect()
      return [Math.round(r.right - 8), Math.round(r.bottom + 250)]
    })
    // Write controls appear only once the project is known to be writable.
    await $('[aria-label="Drag bead"]').waitForExist({ timeout: 15000 })
    await card().moveTo()
    // Viewport coordinates, not an element origin: live refetches can re-render and stale the handle.
    const [hx, hy] = await browser.execute((id) => {
      const handle = document
        .querySelector(`[data-bead-id="${id}"]`)!
        .parentElement!.querySelector('[aria-label="Drag bead"]')!
      const r = handle.getBoundingClientRect()
      return [
        Math.round(r.left + r.width / 2),
        Math.round(r.top + r.height / 2),
      ]
    }, w.art.bead)
    await browser
      .action('pointer')
      .move({ origin: 'viewport', x: hx, y: hy })
      .down()
      .pause(150)
      .move({ origin: 'pointer', x: 12, y: 12, duration: 150 })
      .move({ origin: 'viewport', x: dropX, y: dropY, duration: 400 })
      .pause(300)
      .move({ origin: 'viewport', x: dropX + 2, y: dropY + 2, duration: 100 })
      .pause(200)
      .up()
      .perform()

    await browser.waitUntil(
      () =>
        bd(w.art.dir, w.home, ['show', w.art.bead, '--json']).includes(
          '"in_progress"',
        ),
      { timeout: 15000, timeoutMsg: 'bead did not move to in_progress' },
    )
    await expect($('[role="dialog"]')).not.toExist()
    expect(await browser.getUrl()).not.toContain('bead=')
  })
})
