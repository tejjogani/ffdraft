/**
 * What a person can do to an AI job, by its state: while it works, Pause, Take over and Stop; when
 * paused or cut short, Resume (it replans from the piece as it is now); when it is ready for
 * review, Accept, or change it by chat.
 */
import type { Run } from '@pave/schema'
import { Button, toast } from '@pave/ui'
import { Check, CircleStop, Hand, MessageSquare, Pause, Play } from 'lucide-react'
import { openAssistant } from '../../../stores/assistant'
import { useRunActions } from '../actions'
import { jobState } from './status'

export function JobControls({
  run,
  size = 'sm',
  onTakeOver,
  showChat = true,
}: {
  run: Run
  size?: 'sm' | 'md'
  /** After Take over: e.g. go to the stage's tab. */
  onTakeOver?: () => void
  showChat?: boolean
}) {
  const a = useRunActions()
  const state = jobState(run)
  const fail = (what: string) => (e: Error) => toast.error(`Couldn’t ${what}`, e.message)
  const chat = showChat && run.threadId && run.pieceId && (
    <Button
      size={size}
      variant="ghost"
      icon={MessageSquare}
      onClick={() => openAssistant({ pieceId: run.pieceId!, threadId: run.threadId! })}
    >
      {state === 'review' ? 'Change by chat' : 'Chat'}
    </Button>
  )

  if (state === 'running' || state === 'waiting')
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size={size}
          icon={Pause}
          disabled={a.pause.isPending}
          onClick={() => a.pause.mutate({ runId: run.id }, { onError: fail('pause the job') })}
        >
          Pause
        </Button>
        <Button
          size={size}
          icon={Hand}
          disabled={a.pause.isPending}
          onClick={() =>
            a.pause.mutate(
              { runId: run.id, takeover: true },
              { onError: fail('pause the job'), onSuccess: () => onTakeOver?.() },
            )
          }
        >
          Take over
        </Button>
        <Button
          size={size}
          variant="ghost"
          icon={CircleStop}
          disabled={a.cancel.isPending}
          onClick={() => a.cancel.mutate({ runId: run.id }, { onError: fail('stop the job') })}
        >
          Stop
        </Button>
        {chat}
      </div>
    )

  if (state === 'paused' || state === 'failed' || state === 'stopped')
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size={size}
          variant="primary"
          icon={Play}
          disabled={a.resuming}
          onClick={() => void a.resume(run.id).catch(fail('resume the job'))}
        >
          Resume
        </Button>
        {chat}
      </div>
    )

  if (state === 'review')
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size={size}
          variant="primary"
          icon={Check}
          disabled={a.accept.isPending}
          onClick={() => a.accept.mutate({ runId: run.id }, { onError: fail('accept it') })}
        >
          Accept
        </Button>
        {chat}
      </div>
    )

  return chat || null
}
