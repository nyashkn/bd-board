import { describe, expect, it } from 'vitest'

import { isTyping, keyAction, stepIndex } from './keyboard'

describe('keyAction', () => {
  it('maps the documented keys', () => {
    expect(keyAction({ key: 'j' })).toEqual({ type: 'move', delta: 1 })
    expect(keyAction({ key: 'ArrowUp' })).toEqual({ type: 'move', delta: -1 })
    expect(keyAction({ key: 'Enter' })).toBeNull() // native button click
    expect(keyAction({ key: '/' })).toEqual({ type: 'focus-search' })
    expect(keyAction({ key: '?' })).toEqual({ type: 'help' })
    expect(keyAction({ key: 'x' })).toBeNull()
  })

  it('stays silent while typing, with a modifier, or behind a dialog', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT'])
      expect(keyAction({ key: 'j', target: { tagName } })).toBeNull()
    expect(
      keyAction({
        key: '/',
        target: { tagName: 'DIV', isContentEditable: true },
      }),
    ).toBeNull()
    expect(keyAction({ key: 'k', metaKey: true })).toBeNull()
    expect(keyAction({ key: 'j' }, true)).toBeNull()
    expect(
      keyAction({ key: 'j', target: { tagName: 'BUTTON' } }),
    ).not.toBeNull()
    expect(isTyping(null)).toBe(false)
  })
})

describe('stepIndex', () => {
  it('starts at the ends, clamps, and handles empty lists', () => {
    expect(stepIndex(-1, 1, 5)).toBe(0)
    expect(stepIndex(-1, -1, 5)).toBe(4)
    expect(stepIndex(4, 1, 5)).toBe(4)
    expect(stepIndex(0, -1, 5)).toBe(0)
    expect(stepIndex(2, 1, 5)).toBe(3)
    expect(stepIndex(0, 1, 0)).toBe(-1)
  })
})
