import { bd } from '../../world.js'
import { openApp, world } from './helpers.js'

const w = world()

describe('ask and answer on a bead (writable fixture project)', () => {
  before(async () => {
    bd(w.art.dir, w.home, [
      'comments',
      'add',
      w.art.bead,
      ':::question id=demo-q1 stopped\nWhich approach should we use?\n\n- [ ] Option A\n- [ ] Option B\n\nRecommended: Option A\n:::',
    ])
    await openApp(`/p/${w.art.id}?view=status&bead=${w.art.bead}`)
  })

  it('renders the question as a card and writes the picked option as an ANSWER comment', async () => {
    const card = $('[data-testid="question-card"]')
    await card.waitForDisplayed({ timeout: 30000 })
    expect(await card.getText()).toContain('Stopped: waiting on you')
    expect(await card.getText()).toContain('Recommended')
    // The page may still be hydrating: click until React has taken the pick.
    const b = card.$('input[value="Option B"]')
    await browser.waitUntil(async () => {
      await b.click()
      return b.isSelected()
    })
    const ans = card.$('button=Answer')
    await ans.click()
    await browser.waitUntil(
      () =>
        bd(w.art.dir, w.home, ['comments', w.art.bead, '--json']).includes(
          'ANSWER: demo-q1 Option B',
        ),
      { timeout: 15000, timeoutMsg: 'no ANSWER comment was written' },
    )
    await browser.waitUntil(
      async () => (await card.getText()).includes('Answered'),
      { timeout: 15000 },
    )
  })
})
