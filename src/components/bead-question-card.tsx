import { useId, useState } from 'react'
import Markdown from 'react-markdown'

import { BeadLink } from '@/components/bead-link'
import { Button } from '@/components/ui/button'
import { useSince } from '@/components/since-band'
import { cn } from '@/lib/utils'

import type { Question } from '@/lib/bead-questions'

/** Small badge on a card or row whose bead has an unanswered `stopped` question. */
export function NeedsYou({ id }: { id: string }) {
  if (!useSince().asking.has(id)) return null
  return (
    <span
      className="shrink-0 rounded-[4px] bg-warn/15 px-1 py-px text-[10px] leading-[1.5] font-semibold text-warn"
      title="An agent is waiting on your answer"
    >
      Needs you
    </span>
  )
}

/** An agent's `:::question` comment block: pick an option, post it back as an `ANSWER:` comment. */
export function QuestionCard({
  question: q,
  readonly,
  pending,
  onAnswer,
}: {
  question: Question
  readonly: boolean
  pending: boolean
  onAnswer: (choice: string) => void
}) {
  const name = useId()
  const [picked, setPicked] = useState(q.recommended ?? '')
  const answered = q.answered
  const canAnswer = !readonly && !answered
  return (
    <div
      className={cn(
        'my-1.5 rounded-[9px] p-3 ring-1 ring-inset ring-border',
        answered ? 'bg-muted/40 opacity-70' : 'bg-card',
      )}
      data-testid="question-card"
    >
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold">
        <span className="text-muted-foreground">Question</span>
        {q.stopped && !answered ? (
          <span className="text-warn">Stopped: waiting on you</span>
        ) : null}
        {answered ? (
          <span className="text-muted-foreground">Answered</span>
        ) : null}
      </div>
      <div
        id={`${name}-q`}
        className="mb-2 text-[13px] [&_p]:my-0 [&_p]:[overflow-wrap:anywhere]"
      >
        <Markdown>{q.text}</Markdown>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={`${name}-q`}
        className="flex flex-col gap-1"
      >
        {q.options.map((opt) => {
          const chosen = answered ? answered.choice === opt : picked === opt
          return (
            <label
              key={opt}
              className={cn(
                'flex items-start gap-2 text-[13px] [overflow-wrap:anywhere]',
                canAnswer ? 'cursor-pointer' : 'cursor-default',
                chosen && 'font-medium',
              )}
            >
              <input
                type="radio"
                name={name}
                value={opt}
                className="mt-1"
                checked={chosen}
                disabled={!canAnswer}
                onChange={() => setPicked(opt)}
              />
              <span>
                {opt}
                {q.recommended === opt ? (
                  <span className="ml-2 rounded-[4px] bg-primary/10 px-1 text-[10px] font-semibold text-primary-text">
                    Recommended
                  </span>
                ) : null}
              </span>
            </label>
          )
        })}
      </div>
      {answered && !q.options.includes(answered.choice) ? (
        <p className="mt-1 text-[12px]">Answered: {answered.choice}</p>
      ) : null}
      {q.holdsUp.length ? (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Holds up:{' '}
          {q.holdsUp.map((id, i) => (
            <span key={id}>
              {i ? ', ' : ''}
              <BeadLink beadId={id} className="font-mono underline">
                {id}
              </BeadLink>
            </span>
          ))}
        </p>
      ) : null}
      {canAnswer ? (
        <Button
          type="button"
          size="sm"
          className="mt-2"
          disabled={!picked || pending}
          onClick={() => onAnswer(picked)}
        >
          Answer
        </Button>
      ) : null}
    </div>
  )
}
