import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { bd } from '../../world.js'
import { openApp, world } from './helpers.js'

const w = world()
const registry = path.join(w.home, '.config', 'bd-board', 'projects.json')
let original = ''

describe('ask and answer on a bead (writable fixture project)', () => {
  before(async () => {
    // The `ask` project is registered only for this spec, so other specs' project counts hold.
    original = readFileSync(registry, 'utf8')
    const reg = JSON.parse(original) as { projects: object[] }
    reg.projects.push({ id: w.ask.id, path: w.ask.dir, label: w.ask.id })
    writeFileSync(registry, JSON.stringify(reg))
    bd(w.ask.dir, w.home, [
      'comments',
      'add',
      w.ask.bead,
      ':::question id=demo-q1 stopped\nWhich approach should we use?\n\n- [ ] Option A\n- [ ] Option B\n\nRecommended: Option A\n:::',
    ])
    await openApp(`/p/${w.ask.id}?view=status&bead=${w.ask.bead}`)
  })

  after(() => {
    writeFileSync(registry, original)
  })

  it('renders the question as a card and writes the picked option as an ANSWER comment', async () => {
    const card = $('[data-testid="question-card"]')
    await card.waitForDisplayed({ timeout: 30000 })
    expect(await card.getText()).toContain('Stopped: waiting on you')
    expect(await card.getText()).toContain('Recommended')
    // The page may still be hydrating: click until React has taken the pick.
    const b = card.$('input[value="Option B"]')
    await browser.waitUntil(
      async () => {
        await b.click()
        return b.isSelected()
      },
      { timeoutMsg: 'the page never took the radio pick (not hydrated?)' },
    )
    const ans = card.$('button=Answer')
    await ans.click()
    await browser.waitUntil(
      () =>
        bd(w.ask.dir, w.home, ['comments', w.ask.bead, '--json']).includes(
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
