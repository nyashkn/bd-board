import { describe, expect, it } from 'vitest'

import {
  actorArgs,
  agentNudgeCommand,
  parseConfigActor,
  resolveCommentAuthor,
} from './comment-author'

describe('comment author', () => {
  it('follows bd order, board override first', () => {
    const env = { BD_BOARD_AUTHOR: 'owner', BD_ACTOR: 'a', USER: 'u' }
    expect(resolveCommentAuthor({ env })).toEqual({
      name: 'owner',
      source: 'BD_BOARD_AUTHOR',
    })
    expect(
      resolveCommentAuthor({ env: { BD_ACTOR: 'a', USER: 'u' } }).name,
    ).toBe('a')
    expect(
      resolveCommentAuthor({ env: { BEADS_ACTOR: 'b', USER: 'u' } }).source,
    ).toBe('BEADS_ACTOR')
    expect(
      resolveCommentAuthor({
        env: { USER: 'u' },
        configActor: 'c',
        gitName: 'g',
      }).source,
    ).toBe('bd config actor')
    expect(resolveCommentAuthor({ env: { USER: 'u' }, gitName: 'KN' })).toEqual(
      { name: 'KN', source: 'git user.name' },
    )
    expect(resolveCommentAuthor({ env: { USER: 'u' } }).source).toBe('USER')
    expect(resolveCommentAuthor({ env: {} })).toEqual({
      name: '',
      source: null,
    })
  })

  it('only forces --actor for the board override', () => {
    expect(actorArgs({ BD_ACTOR: 'a' })).toEqual([])
    expect(actorArgs({ BD_BOARD_AUTHOR: ' me ' })).toEqual(['--actor', 'me'])
  })

  it('reads bd config get actor', () => {
    expect(parseConfigActor('actor (not set in config.yaml)\n')).toBe('')
    expect(parseConfigActor('carol\n')).toBe('carol')
  })

  it('builds the agent-deck nudge', () => {
    expect(agentNudgeCommand('x-1')).toBe(
      'agent-deck session send <session> "Read the new comment: bd comments x-1"',
    )
  })
})
