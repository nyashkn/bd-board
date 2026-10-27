import { describe, expect, it } from 'vitest'

import { formatAge, formatDuration, formatSpan } from './age'

const NOW = Date.parse('2026-06-01T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('formatAge boundaries', () => {
  it.each([
    [0, 'just now'],
    [59_999, 'just now'],
    [MIN, '1m ago'],
    [HOUR - 1, '59m ago'],
    [HOUR, '1h ago'],
    [48 * HOUR - 1, '47h ago'],
    [48 * HOUR, '2d ago'],
    [12 * DAY, '12d ago'],
    [90 * DAY - 1, '89d ago'],
    [90 * DAY, '3mo ago'],
    [729 * DAY, '24mo ago'],
    [730 * DAY, '2y ago'],
  ])('%i ms -> %s', (ms, out) => {
    expect(formatAge(ago(ms), NOW)).toBe(out)
  })

  it('handles missing, invalid and future stamps', () => {
    expect(formatAge(undefined, NOW)).toBe('')
    expect(formatAge('nope', NOW)).toBe('')
    expect(formatAge(ago(-5 * DAY), NOW)).toBe('just now')
  })
})

describe('formatDuration', () => {
  it('formats the span between created and closed', () => {
    expect(formatDuration(ago(5 * DAY), NOW)).toBe('5d')
    expect(formatDuration(ago(3 * HOUR), NOW)).toBe('3h')
    expect(formatDuration(ago(70 * DAY + 90 * DAY), NOW)).toBe('5mo')
  })
  it('is empty on missing or negative input', () => {
    expect(formatDuration(undefined, NOW)).toBe('')
    expect(formatDuration(ago(-DAY), NOW)).toBe('')
    expect(formatDuration(ago(DAY), undefined)).toBe('')
  })
  it('sub-minute is <1m', () => {
    expect(formatSpan(10)).toBe('<1m')
  })
})
