/**
 * A stage's AI button ("Make the CAD with AI"). It opens the job's plan before anything starts:
 * the goal (editable), the steps, the tier, then Start. Starting is the same as asking in the
 * chat; the job then shows on the piece and in the dock. The CAD job can start from a photo of a
 * piece: the photo goes with the job's message and the goal says to rebuild it.
 */
import { JOB_RECIPES } from '@pave/agent/studio'
import type { Asset, AssistantTier, JobStage } from '@pave/schema'
import { AiMark, Button, Popover, Spinner, Textarea, toast } from '@pave/ui'
import { Circle, ImagePlus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { uploadAsset } from '../../../lib/assets'
import { useSession } from '../../../lib/session'
import { assistant, useAssistant } from '../../../stores/assistant'
import { useSend } from '../actions'
import { TierPicker } from '../TierPicker'
import { jobState } from './status'
import { useStageJob } from './useJob'

/** The CAD job's goal when it starts from a photo. */
const PHOTO_GOAL =
  'Rebuild the piece in the attached photo: read it, build it through the canon, fit it to the photo, and say what still differs and what was assumed.'

export function StartJob({
  pieceId,
  stage,
  disabled,
  defaultOpen,
}: {
  pieceId: string
  stage: JobStage
  disabled?: boolean
  /** Open on mount (screenshots, a deep link). */
  defaultOpen?: boolean
}) {
  const recipe = JOB_RECIPES[stage]
  const { capabilities } = useSession()
  const [open, setOpen] = useState(!!defaultOpen)
  const [goal, setGoal] = useState(recipe.goal)
  const [tier, setTier] = useState<AssistantTier | null>(null)
  const [photo, setPhoto] = useState<Asset | null>(null)
  const [uploading, setUploading] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const { send, pending } = useSend({ pieceId })

  const addPhoto = async (f: File | undefined) => {
    if (!f) return
    setUploading(true)
    try {
      const asset = await uploadAsset(f)
      setPhoto(asset)
      // The goal follows the photo unless the person has written their own.
      if (goal === recipe.goal) setGoal(PHOTO_GOAL)
    } catch (e) {
      toast.error('Couldn’t add the photo', e instanceof Error ? e.message : undefined)
    } finally {
      setUploading(false)
    }
  }
  const removePhoto = () => {
    setPhoto(null)
    if (goal === PHOTO_GOAL) setGoal(recipe.goal)
  }
  // One job per stage at a time: while one works, its bar is the place to steer it.
  const current = useStageJob(pieceId, stage).run
  const working = current ? ['running', 'waiting'].includes(jobState(current)) : false

  const start = async () => {
    try {
      await send(goal.trim() || recipe.goal, {
        job: { stage, goal: goal.trim() || undefined },
        threadId: null,
        pieceId,
        bare: true,
        ...(photo ? { attachments: [photo.id] } : {}),
        ...(tier ? { tier } : {}),
      })
      setOpen(false)
    } catch (e) {
      toast.error('Couldn’t start the job', e instanceof Error ? e.message : undefined)
    }
  }

  if (working) return null
  if (!capabilities.assistant)
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => assistant.open({ context: { pieceId } })}
      >
        <AiMark className="size-3" /> {recipe.button}
      </Button>
    )

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      title={`${recipe.label} job`}
      className="w-[360px] bg-bg! p-0"
      trigger={
        <Button size="sm" variant="secondary" disabled={disabled}>
          <AiMark className="size-3" /> {recipe.button}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <AiMark className="size-3.5" /> {recipe.label} job
          </p>
          <p className="mt-0.5 text-xs text-fg-subtle">
            You can pause, take over or stop it at any time; a change you make by hand pauses it.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-subtle">Goal</span>
          <Textarea
            minRows={2}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            aria-label="The job’s goal"
          />
        </div>
        {stage === 'cad' && (
          <div className="flex items-center gap-2">
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              aria-label="Photo of a piece to rebuild"
              onChange={(e) => {
                void addPhoto(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {photo ? (
              <>
                <img
                  src={photo.url}
                  alt={`To rebuild: ${photo.name}`}
                  className="size-12 rounded-md border border-line object-cover"
                />
                <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{photo.name}</span>
                <Button size="sm" variant="ghost" icon={X} onClick={removePhoto}>
                  Remove
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                icon={uploading ? undefined : ImagePlus}
                disabled={uploading}
                onClick={() => file.current?.click()}
              >
                {uploading ? <Spinner className="size-3.5" label="Uploading" /> : 'From a photo'}
              </Button>
            )}
          </div>
        )}
        <div>
          <p className="mb-1 text-xs font-medium text-fg-subtle">Plan</p>
          <ol className="flex flex-col gap-1">
            {recipe.steps.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm text-fg-muted">
                <Circle className="size-3 shrink-0 text-fg-faint" aria-hidden />
                {s.label}
              </li>
            ))}
          </ol>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <TierPicker
            value={tier ?? useAssistant.getState().draftTier}
            onChange={(t) => setTier(t)}
          />
          <Button variant="primary" size="sm" disabled={pending} onClick={() => void start()}>
            {pending ? 'Starting…' : 'Start job'}
          </Button>
        </div>
      </div>
    </Popover>
  )
}
