import { IMAGE_ASPECTS, type ImageAspect, type ModelShot, type Piece } from '@pave/schema'
import { Button, InlineError, Skeleton, Textarea } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { Column, PageHeader, PageTitle } from '../../components/Page'
import { assetUrl } from '../../lib/assets'
import { usd } from '../../lib/format'
import { useRpc, useRpcMutation } from '../../lib/query'
import { useSession } from '../../lib/session'
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
  return piece.data ? <Shoot key={pieceId} piece={piece.data} /> : <Skeleton className="h-36" />
}
type Setup = {
  modelId: string
  placement: ModelShot['placement']
  direction: string
  aspect: ImageAspect
}
const placements = ['hand', 'neck', 'ear', 'wrist'] as const
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
    const saved = JSON.parse(
      localStorage.getItem('pave:shoot:' + piece.id) ?? 'null',
    ) as Setup | null
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
  const directionId = useId()
  const capable = useSession().capabilities.onModel.length > 0
  const models = useRpc('models.list', {})
  const shots = useRpc('shots.list', { pieceId: piece.id })
  const [setup, setSetup] = useState(() => initialSetup(piece))
  const [saveMessage, setSaveMessage] = useState('')
  const [review, setReview] = useState(false)
  const selected = models.data?.find((m) => m.id === setup.modelId)
  const input = { ...setup, pieceId: piece.id, count: 1 }
  const estimate = useRpc('shots.estimate', input, {
    enabled: review && capable && selected?.status === 'approved',
  })
  const generate = useRpcMutation('shots.create')
  const change = (patch: Partial<Setup>) => {
    setReview(false)
    setSaveMessage('')
    setSetup((s) => ({ ...s, ...patch }))
  }
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="studio-title">On-model studio</h1>
        <p className="mt-1 text-base text-fg-muted">
          Choose who wears {piece.title || 'this piece'} and describe the photograph.
        </p>
      </div>
      <section className="grid gap-4 rounded-xl border border-line-strong p-5">
        <h2 className="studio-heading">Shot setup</h2>
        <label className="grid gap-1 text-base font-semibold">
          Brand model
          <select
            value={setup.modelId}
            onChange={(e) => change({ modelId: e.target.value })}
            className="rounded-md border border-line bg-bg p-2"
          >
            <option value="">Choose a model</option>
            {models.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.status}
              </option>
            ))}
          </select>
        </label>
        {models.isError && (
          <InlineError message={models.error.message} onRetry={() => void models.refetch()} />
        )}
        {selected && <ModelDetails model={selected} />}
        <div>
          <NewModel onCreated={(m) => change({ modelId: m.id })} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="grid gap-1 text-base font-semibold">
            Worn on
            <select
              className="rounded-md border border-line bg-bg p-2 capitalize"
              value={setup.placement}
              onChange={(e) => change({ placement: e.target.value as Setup['placement'] })}
            >
              {placements.map((x) => (
                <option value={x} key={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-base font-semibold">
            Image ratio
            <select
              className="rounded-md border border-line bg-bg p-2"
              value={setup.aspect}
              onChange={(e) => change({ aspect: e.target.value as ImageAspect })}
            >
              {IMAGE_ASPECTS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
        <label htmlFor={directionId} className="grid gap-1 text-base font-semibold">
          Shot direction
          <Textarea
            id={directionId}
            maxLength={1000}
            placeholder="Close-up, relaxed hand, soft daylight…"
            value={setup.direction}
            onChange={(e) => change({ direction: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              try {
                localStorage.setItem('pave:shoot:' + piece.id, JSON.stringify(setup))
                setSaveMessage('Shot setup saved on this device.')
              } catch {
                setSaveMessage('This browser could not save the shot setup.')
              }
            }}
          >
            Save shot setup
          </Button>
          {capable && selected?.status === 'approved' && (
            <Button onClick={() => setReview(true)}>Estimate image</Button>
          )}
          {saveMessage && <span role="status">{saveMessage}</span>}
        </div>
        {!capable && (
          <p className="rounded-md bg-bg-muted p-3 text-base">
            You can save the shot setup. Image generation is unavailable on this server.
          </p>
        )}
        {review && estimate.isFetching && <p>Estimating the shot…</p>}
        {review && estimate.isError && (
          <InlineError message={estimate.error.message} onRetry={() => void estimate.refetch()} />
        )}
        {review && estimate.data && (
          <div className="flex flex-wrap items-center gap-3 text-base">
            <p>
              Estimated {usd(estimate.data.usd)} · {estimate.data.seconds} seconds
            </p>
            <Button
              variant="primary"
              disabled={generate.isPending}
              onClick={() => generate.mutate(input, { onSuccess: () => setReview(false) })}
            >
              Generate image
            </Button>
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-3 studio-heading">Project photographs</h2>
        {shots.isError ? (
          <InlineError message={shots.error.message} onRetry={() => void shots.refetch()} />
        ) : shots.isPending ? (
          <Skeleton className="h-14" />
        ) : shots.data.length === 0 ? (
          <p className="text-base text-fg-muted">No on-model photographs yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {shots.data.map((shot) => (
              <article key={shot.id} className="rounded-lg border border-line p-3">
                {shot.assetId && (
                  <img
                    className="mb-2 max-h-64 rounded-md"
                    src={assetUrl(shot.assetId, 480)}
                    alt={shot.direction || 'On-model photograph'}
                  />
                )}
                <strong>
                  {shot.placement} · {shot.status}
                </strong>
                {shot.stale && <p>Made from an earlier version</p>}
                {shot.error && <p>{shot.error}</p>}
                {shot.check && <p>{shot.check.notes}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
