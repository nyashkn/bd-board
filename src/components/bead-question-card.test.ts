import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { QuestionCard } from './bead-question-card'

import type { Question } from '@/lib/bead-questions'

const q = (over: Partial<Question> = {}): Question => ({
  id: 'q1',
  text: 'Which?',
  options: ['A', 'B'],
  stopped: true,
  holdsUp: [],
  commentIndex: 0,
  ...over,
})

const html = (
  question: Question,
  props: { readonly?: boolean; error?: string } = {},
) =>
  renderToStaticMarkup(
    createElement(QuestionCard, {
      question,
      readonly: false,
      pending: false,
      onAnswer: () => {},
      ...props,
    }),
  )

describe('QuestionCard', () => {
  it('is a labelled radiogroup with an Answer button', () => {
    const h = html(q())
    expect(h).toContain('role="radiogroup"')
    expect(h).toContain('aria-labelledby')
    expect(h).toContain('Stopped: waiting on you')
    expect(h).toContain('>Answer<')
  })

  it('falls back to the accessible name "Question" without text', () => {
    const h = html(q({ text: '' }))
    expect(h).toContain('aria-label="Question"')
    expect(h).not.toContain('aria-labelledby')
  })

  it('announces the answer in a polite status line and drops the controls', () => {
    const h = html(q({ answered: { choice: 'B', commentIndex: 1 } }))
    expect(h).toContain('role="status"')
    expect(h).toContain('aria-live="polite"')
    expect(h).toContain('tabindex="-1"')
    expect(h).toContain('Answered: B')
    expect(h).not.toContain('Stopped: waiting')
    expect(h).not.toContain('>Answer<')
    expect(h.match(/checked=""/g)).toHaveLength(1)
  })

  it('has no button and disabled radios when read-only', () => {
    const h = html(q(), { readonly: true })
    expect(h).not.toContain('>Answer<')
    expect(h).toContain('disabled')
  })

  it('shows its own error inline', () => {
    expect(html(q(), { error: 'boom' })).toContain('boom')
  })
})
