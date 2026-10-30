import { describe, expect, it } from 'vitest'

import {
  formatAnswer,
  openStoppedQuestions,
  parseQuestions,
  splitQuestionBlocks,
} from './bead-questions'

const block = (head = ':::question id=q1', extra = '') =>
  `${head}\nWhich approach?\n\n- [ ] Option A\n- [ ] Option B\n${extra}\n:::`
const c = (text: string, id?: string) => ({ id, text })

describe('parseQuestions', () => {
  it('parses a full block', () => {
    const [q] = parseQuestions([
      c(
        ':::question id=q1 stopped\nWhich approach should we use?\n\n- [ ] Option A\n- [ ] Option B\n\nRecommended: Option A\nHolds up: demo-abc, demo-def\n:::',
        'c1',
      ),
    ])
    expect(q).toEqual({
      id: 'q1',
      text: 'Which approach should we use?',
      options: ['Option A', 'Option B'],
      recommended: 'Option A',
      stopped: true,
      holdsUp: ['demo-abc', 'demo-def'],
      commentIndex: 0,
    })
  })

  it('defaults the id to the comment id, then the index', () => {
    expect(parseQuestions([c(block(':::question'), 'c9')])[0].id).toBe('c9')
    expect(parseQuestions([c(block(':::question'))])[0].id).toBe('0')
  })

  it('is not stopped without the flag', () => {
    expect(parseQuestions([c(block())])[0].stopped).toBe(false)
  })

  it('accepts a missing closing fence', () => {
    const [q] = parseQuestions([c(':::question id=a\nPick\n- [ ] X\n- [ ] Y')])
    expect(q.options).toEqual(['X', 'Y'])
  })

  it('ignores a block with no options (plain text)', () => {
    expect(parseQuestions([c(':::question id=a\nJust prose\n:::')])).toEqual([])
  })

  it('ignores a header-only or empty comment', () => {
    expect(parseQuestions([c(':::question'), c('')])).toEqual([])
  })

  it('does not throw on odd input', () => {
    const odd = [
      '\0',
      ':::',
      '::::question',
      ':::question id=',
      '- [ ] x',
      'ANSWER:',
      'ANSWER: ',
    ]
    expect(() => parseQuestions(odd.map((t) => c(t)))).not.toThrow()
    expect(parseQuestions([{ text: undefined as unknown as string }])).toEqual(
      [],
    )
  })

  it('treats an empty id= as no id', () => {
    expect(parseQuestions([c(block(':::question id='), 'k')])[0].id).toBe('k')
  })

  it('finds two questions in one comment with distinct ids', () => {
    const qs = parseQuestions([
      c(`${block(':::question')}\n\n${block(':::question')}`, 'k'),
    ])
    expect(qs.map((q) => q.id)).toEqual(['k', 'k-2'])
  })

  it('finds questions across comments', () => {
    const qs = parseQuestions([
      c(block()),
      c('hi'),
      c(block(':::question id=q2')),
    ])
    expect(qs.map((q) => [q.id, q.commentIndex])).toEqual([
      ['q1', 0],
      ['q2', 2],
    ])
  })

  it('keeps unicode and emoji options', () => {
    const [q] = parseQuestions([
      c(
        ':::question id=u\nQ?\n- [ ] Café ☕\n- [ ] 日本語 🚀\nRecommended: 日本語 🚀\n:::',
      ),
    ])
    expect(q.options).toEqual(['Café ☕', '日本語 🚀'])
    expect(q.recommended).toBe('日本語 🚀')
  })

  it('keeps ::: inside option text', () => {
    const [q] = parseQuestions([
      c(':::question id=a\nQ?\n- [ ] use a:::b\n- [ ] other\n:::'),
    ])
    expect(q.options).toEqual(['use a:::b', 'other'])
  })

  it('drops a recommendation that matches no option', () => {
    const [q] = parseQuestions([
      c(block(':::question id=a', 'Recommended: Nope')),
    ])
    expect(q.recommended).toBeUndefined()
  })

  it('takes the first non-list paragraph as the question and keeps markdown', () => {
    const [q] = parseQuestions([
      c(
        ':::question id=a\nUse **bold** `code`?\nsecond line\n\nlater para\n- [ ] x\n:::',
      ),
    ])
    expect(q.text).toBe('Use **bold** `code`?\nsecond line')
  })

  it('accepts checked boxes and star bullets as options', () => {
    const [q] = parseQuestions([
      c(':::question id=a\nQ\n- [x] one\n* [ ] two\n:::'),
    ])
    expect(q.options).toEqual(['one', 'two'])
  })

  it('handles CRLF', () => {
    expect(
      parseQuestions([c(block().replace(/\n/g, '\r\n'))])[0].options,
    ).toHaveLength(2)
  })

  it('is case-insensitive on the fence and labels', () => {
    const [q] = parseQuestions([
      c(
        ':::Question id=a STOPPED\nQ\n- [ ] x\nrecommended: x\nholds up: d-1\n:::',
      ),
    ])
    expect(q).toMatchObject({
      stopped: true,
      recommended: 'x',
      holdsUp: ['d-1'],
    })
  })
})

describe('answers', () => {
  it('matches by id', () => {
    const [q] = parseQuestions([c(block()), c('ANSWER: q1 Option B')])
    expect(q.answered).toEqual({ choice: 'Option B', commentIndex: 1 })
  })

  it('accepts option text alone when exactly one question is open', () => {
    const [q] = parseQuestions([c(block()), c('ANSWER: option b')])
    expect(q.answered?.choice).toBe('Option B')
  })

  it('rejects option-only text when two questions are open', () => {
    const qs = parseQuestions([
      c(block()),
      c(block(':::question id=q2')),
      c('ANSWER: Option B'),
    ])
    expect(qs.every((q) => !q.answered)).toBe(true)
  })

  it('rejects option-only text that is not an option', () => {
    expect(
      parseQuestions([c(block()), c('ANSWER: Option Z')])[0].answered,
    ).toBeUndefined()
  })

  it('ignores an answer before the question', () => {
    const [q] = parseQuestions([c('ANSWER: q1 Option A'), c(block())])
    expect(q.answered).toBeUndefined()
  })

  it('ignores an answer in the same comment', () => {
    const [q] = parseQuestions([c(`${block()}\nANSWER: q1 Option A`)])
    expect(q.answered).toBeUndefined()
  })

  it('ignores an answer for an unknown id', () => {
    const [q] = parseQuestions([c(block()), c('ANSWER: zz Option A')])
    expect(q.answered).toBeUndefined()
  })

  it('answers only the matching question of two', () => {
    const qs = parseQuestions([
      c(block()),
      c(block(':::question id=q2')),
      c('ANSWER: q2 Option A'),
    ])
    expect(qs.map((q) => q.answered?.choice)).toEqual([undefined, 'Option A'])
  })

  it('keeps unicode in the choice', () => {
    const [q] = parseQuestions([c(block()), c('ANSWER: q1 Café ☕')])
    expect(q.answered?.choice).toBe('Café ☕')
  })

  it('duplicate ids: each answer closes the earliest open one', () => {
    const qs = parseQuestions([
      c(block()),
      c(block()),
      c('ANSWER: q1 Option A'),
      c('ANSWER: q1 Option B'),
    ])
    expect(qs.map((q) => q.answered?.choice)).toEqual(['Option A', 'Option B'])
  })

  it('ignores a bare id with no choice', () => {
    expect(
      parseQuestions([c(block()), c('ANSWER: q1')])[0].answered,
    ).toBeUndefined()
  })

  it('reads only the first line of an answer comment', () => {
    const [q] = parseQuestions([c(block()), c('ANSWER: q1 Option A\nthanks!')])
    expect(q.answered?.choice).toBe('Option A')
  })
})

describe('formatAnswer', () => {
  it('formats and round-trips', () => {
    expect(formatAnswer('q1', 'Option B')).toBe('ANSWER: q1 Option B')
    const [q] = parseQuestions([c(block()), c(formatAnswer('q1', 'Café ☕'))])
    expect(q.answered?.choice).toBe('Café ☕')
  })

  it('collapses newlines in the choice', () => {
    expect(formatAnswer('q1', 'a\nb')).toBe('ANSWER: q1 a b')
  })
})

describe('openStoppedQuestions', () => {
  it('lists stopped questions until answered', () => {
    const cs = [
      c(block(':::question id=q1 stopped')),
      c(block(':::question id=q2')),
    ]
    expect(openStoppedQuestions(cs).map((q) => q.id)).toEqual(['q1'])
    expect(openStoppedQuestions([...cs, c('ANSWER: q1 Option A')])).toEqual([])
  })
})

describe('splitQuestionBlocks', () => {
  it('interleaves text and block indexes', () => {
    expect(splitQuestionBlocks(`before\n${block()}\nafter`)).toEqual([
      { text: 'before' },
      { block: 0 },
      { text: 'after' },
    ])
  })

  it('leaves a malformed block as text', () => {
    const t = ':::question id=a\nno options\n:::'
    expect(splitQuestionBlocks(t)).toEqual([{ text: t }])
  })

  it('numbers blocks the same way parseQuestions does', () => {
    const t = `${block()}\n:::question\nbad\n:::\n${block(':::question id=q2')}`
    expect(splitQuestionBlocks(t).filter((p) => 'block' in p)).toHaveLength(
      parseQuestions([c(t)]).length,
    )
  })
})
