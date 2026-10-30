import { describe, expect, it } from 'vitest'

import { descriptionExcerpt } from './bead-excerpt'

describe('descriptionExcerpt', () => {
  it('is empty without a description', () => {
    expect(descriptionExcerpt(undefined)).toBe('')
    expect(descriptionExcerpt('  \n\n')).toBe('')
  })
  it('keeps short text as is', () => {
    expect(descriptionExcerpt('one\ntwo')).toBe('one\ntwo')
  })
  it('keeps three lines and marks the cut', () => {
    expect(descriptionExcerpt('a\nb\nc\nd')).toBe('a\nb\nc…')
  })
  it('skips blank lines and code fences', () => {
    expect(descriptionExcerpt('a\n\n```\nb')).toBe('a\nb')
  })
  it('strips markdown markers', () => {
    expect(descriptionExcerpt('# Title\n- **bold** `code`')).toBe(
      'Title\nbold code',
    )
  })
  it('truncates long lines', () => {
    const out = descriptionExcerpt('x'.repeat(300), 3, 10)
    expect(out).toBe(`${'x'.repeat(10)}…`)
  })
})
