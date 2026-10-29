import { describe, expect, it } from 'vitest'

import { isModifiedClick, withBead } from './bead-link'

describe('withBead', () => {
  it('sets bead, clears k, keeps the other filters', () => {
    expect(withBead({ q: 'x', view: 'status', k: 'kn-1' }, 'abc-1')).toEqual({
      q: 'x',
      view: 'status',
      bead: 'abc-1',
      k: undefined,
    })
  })
})

describe('isModifiedClick', () => {
  const plain = {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    button: 0,
  }
  it('is false for a plain primary click', () => {
    expect(isModifiedClick(plain)).toBe(false)
  })
  it('is true for modifiers and non-primary buttons', () => {
    expect(isModifiedClick({ ...plain, metaKey: true })).toBe(true)
    expect(isModifiedClick({ ...plain, ctrlKey: true })).toBe(true)
    expect(isModifiedClick({ ...plain, shiftKey: true })).toBe(true)
    expect(isModifiedClick({ ...plain, button: 1 })).toBe(true)
  })
})
