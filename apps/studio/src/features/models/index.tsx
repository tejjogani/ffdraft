import { IMAGE_ASPECTS, type ImageAspect, type ModelShot, type Piece } from '@pave/schema'
import {
  Button,
  buttonClass,
  controlClass,
  Field,
  IconButton,
  InlineError,
  Skeleton,
  Textarea,
} from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Camera, Download, Images, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Column, PageHeader, PageTitle } from '../../components/Page'
import { assetUrl } from '../../lib/assets'
import { usd } from '../../lib/format'
import { useRpc, useRpcMutation } from '../../lib/query'
import { useSession } from '../../lib/session'
import { LocalPhoto } from './LocalPhoto'
import { ModelDetails, NewModel } from './ModelCards'

export function ModelsPage() {
  const models = useRpc('models.list', {})
  return (
    <>
      <PageHeader crumbs={[{ label: 'Models' }]} />
      <Column wide>
        <PageTitle
          title="Brand models"
          description="Create a reusable synthetic model for photographs of your jewelry."
        />
        <div className="my-5">
          <NewModel />
        </div>
        {models.isError && (
          <InlineError message={models.error.message} onRetry={() => void models.refetch()} />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {models.data?.map((m) => (
            <Link
              key={m.id}
              to="/models/$id"
              params={{ id: m.id }}
              className="rounded-lg border border-line p-4 hover:bg-bg-hover"
            >
              <strong className="block text-lg">{m.name}</strong>
              <span className="text-sm">
                {m.status === 'approved' ? 'Approved' : 'Draft'} · Ages {m.card.ageRange}
              </span>
            </Link>
          ))}
        </div>
      </Column>
    </>
  )
}

export function ModelPage({ modelId }: { modelId: string }) {
  const models = useRpc('models.list', {})
  const model = models.data?.find((m) => m.id === modelId)
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Models', link: { to: '/models' } }, { label: model?.name ?? 'Model' }]}
      />
      <Column>
        {models.isPending ? (
          <Skeleton className="h-32" />
        ) : models.isError ? (
          <InlineError message={models.error.message} onRetry={() => void models.refetch()} />
        ) : model ? (
          <ModelDetails model={model} />
        ) : (
          <p>Model card unavailable.</p>
        )}
      </Column>
    </>
  )
}

export function PieceOnModel({ pieceId }: { pieceId: string }) {
  const piece = useRpc('pieces.get', { id: pieceId })
  if (piece.isError)
    return <InlineError message={piece.error.message} onRetry={() => void piece.refetch()} />
  return piece.data ? <Shoot key={pieceId} piece={piece.data} /> : <Skeleton className="h-36" />
}
type Setup = {
  modelId: string
  placement: ModelShot['placement']
  direction: string
  aspect: ImageAspect
}
const placements = ['hand', 'neck', 'ear', 'wrist'] as const
const setupKey = (pieceId: string) => `pave:shoot:${pieceId}`
function initialSetup(piece: Piece): Setup {
  const fallback: Setup = {
    modelId: '',
    placement:
      piece.kind === 'earrings'
        ? 'ear'
        : piece.kind === 'bracelet'
          ? 'wrist'
          : ['pendant', 'necklace', 'chain'].includes(piece.kind)
            ? 'neck'
            : 'hand',
    direction: '',
    aspect: '4:5',
  }
  try {
    const saved = JSON.parse(localStorage.getItem(setupKey(piece.id)) ?? 'null') as Setup | null
    if (
      saved &&
      typeof saved.modelId === 'string' &&
      typeof saved.direction === 'string' &&
      placements.includes(saved.placement) &&
      IMAGE_ASPECTS.includes(saved.aspect)
    )
      return saved
  } catch {
    // A missing or obsolete browser draft starts a fresh setup.
  }
  return fallback
}
function Shoot({ piece }: { piece: Piece }) {
  const modelHeadingId = useId()
  const setupHeadingId = useId()
  const generationHeadingId = useId()
  const photosHeadingId = useId()
  const directionInput = useRef<HTMLTextAreaElement>(null)
  const capable = useSession().capabilities.onModel.length > 0
  const models = useRpc('models.list', {})
  const shots = useRpc('shots.list', { pieceId: piece.id })
  const [setup, setSetup] = useState(() => initialSetup(piece))
  const [browsedModelId, setBrowsedModelId] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState('')
  const [review, setReview] = useState(false)
  const selected = models.data?.find((model) => model.id === setup.modelId)
  const browsed = models.data?.find((model) => model.id === (browsedModelId ?? setup.modelId))
  const input = { ...setup, pieceId: piece.id, count: 1 }
  const canEstimate = capable && selected?.status === 'approved'
  const estimate = useRpc('shots.estimate', input, { enabled: review && canEstimate })
  const generate = useRpcMutation('shots.create')
  const change = (patch: Partial<Setup>) => {
    setReview(false)
    setSaveMessage('')
    setSetup((current) => ({ ...current, ...patch }))
  }
  const save = () => {
    try {
      localStorage.setItem(setupKey(piece.id), JSON.stringify(setup))
      setSaveMessage('Shot setup saved on this device.')
    } catch {
      setSaveMessage('This browser could not save the shot setup.')
    }
  }
  return (
    <div className="@container grid gap-8">
      <header>
        <h1 className="studio-title">On-model studio</h1>
        <p className="mt-1 text-sm wrap-anywhere text-fg-muted">
          Photograph {piece.title || 'this piece'} on a hand, wrist, neck or ear.
        </p>
      </header>
      <LocalPhoto piece={piece} />
      <div className="grid items-start gap-7 @min-[42rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section
          aria-labelledby={modelHeadingId}
          className="grid min-w-0 gap-4 border-t border-line pt-4"
        >
          <div>
            <h2 id={modelHeadingId} className="studio-heading">
              Brand model
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Create or choose a fictional adult model card. Your workspace can reuse it across
              projects.
            </p>
          </div>
          {models.isPending ? (
            <Skeleton className="h-8 w-28" />
          ) : (
            <div>
              <NewModel
                primary={models.data?.length === 0}
                onCreated={(model) => setBrowsedModelId(model.id)}
              />
            </div>
          )}
          {models.isError && (
            <InlineError message={models.error.message} onRetry={() => void models.refetch()} />
          )}
          {!!models.data?.length && (
            <Field label="Model card">
              {(id) => (
                <select
                  id={id}
                  value={browsed?.id ?? ''}
                  onChange={(event) => setBrowsedModelId(event.target.value)}
                  className={controlClass}
                >
                  <option value="">Choose a model card</option>
                  {models.data.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} · {model.status === 'approved' ? 'Approved' : 'Draft'}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {browsed && (
            <ModelDetails
              key={browsed.id}
              model={browsed}
              onUse={
                browsed.id === setup.modelId
                  ? undefined
                  : () => {
                      change({ modelId: browsed.id })
                      directionInput.current?.focus()
                    }
              }
            />
          )}
        </section>
        <section
          aria-labelledby={setupHeadingId}
          className="grid min-w-0 gap-4 rounded-xl border border-line bg-bg-subtle p-4 sm:p-5"
        >
          <h2 id={setupHeadingId} className="studio-heading">
            Shot setup
          </h2>
          <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Model for this shot</p>
              <p className="mt-0.5 text-sm wrap-anywhere text-fg-muted">
                {selected?.name ??
                  (setup.modelId
                    ? models.isPending
                      ? 'Loading saved model…'
                      : 'Saved model unavailable'
                    : 'No model selected')}
              </p>
              {selected?.status === 'draft' && (
                <p className="mt-0.5 text-xs text-fg-muted">Approval required for generation.</p>
              )}
            </div>
            {setup.modelId && (
              <IconButton
                icon={X}
                label="Clear selected model"
                onClick={() => change({ modelId: '' })}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Worn on">
              {(id) => (
                <select
                  id={id}
                  className={controlClass}
                  value={setup.placement}
                  onChange={(event) =>
                    change({ placement: event.target.value as Setup['placement'] })
                  }
                >
                  {placements.map((placement) => (
                    <option value={placement} key={placement}>
                      {placement.charAt(0).toUpperCase() + placement.slice(1)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Image ratio">
              {(id) => (
                <select
                  id={id}
                  className={controlClass}
                  value={setup.aspect}
                  onChange={(event) => change({ aspect: event.target.value as ImageAspect })}
                >
                  {IMAGE_ASPECTS.map((aspect) => (
                    <option key={aspect}>{aspect}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field label="Shot direction">
            {(id) => (
              <Textarea
                id={id}
                ref={directionInput}
                minRows={3}
                maxLength={1000}
                placeholder="Close crop, soft daylight, neutral background…"
                value={setup.direction}
                onChange={(event) => change({ direction: event.target.value })}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              variant={selected?.status === 'approved' ? 'primary' : 'secondary'}
              onClick={save}
            >
              Save shot setup
            </Button>
            <p role="status" className="text-xs text-fg-muted">
              {saveMessage || 'Saves to this browser for this project.'}
            </p>
          </div>
          <section
            aria-labelledby={generationHeadingId}
            className="grid gap-3 border-t border-line pt-4"
          >
            <div className="flex items-start gap-2">
              <Camera aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
              <div>
                <h3 id={generationHeadingId} className="text-sm font-medium">
                  Image generation
                </h3>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {!capable ? (
                    <>
                      Choose a reference-capable image model in{' '}
                      <Link to="/settings/ai" className="underline underline-offset-2">
                        Settings › AI
                      </Link>
                      .
                    </>
                  ) : canEstimate ? (
                    <>
                      This uses the latest finished still of the current CAD. Save one in{' '}
                      <Link
                        to="/pieces/$id/render"
                        params={{ id: piece.id }}
                        className="underline underline-offset-2"
                      >
                        Render
                      </Link>
                      .
                    </>
                  ) : (
                    'Select an approved model to estimate an image.'
                  )}
                </p>
              </div>
            </div>
            {canEstimate && !review && (
              <Button className="justify-self-start" onClick={() => setReview(true)}>
                Estimate image
              </Button>
            )}
            {review && canEstimate && estimate.isFetching && (
              <p role="status" className="text-sm text-fg-muted">
                Estimating the shot…
              </p>
            )}
            {review && canEstimate && estimate.isError && (
              <InlineError
                message={estimate.error.message}
                onRetry={() => void estimate.refetch()}
              />
            )}
            {review &&
              canEstimate &&
              estimate.data &&
              !estimate.isError &&
              !estimate.isFetching && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <p>
                    Estimated {usd(estimate.data.usd)} · {estimate.data.seconds} seconds
                  </p>
                  <Button
                    variant="primary"
                    disabled={generate.isPending}
                    onClick={() => generate.mutate(input, { onSuccess: () => setReview(false) })}
                  >
                    {generate.isPending ? 'Submitting…' : 'Generate image'}
                  </Button>
                </div>
              )}
          </section>
        </section>
      </div>
      <section aria-labelledby={photosHeadingId} className="border-t border-line pt-4">
        <h2 id={photosHeadingId} className="mb-3 studio-heading">
          Project photographs
        </h2>
        {shots.isError ? (
          <InlineError message={shots.error.message} onRetry={() => void shots.refetch()} />
        ) : shots.isPending ? (
          <Skeleton className="h-14" />
        ) : shots.data.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Images aria-hidden className="size-4 shrink-0" />
            <p>Generated images of this piece will appear here.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {shots.data.map((shot) => (
              <Photograph key={shot.id} shot={shot} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Photograph({ shot }: { shot: ModelShot }) {
  const cancel = useRpcMutation('shots.cancel')
  const verified = useRpcMutation('shots.export')
  const active = shot.status === 'queued' || shot.status === 'running'
  const progress =
    shot.stage === 'references'
      ? 'Reading the CAD render…'
      : shot.stage === 'generate'
        ? 'Generating photograph…'
        : shot.stage === 'label'
          ? 'Preparing preview…'
          : shot.stage === 'verify'
            ? 'Checking the design…'
            : 'Waiting to start…'
  return (
    <article className="grid content-start gap-2 rounded-xl border border-line p-3">
      {shot.assetId && (
        <img
          className="max-h-64 rounded-md object-contain object-left"
          src={assetUrl(shot.assetId, 480)}
          alt={shot.direction || 'On-model photograph'}
        />
      )}
      <strong className="text-sm">
        <span className="capitalize">{shot.placement}</span>
        {' · '}
        {shot.provenance?.disclosure ?? shot.status}
      </strong>
      {active && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <span role="status">{progress}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate({ id: shot.id })}
          >
            Cancel shot
          </Button>
        </div>
      )}
      {shot.stale && <p className="text-xs text-fg-muted">Made from an earlier version.</p>}
      {shot.error && <InlineError message={shot.error} className="py-0" />}
      {shot.check ? (
        <p className="text-xs text-fg-muted">{shot.check.notes}</p>
      ) : shot.status === 'done' && shot.fidelity === 'concept' ? (
        <p className="text-xs text-fg-muted">For visual review. Jewelry fidelity is unverified.</p>
      ) : null}
      {shot.status === 'done' && shot.assetId && (
        <div className="flex flex-wrap gap-2">
          <a
            href={assetUrl(shot.assetId)}
            download={`pave-on-model-${shot.id}`}
            className={buttonClass({ size: 'sm' })}
          >
            <Download aria-hidden className="size-4" />
            Download preview
          </a>
          {shot.check?.passed && (
            <Button
              icon={Download}
              size="sm"
              disabled={verified.isPending}
              onClick={() =>
                verified.mutate(
                  { id: shot.id },
                  {
                    onSuccess: (asset) => {
                      const link = document.createElement('a')
                      link.href = assetUrl(asset.id)
                      link.download = asset.name
                      link.click()
                    },
                  },
                )
              }
            >
              Export verified image
            </Button>
          )}
        </div>
      )}
    </article>
  )
}
