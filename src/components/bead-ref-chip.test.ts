// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BeadMarkdown } from '@/components/bead-ref-chip'
import type { Bead } from '@/lib/types'

// The router is not under test: BeadLink becomes a plain anchor.
vi.mock('@/components/bead-link', () => ({
  BeadLink: ({
    beadId,
    ...props
  }: { beadId: string } & Record<string, unknown>) =>
    createElement('a', { href: `?bead=${beadId}`, ...props }),
}))

const target = {
  id: 'demo-abc',
  title: 'Target title',
  status: 'open',
  priority: 1,
  issue_type: 'task',
  description: 'Line one\nLine two',
  labels: ['ui'],
} as Bead
const resolve = (id: string) => (id === 'demo-abc' ? target : undefined)

const md = (text: string) =>
  render(createElement(BeadMarkdown, { resolveBead: resolve, children: text }))

describe('BeadMarkdown', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders plain markdown without chips', () => {
    const { container } = md('hello **world**')
    expect(container.querySelector('strong')?.textContent).toBe('world')
    expect(container.querySelector('a')).toBeNull()
  })

  it('renders resolved and unresolved ids as links to the bead', () => {
    const { container } = md('Intro\n\n:::bead demo-abc demo-gone')
    const links = [...container.querySelectorAll('a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '?bead=demo-abc',
      '?bead=demo-gone',
    ])
    expect(links[0].textContent).toContain('Target title')
    expect(links[1].textContent).toBe('demo-gone')
  })

  it('opens the preview card after the delay on hover and closes on Escape', () => {
    vi.useFakeTimers()
    const { container } = md(':::bead demo-abc')
    const chip = container.querySelector('a')!
    fireEvent.pointerEnter(chip.parentElement!, { pointerType: 'mouse' })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    act(() => void vi.advanceTimersByTime(260))
    const card = document.querySelector('[role="tooltip"]')!
    expect(card.textContent).toContain('Target title')
    expect(card.textContent).toContain('Line one')
    expect(chip.getAttribute('aria-describedby')).toBe(card.id)
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    act(() => void vi.advanceTimersByTime(300))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('does not open on touch pointers', () => {
    vi.useFakeTimers()
    const { container } = md(':::bead demo-abc')
    fireEvent.pointerEnter(container.querySelector('a')!.parentElement!, {
      pointerType: 'touch',
    })
    act(() => void vi.advanceTimersByTime(500))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })
})
