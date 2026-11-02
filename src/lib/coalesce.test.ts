import { describe, expect, it } from 'vitest'

import { coalesced } from './coalesce.ts'

const gate = () => {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { opened, open }
}

describe('coalesced', () => {
  it('a burst costs two runs, and each caller gets a run that began after its call', async () => {
    let runs = 0
    const first = gate()
    const build = async () => {
      const n = ++runs
      if (n === 1) await first.opened
      return n
    }
    const a = coalesced('p', build)
    const late = [coalesced('p', build), coalesced('p', build)]
    expect(runs).toBe(1)
    first.open()
    expect(await a).toBe(1)
    expect(await Promise.all(late)).toEqual([2, 2])
    expect(runs).toBe(2)
  })

  it('keys are independent, and a finished key runs again', async () => {
    let runs = 0
    const build = async () => ++runs
    expect(
      await Promise.all([coalesced('a', build), coalesced('b', build)]),
    ).toEqual([1, 2])
    expect(await coalesced('a', build)).toBe(3)
  })

  it('an error reaches its callers and does not wedge the key', async () => {
    const boom = coalesced('e', () => Promise.reject(new Error('boom')))
    const next = coalesced('e', () => Promise.resolve('ok'))
    await expect(boom).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ok')
    await expect(coalesced('e', () => Promise.resolve('again'))).resolves.toBe(
      'again',
    )
  })
})
