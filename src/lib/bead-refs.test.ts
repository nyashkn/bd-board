import { describe, expect, it } from 'vitest'

import { splitBeadRefs } from './bead-refs'

const refs = (md: string) =>
  splitBeadRefs(md).flatMap((s) => (s.type === 'refs' ? [s.ids] : []))

describe('splitBeadRefs', () => {
  it('returns nothing for empty text', () => {
    expect(splitBeadRefs('')).toEqual([{ type: 'text', text: '' }])
  })
  it('leaves plain markdown as one text segment', () => {
    expect(splitBeadRefs('# Hi\n\nbody')).toEqual([
      { type: 'text', text: '# Hi\n\nbody' },
    ])
  })
  it('parses one id', () => {
    expect(splitBeadRefs(':::bead demo-abc')).toEqual([
      { type: 'refs', ids: ['demo-abc'] },
    ])
  })
  it('parses space separated ids', () => {
    expect(refs(':::bead demo-abc demo-def')).toEqual([
      ['demo-abc', 'demo-def'],
    ])
  })
  it('parses comma separated ids', () => {
    expect(refs(':::bead demo-abc,demo-def')).toEqual([
      ['demo-abc', 'demo-def'],
    ])
  })
  it('parses comma plus space ids', () => {
    expect(refs(':::bead demo-abc, demo-def , demo-ghi')).toEqual([
      ['demo-abc', 'demo-def', 'demo-ghi'],
    ])
  })
  it('accepts the single-line closed form', () => {
    expect(refs(':::bead demo-abc :::')).toEqual([['demo-abc']])
    expect(refs(':::bead demo-abc demo-def:::')).toEqual([
      ['demo-abc', 'demo-def'],
    ])
  })
  it('accepts the block form', () => {
    expect(refs(':::bead\ndemo-abc\ndemo-def\n:::')).toEqual([
      ['demo-abc', 'demo-def'],
    ])
  })
  it('keeps an unterminated block as text', () => {
    const md = ':::bead\ndemo-abc\nmore text'
    expect(splitBeadRefs(md)).toEqual([{ type: 'text', text: md }])
  })
  it('keeps an empty block as text', () => {
    expect(refs(':::bead\n:::')).toEqual([])
  })
  it('keeps a bare directive as text', () => {
    expect(refs(':::bead')).toEqual([])
    expect(refs(':::bead   ')).toEqual([])
  })
  it('keeps a directive with an invalid id as text', () => {
    expect(refs(':::bead demo-abc bad/id')).toEqual([])
    expect(refs(':::bead -nope')).toEqual([])
    expect(refs(':::bead demo-abc ???')).toEqual([])
  })
  it('rejects ids over 160 characters', () => {
    expect(refs(`:::bead ${'a'.repeat(161)}`)).toEqual([])
    expect(refs(`:::bead ${'a'.repeat(160)}`)).toHaveLength(1)
  })
  it('accepts dots and underscores in ids', () => {
    expect(refs(':::bead demo-abc.1 demo_2')).toEqual([
      ['demo-abc.1', 'demo_2'],
    ])
  })
  it('keeps duplicate ids', () => {
    expect(refs(':::bead demo-abc demo-abc')).toEqual([
      ['demo-abc', 'demo-abc'],
    ])
  })
  it('ignores a different directive name', () => {
    expect(refs(':::beads demo-abc')).toEqual([])
    expect(refs(':::question demo-abc')).toEqual([])
    expect(refs(':::beadx')).toEqual([])
  })
  it('splits surrounding text around a directive', () => {
    expect(splitBeadRefs('before\n:::bead demo-abc\nafter')).toEqual([
      { type: 'text', text: 'before' },
      { type: 'refs', ids: ['demo-abc'] },
      { type: 'text', text: 'after' },
    ])
  })
  it('handles several directives', () => {
    expect(refs(':::bead demo-a\ntext\n:::bead demo-b demo-c')).toEqual([
      ['demo-a'],
      ['demo-b', 'demo-c'],
    ])
  })
  it('does not transform backtick fenced code', () => {
    const md = '```\n:::bead demo-abc\n```'
    expect(splitBeadRefs(md)).toEqual([{ type: 'text', text: md }])
  })
  it('does not transform tilde fenced code or fences with info strings', () => {
    expect(refs('~~~\n:::bead demo-abc\n~~~')).toEqual([])
    expect(refs('```md\n:::bead demo-abc\n```')).toEqual([])
  })
  it('a longer fence is not closed by a shorter one', () => {
    expect(refs('````\n```\n:::bead demo-abc\n```\n````')).toEqual([])
  })
  it('transforms again after the fence closes', () => {
    expect(refs('```\nx\n```\n:::bead demo-abc')).toEqual([['demo-abc']])
  })
  it('treats an unclosed fence as running to the end', () => {
    expect(refs('```\n:::bead demo-abc')).toEqual([])
  })
  it('does not transform inline code', () => {
    expect(refs('use `:::bead demo-abc` to link')).toEqual([])
    expect(refs('`:::bead demo-abc`')).toEqual([])
  })
  it('does not transform indented code or mid-line text', () => {
    expect(refs('    :::bead demo-abc')).toEqual([])
    expect(refs('see :::bead demo-abc')).toEqual([])
  })
  it('allows up to three leading spaces', () => {
    expect(refs('   :::bead demo-abc')).toEqual([['demo-abc']])
  })
  it('a block does not swallow a fence or next directive', () => {
    expect(refs(':::bead\n```\n:::')).toEqual([])
    expect(refs(':::bead\n:::bead demo-a')).toEqual([['demo-a']])
  })
  it('keeps CRLF-free line structure of surrounding text', () => {
    const segs = splitBeadRefs('a\n\nb\n:::bead demo-a\n\nc')
    expect(segs.map((s) => s.type)).toEqual(['text', 'refs', 'text'])
  })
})
