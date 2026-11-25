/**
 * A stage's AI button ("Make the CAD with AI"). It opens the job's plan before anything starts:
 * the goal (editable), the steps, the tier, then Start. Starting is the same as asking in the
 * chat; the job then shows on the piece and in the dock. The CAD job can start from a photo of a
 * piece: the photo goes with the job's message and the goal says to rebuild it.
 */
import { JOB_RECIPES } from '@pave/agent/studio'
import { DEFAULT_SHOTS, machineTime, QUALITY_LABELS } from '@pave/render'
import {
  ANIMATION_RENDER_COST,
  type Asset,
  type AssistantTier,
  type JobStage,
  type RenderScene,
  RenderSceneSchema,
} from '@pave/schema'
import { AiMark, Button, cn, Popover, Segmented, Spinner, Textarea, toast } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Circle, ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { assetUrl, uploadAsset } from '../../../lib/assets'
import { useRpc } from '../../../lib/query'
import { useSession } from '../../../lib/session'
import { assistant, useAssistant } from '../../../stores/assistant'
import { useSend } from '../actions'
import { TierPicker } from '../TierPicker'
import { isWorking, jobState } from './status'
import { useStageJob } from './useJob'

/** Added to the Render job's goal when shot references go with it. */
const SHOT_REFS_GOAL =
  ' Copy the attached shot references: read each one’s angle, framing, lens, light and any motion, place one shot per reference, and show each beside its framing capture before rendering.'

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
  // The machine time the Render plan shows: the job approves its own takes only within it.
  const [machineSeconds, setMachineSeconds] = useState<number | null>(null)
  // The goal the render plan last wrote, so a person's own words are never overwritten.
  const renderGoal = useRef(recipe.goal)
  const [tier, setTier] = useState<AssistantTier | null>(null)
  const [photo, setPhoto] = useState<Pick<Asset, 'id' | 'url' | 'name'> | null>(null)
  const [uploading, setUploading] = useState(false)
  /** Pinned pictures the Render job copies as shot references (asset ids). */
  const [shotRefs, setShotRefs] = useState<string[]>([])
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
  const working = current ? isWorking(jobState(current)) : false

  const start = async () => {
    const refs = stage === 'render' ? shotRefs : []
    // The goal stays the plan's (it has a length limit); the references' instruction is the
    // person's note that goes with the job's message.
    const said = refs.length ? SHOT_REFS_GOAL.trim() : goal.trim() || recipe.goal
    try {
      await send(said, {
        job: {
          stage,
          goal: goal.trim() || undefined,
          ...(stage === 'render' && machineSeconds !== null
            ? { machineSeconds: Math.round(machineSeconds) }
            : {}),
        },
        threadId: null,
        pieceId,
        bare: true,
        ...(photo ? { attachments: [photo.id] } : refs.length ? { attachments: refs } : {}),
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
        aria-label={recipe.button}
      >
        <AiMark className="size-3" /> <JobButtonText text={recipe.button} />
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
        <Button size="sm" variant="secondary" disabled={disabled} aria-label={recipe.button}>
          <AiMark className="size-3" /> <JobButtonText text={recipe.button} />
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
        {stage === 'cad' && !photo && (
          <PinnedPhotos
            pieceId={pieceId}
            onPick={(p) => {
              setPhoto(p)
              if (goal === recipe.goal) setGoal(PHOTO_GOAL)
            }}
          />
        )}
        {stage === 'render' && (
          <ShotReferencePicker pieceId={pieceId} value={shotRefs} onChange={setShotRefs} />
        )}
        {stage === 'render' && (
          <RenderPlan
            pieceId={pieceId}
            onGoal={(g) => {
              const prev = renderGoal.current
              renderGoal.current = g
              setGoal((current) => (current === recipe.goal || current === prev ? g : current))
            }}
            onMachineSeconds={setMachineSeconds}
          />
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

/**
 * The Render job before it starts: what it will do first (look at the piece, then two or three
 * quick questions with defaults ready, so one Go is enough), the quality it renders at, what the
 * standard set would take of this computer's time, and the free renders left. The quality and
 * the allowance become part of the job's goal; the shots, look and motion come from the answers.
 */
function RenderPlan({
  pieceId,
  onGoal,
  onMachineSeconds,
}: {
  pieceId: string
  onGoal: (goal: string) => void
  onMachineSeconds: (seconds: number | null) => void
}) {
  const piece = useRpc('pieces.get', { id: pieceId })
  const saved = useRpc('scenes.list', { pieceId })
  const engine = useRpc('renders.engine', {})
  const [quality, setQuality] = useState<RenderScene['output']['quality']>('standard')
  const shots = piece.data
    ? saved.data?.length
      ? saved.data.map((x) => ({ title: x.title, scene: x.scene }))
      : DEFAULT_SHOTS(piece.data.kind).map((d) => ({
          title: d.title,
          scene: RenderSceneSchema.parse(d.scene),
        }))
    : []
  const planned = shots.map((x) => ({ ...x.scene, output: { ...x.scene.output, quality } }))
  const estimate = useRpc(
    'renders.estimate',
    { pieceId, takes: planned.map((scene) => ({ scene })) },
    { enabled: planned.length > 0 },
  )
  const browser = engine.data ? !engine.data.available : false
  const seconds = estimate.data?.seconds ?? null
  useEffect(() => onMachineSeconds(seconds), [seconds, onMachineSeconds])
  // Blender takes count against the plan; the job plans within what is left.
  const plan = useRpc('plan.get', {})
  const renders = plan.data?.allowances.find((a) => a.allowance === 'render')
  const left = !browser && renders && renders.limit !== null ? renders.left : null
  const within =
    left !== null && left < shots.length
      ? ` Only ${left} free ${left === 1 ? 'render is' : 'renders are'} left this month (an animation counts as ${ANIMATION_RENDER_COST}): render what matters most first, and ask before the last one.`
      : ''
  const goal = `${JOB_RECIPES.render.goal} Render at ${QUALITY_LABELS[quality].toLowerCase()} quality.${within}`
  const last = useRef('')
  useEffect(() => {
    if (!piece.data || last.current === goal) return
    last.current = goal
    onGoal(goal)
  }, [goal, onGoal, piece.data])
  return (
    <div className="flex flex-col gap-2 rounded-md bg-bg-muted p-2.5">
      <p className="text-xs text-fg-muted">
        It looks at the piece first, then asks at most three quick questions (what the images are
        for, the shapes, any animations) with good answers already picked, so one Go is enough. It
        places every camera itself and checks the framing before rendering.
      </p>
      <Segmented
        size="sm"
        aria-label="Quality"
        value={quality}
        onChange={setQuality}
        options={(['preview', 'standard', 'final'] as const).map((q) => ({
          value: q,
          label: QUALITY_LABELS[q],
        }))}
      />
      <p className="text-xs text-fg-muted">
        {browser
          ? 'Without Blender, stills are drawn in the browser at preview quality, in seconds; animations need Blender.'
          : estimate.data
            ? `A set of ${shots.length} stills takes about ${machineTime(estimate.data.seconds).replace(/^about /, '')} of this computer’s time; animations count every frame. Nothing is paid.`
            : 'Working out the time…'}
      </p>
      {left !== null && renders && (
        <p className={cn('text-xs', left === 0 ? 'text-warn' : 'text-fg-muted')}>
          {left === 0 ? (
            <>
              No free Blender renders left this month.{' '}
              <Link to="/upgrade" className="underline underline-offset-2">
                See Pro
              </Link>
            </>
          ) : (
            `${left} of ${renders.limit} free Blender renders left this month; each finished take uses one (an animation ${ANIMATION_RENDER_COST}), and you are asked before the last.`
          )}
        </p>
      )}
    </div>
  )
}

/**
 * Pictures pinned to the piece that the job may read (never a view-only one: its picture is not
 * sent to AI), offered as the photo to rebuild.
 */
function PinnedPhotos({
  pieceId,
  onPick,
}: {
  pieceId: string
  onPick: (photo: Pick<Asset, 'id' | 'url' | 'name'>) => void
}) {
  const pins = useRpc('references.pins', { pieceId })
  const usable = (pins.data?.references ?? []).filter(
    (r) => r.assetId && r.rights !== 'viewOnly' && (r.type === 'image' || r.type === 'generated'),
  )
  const viewOnly = (pins.data?.references ?? []).some((r) => r.rights === 'viewOnly')
  if (!usable.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-fg-subtle">
        Or a pinned picture{viewOnly ? ' (view-only pins cannot be sent to AI)' : ''}:
      </span>
      <div className="flex flex-wrap gap-1.5">
        {usable.slice(0, 8).map((r) => (
          <button
            key={r.id}
            type="button"
            aria-label={`Rebuild from the pinned picture ${r.title || ''}`.trim()}
            onClick={() =>
              onPick({
                id: r.assetId!,
                url: assetUrl(r.assetId!, 240),
                name: r.title || 'Pinned picture',
              })
            }
            className="size-11 overflow-hidden rounded-md shadow-[0_0_0_1px_var(--line)] hover:shadow-[0_0_0_1px_var(--line-strong)]"
          >
            <img src={assetUrl(r.assetId!, 120)} alt="" className="size-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Pinned pictures offered as shot references for the Render job (never a view-only one): the
 * assistant reads their angle, framing, lens and light, and copies them shot by shot.
 */
function ShotReferencePicker({
  pieceId,
  value,
  onChange,
}: {
  pieceId: string
  value: string[]
  onChange: (assetIds: string[]) => void
}) {
  const pins = useRpc('references.pins', { pieceId })
  const usable = (pins.data?.references ?? []).filter(
    (r) => r.assetId && r.rights !== 'viewOnly' && (r.type === 'image' || r.type === 'generated'),
  )
  if (!usable.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-fg-subtle">
        Shot references to copy{value.length ? ` (${value.length} picked)` : ' (optional)'}:
      </span>
      <div className="flex flex-wrap gap-1.5">
        {usable.slice(0, 8).map((r) => {
          const on = value.includes(r.assetId!)
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={on}
              aria-label={`Shot reference: ${r.title || 'pinned picture'}`}
              onClick={() =>
                onChange(
                  on ? value.filter((v) => v !== r.assetId) : [...value, r.assetId!].slice(0, 4),
                )
              }
              className={cn(
                'size-11 overflow-hidden rounded-md shadow-[0_0_0_1px_var(--line)]',
                on && 'shadow-[0_0_0_2px_var(--select)]',
              )}
            >
              <img src={assetUrl(r.assetId!, 120)} alt="" className="size-full object-cover" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** The job button's words: in full where there is room, "AI job" in a phone's header. */
function JobButtonText({ text }: { text: string }) {
  return (
    <>
      <span className="max-sm:hidden">{text}</span>
      <span className="sm:hidden">AI job</span>
    </>
  )
}
