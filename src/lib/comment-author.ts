/**
 * Who `bd comment` records as the author. bd resolves --actor, then BD_ACTOR / BEADS_ACTOR, then
 * the `actor` config key, then git user.name, then $USER. The board mirrors that chain so it can
 * show the name before the comment is written, and adds one override of its own,
 * `BD_BOARD_AUTHOR`, which it passes to bd as --actor.
 */

export type AuthorSource =
  | 'BD_BOARD_AUTHOR'
  | 'BD_ACTOR'
  | 'BEADS_ACTOR'
  | 'bd config actor'
  | 'git user.name'
  | 'USER'

export interface CommentAuthor {
  name: string
  source: AuthorSource | null
}

export interface AuthorInputs {
  env: Record<string, string | undefined>
  /** Value of `bd config get actor`, when set. */
  configActor?: string
  gitName?: string
}

function clean(v: string | undefined): string {
  return (v ?? '').trim()
}

export function resolveCommentAuthor({
  env,
  configActor,
  gitName,
}: AuthorInputs): CommentAuthor {
  const chain: [AuthorSource, string][] = [
    ['BD_BOARD_AUTHOR', clean(env['BD_BOARD_AUTHOR'])],
    ['BD_ACTOR', clean(env['BD_ACTOR'])],
    ['BEADS_ACTOR', clean(env['BEADS_ACTOR'])],
    ['bd config actor', clean(configActor)],
    ['git user.name', clean(gitName)],
    ['USER', clean(env['USER'])],
  ]
  const hit = chain.find(([, v]) => v)
  return hit ? { name: hit[1], source: hit[0] } : { name: '', source: null }
}

/** The `--actor` flag the board adds, only when its own override is set. */
export function actorArgs(env: Record<string, string | undefined>): string[] {
  const forced = clean(env['BD_BOARD_AUTHOR'])
  return forced ? ['--actor', forced] : []
}

/** `bd config get actor` prints "actor (not set in config.yaml)" when unset. */
export function parseConfigActor(out: string): string {
  const v = out.trim()
  return !v || /^actor \(not set/.test(v) ? '' : v.split('\n')[0].trim()
}

/** The nudge an owner pastes into an agent session so it reads the new comment now. */
export function agentNudgeCommand(beadId: string): string {
  return `agent-deck session send <session> "Read the new comment: bd comments ${beadId}"`
}
