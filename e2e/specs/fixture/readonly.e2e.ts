import { ledger } from '../../world.js'
import { openApp, world } from './helpers.js'

const w = world()

/** Calls the real server functions from the page (Vite serves the module; the calls go over HTTP). */
async function callWrites(project: string, id: string): Promise<string[]> {
  return browser.executeAsync(
    async (
      args: { project: string; id: string },
      done: (out: string[]) => void,
    ) => {
      const specifier = '/src/lib/server.ts'
      const mod = await import(/* @vite-ignore */ specifier)
      const attempts: (() => Promise<unknown>)[] = [
        () =>
          mod.createBeadFn({
            data: { project: args.project, title: 'injected' },
          }),
        () =>
          mod.updateBeadFn({
            data: {
              project: args.project,
              id: args.id,
              title: 'hacked', // flat: parseUpdateBeadInput reads fields at the top level
            },
          }),
        () =>
          mod.updateBeadStatusFn({
            data: { project: args.project, id: args.id, status: 'closed' },
          }),
        () =>
          mod.addCommentFn({
            data: { project: args.project, id: args.id, text: 'injected' },
          }),
        () =>
          mod.deleteBeadFn({ data: { project: args.project, id: args.id } }),
      ]
      const out: string[] = []
      for (const attempt of attempts) {
        try {
          await attempt()
          out.push('ALLOWED')
        } catch (err) {
          out.push(err instanceof Error ? err.message : String(err))
        }
      }
      done(out)
    },
    { project, id },
  )
}

describe('read-only project (real server, real shim, real bd)', () => {
  const before = { ro: { count: 0, hash: '' }, rof: { count: 0, hash: '' } }

  beforeEach(() => {
    // Snapshots are taken once, before any UI work.
    if (!before.ro.hash) {
      before.ro = ledger(w, w.ro.dir)
      before.rof = ledger(w, w.rof.dir)
    }
  })

  it('shows the badge and no write controls on the board', async () => {
    await openApp(`/p/${w.ro.id}`)
    await $('[data-bead-id]').waitForDisplayed({ timeout: 30000 })
    await expect($('*=Read-only')).toBeDisplayed()
    await expect($('button=New bead')).not.toExist()
    await expect($('[aria-label="Drag bead"]')).not.toExist()
  })

  it('shortcuts do not open any write dialog', async () => {
    await $('body').click()
    for (const key of ['n', 'c', 'e', 'a', 'Delete', 'Backspace']) {
      await browser.keys(key)
    }
    await browser.pause(300)
    await expect($('[role="dialog"]')).not.toExist()
    await expect(
      $('input[name="title"], textarea[name="comment"]'),
    ).not.toExist()
  })

  it('offers no Edit, Delete, Subtask or comment box in the bead modal', async () => {
    await openApp(`/p/${w.ro.id}?bead=${encodeURIComponent(w.ro.bead)}`)
    await $('[role="dialog"]').waitForDisplayed({ timeout: 30000 })
    await expect($('button=Edit')).not.toExist()
    await expect($('button=Delete')).not.toExist()
    await expect($('button=Comment')).not.toExist()
    await expect($('textarea[name="comment"]')).not.toExist()
    const status = $('[aria-label="Change status"]')
    await expect(status).toBeDisplayed()
    expect(await status.getAttribute('data-disabled')).not.toBeNull()
  })

  it('a filtered read-only project shows only the labelled bead, with the filter in the badge', async () => {
    await openApp(`/p/${w.rof.id}`)
    // The labelled epic is a lane, its child a card; the other epic is filtered out.
    await $(`[data-bead-id="${w.rof.child}"]`).waitForDisplayed({
      timeout: 30000,
    })
    const text = await browser.execute(() => document.body.innerText)
    expect(text).toContain('Labelled bead')
    expect(text).not.toContain('Unlabelled bead')
    await expect($('*=Read-only')).toBeDisplayed()
    await expect($('button=New bead')).not.toExist()
    const title = await browser.execute(
      () =>
        [...document.querySelectorAll('[title]')]
          .map((e) => e.getAttribute('title') ?? '')
          .find((t) => t.startsWith('Read-only project')) ?? '',
    )
    expect(title).toContain('"wo"')
  })

  it('the server functions refuse every write for read-only projects', async () => {
    await openApp(`/p/${w.ro.id}`)
    for (const [project, id] of [
      [w.ro.id, w.ro.bead],
      [w.rof.id, w.rof.wo],
    ]) {
      const results = await callWrites(project, id)
      expect(results).toHaveLength(5)
      for (const message of results) expect(message).toMatch(/read-only/i)
    }
  })

  it('left the beads exactly as they were (count and hash)', () => {
    expect(ledger(w, w.ro.dir)).toEqual(before.ro)
    expect(ledger(w, w.rof.dir)).toEqual(before.rof)
  })
})
