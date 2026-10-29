import { openApp, world } from './helpers.js'

const index = () =>
  browser.execute(
    () =>
      (window.history.state as { __TSR_index?: number } | null)?.__TSR_index ??
      -1,
  )

describe('navigation keeps context (read-only fixture project)', () => {
  it('keeps the search when switching tabs', async () => {
    await openApp(`/p/${world().ro.id}?q=bead`)
    await $('[role="tab"][aria-label="Hierarchy"]').click()
    await browser.waitUntil(async () =>
      (await browser.getUrl()).includes('tab=hierarchy'),
    )
    expect(await browser.getUrl()).toContain('q=bead')
  })

  it('closing a bead pops its history entry and returns focus to the card', async () => {
    await openApp(`/p/${world().ro.id}`)
    const card = $('[data-bead-id]')
    await card.waitForDisplayed({ timeout: 30000 })
    const id = await card.getAttribute('data-bead-id')
    const before = await index()

    await card.click()
    await $('[role="dialog"]').waitForDisplayed()
    expect(await index()).toBe(before + 1)

    // copy actions are write-free, so they exist in a read-only project
    for (const label of [
      'Copy bead id',
      'Copy bd show command',
      'Copy agent-deck nudge',
    ]) {
      const btn = $(`button[aria-label="${label}"]`)
      await expect(btn).toBeDisplayed()
      const { width, height } = await btn.getSize()
      expect(Math.min(width, height)).toBeGreaterThanOrEqual(24)
    }

    await browser.keys('Escape')
    await browser.waitUntil(
      async () => !(await $('[role="dialog"]').isExisting()),
    )
    expect(await index()).toBe(before)
    expect(await browser.getUrl()).not.toContain('bead=')
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.activeElement?.getAttribute('data-bead-id') ?? '',
        )) === id,
      { timeoutMsg: 'focus did not return to the card' },
    )
  })

  it('a directly loaded ?bead= closes by replacing the URL', async () => {
    const w = world()
    await openApp(`/p/${w.ro.id}?bead=${encodeURIComponent(w.ro.bead)}`)
    await $('[role="dialog"]').waitForDisplayed({ timeout: 30000 })
    const before = await index()
    await browser.keys('Escape')
    await browser.waitUntil(
      async () => !(await $('[role="dialog"]').isExisting()),
    )
    expect(await index()).toBe(before)
    expect(await browser.getUrl()).not.toContain('bead=')
  })
})
