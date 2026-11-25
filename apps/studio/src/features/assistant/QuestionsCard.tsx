/**
 * The assistant's quick questions (`chat.ask`): its one-sentence read of the piece, then each
 * question as a row of quick replies with the good default already picked, so one press of Go
 * is a full answer. Each option is a toggle button (pressed = picked); a single-choice row
 * keeps one pressed, a multiple-choice row any number. Typing a message in the composer instead answers in words (the server declines the
 * questions and the message is the answer).
 */
import type { QuickQuestion } from '@pave/schema'
import { AiMark, Button, cn } from '@pave/ui'
import { Check, Play } from 'lucide-react'
import { useState } from 'react'
import type { CallItem } from './model'

export interface QuestionsInput {
  intro: string
  questions: QuickQuestion[]
}

/** Picks start at each question's defaults. */
export const initialPicks = (questions: readonly QuickQuestion[]): Record<string, string[]> =>
  Object.fromEntries(questions.map((q) => [q.id, [...q.defaults]]))

/**
 * One option pressed: a single-choice question takes it; a multiple-choice one toggles it, but
 * never down to nothing (an empty answer would mean "the defaults", which is not what a person
 * who just unticked everything meant), and picking a "none" option clears the others.
 */
export function toggle(q: QuickQuestion, picked: readonly string[], id: string): string[] {
  if (!q.multiple) return [id]
  const none = (x: string) => x === 'none'
  if (picked.includes(id)) {
    const left = picked.filter((x) => x !== id)
    return left.length ? left : [...picked]
  }
  if (none(id)) return [id]
  return [...picked.filter((x) => !none(x)), id]
}

export function QuestionsCard({
  call,
  busy,
  onGo,
}: {
  call: CallItem
  busy: boolean
  onGo: (answers: Record<string, string[]>) => void
}) {
  const input = call.input as QuestionsInput
  const questions = input?.questions ?? []
  const [picks, setPicks] = useState(() => initialPicks(questions))
  return (
    <section
      aria-label="Quick questions"
      data-approval={call.toolCallId}
      className="overflow-hidden rounded-lg bg-bg shadow-[0_0_0_1px_var(--line-strong)]"
    >
      <div className="flex flex-col gap-3 px-4 pt-3 pb-3">
        <p className="flex items-start gap-1.5 text-sm">
          <AiMark className="mt-0.5 size-3 shrink-0" />
          <span>{input?.intro ?? call.summary}</span>
        </p>
        {questions.map((q) => (
          <fieldset key={q.id} className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-medium text-fg-muted">
              {q.question}
              {q.multiple && <span className="font-normal text-fg-subtle"> · pick any</span>}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((o) => {
                const on = picks[q.id]?.includes(o.id) ?? false
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={on}
                    title={o.hint}
                    onClick={() =>
                      setPicks((p) => ({ ...p, [q.id]: toggle(q, p[q.id] ?? [], o.id) }))
                    }
                    className={cn(
                      'inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs transition-colors',
                      on
                        ? 'bg-ink text-ink-fg'
                        : 'bg-bg-muted text-fg-muted shadow-[inset_0_0_0_1px_var(--line)] hover:bg-bg-hover hover:text-fg',
                    )}
                  >
                    {on && <Check className="size-3" aria-hidden />}
                    {o.label}
                  </button>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <p className="text-2xs text-fg-subtle">Or type what you want instead.</p>
        <Button size="sm" variant="primary" icon={Play} disabled={busy} onClick={() => onGo(picks)}>
          Go
        </Button>
      </div>
    </section>
  )
}
