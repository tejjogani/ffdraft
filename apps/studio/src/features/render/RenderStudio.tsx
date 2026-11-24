/**
 * The Render tab: the shot list on the left, the selected shot drawn live (or a take shown
 * large, or two takes compared) in the middle, its settings on the right, and its takes in a
 * filmstrip below. Render renders the selected shot, Render all the whole set (mod+enter,
 * mod+shift+enter). Without Blender, takes are drawn by this window and say "Preview quality".
 * On a phone the columns stack.
 */
import { machineTime } from '@pave/render'
import type { RenderJob } from '@pave/schema'
import { AiMark, Button, cn, EmptyState, Skeleton } from '@pave/ui'
import { Camera, Columns2, Play, Settings2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { assetUrl } from '../../lib/assets'
import { type Command, useRegisterCommands } from '../../lib/commands'
import { usePieceEvaluation } from '../../lib/kernel/usePieceEvaluation'
import { useRpc } from '../../lib/query'
import { assistant } from '../../stores/assistant'
import { EngineDialog, engineLabel } from './EngineDialog'
import { ShotInspector } from './ShotInspector'
import { ShotPreview } from './ShotPreview'
import { isLive, pickOf, type Shot, takeLabel, takesOf } from './shots'
import { TakeTile } from './TakeTile'
import { useShots } from './useShots'

export function RenderStudio({ pieceId }: { pieceId: string }) {
  const s = useShots(pieceId)
  const { evaluation } = usePieceEvaluation(pieceId, 'draft')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [comparing, setComparing] = useState<[string, string] | null>(null)
  const [engineOpen, setEngineOpen] = useState(false)

  const shot = s.shots.find((x) => x.key === selectedKey) ?? s.shots[0] ?? null
  // A default shot becomes a saved one on the first edit: follow it by position.
  useEffect(() => {
    if (selectedKey && !s.shots.some((x) => x.key === selectedKey)) setSelectedKey(null)
  }, [selectedKey, s.shots])

  const takes = useMemo(() => (shot ? takesOf(shot, s.takes) : []), [shot, s.takes])
  const others = useMemo(
    () => s.takes.filter((t) => !s.shots.some((x) => x.saved && x.saved.id === t.sceneId)),
    [s.takes, s.shots],
  )
  const browser = s.engine ? !s.engine.available : false
  const estimate = useRpc(
    'renders.estimate',
    { pieceId, takes: shot ? [{ scene: shot.scene }] : [{ scene: {} as never }] },
    { enabled: !!shot && !!s.piece },
  )
  const all = useRpc(
    'renders.estimate',
    { pieceId, takes: s.shots.map((x) => ({ scene: x.scene })) },
    { enabled: s.shots.length > 0 },
  )
  const perTake = estimate.data?.takes[0] ?? null
  const view = viewing ? s.takes.find((t) => t.id === viewing && t.assetIds[0]) : null
  const pair = comparing
    ? (comparing.map((id) => s.takes.find((t) => t.id === id)).filter(Boolean) as RenderJob[])
    : null

  const commands: Command[] = shot
    ? [
        {
          id: 'render.shot',
          title: `Render ${shot.title}`,
          group: 'Piece',
          icon: Play,
          shortcut: 'mod+enter',
          run: () => void s.render([shot]),
        },
        {
          id: 'render.all',
          title: 'Render all shots',
          group: 'Piece',
          shortcut: 'mod+shift+enter',
          run: () => void s.render(s.shots),
        },
      ]
    : []
  useRegisterCommands(commands)

  if (s.loading || !s.piece)
    return (
      <div className="flex h-full gap-3 p-4">
        <Skeleton className="h-full w-56" />
        <Skeleton className="h-full flex-1" />
      </div>
    )

  const actions = {
    star: s.star,
    cover: s.cover,
    pick: s.pick,
    rerender: (t: RenderJob) => void s.rerender(t),
    cancel: s.cancel,
    open: (t: RenderJob) => {
      setComparing(null)
      setViewing(t.id)
    },
    compare: (t: RenderJob) => {
      const base = viewing ?? (shot ? pickOf(shot, takes)?.id : null)
      if (base && base !== t.id) setComparing([base, t.id])
      else setViewing(t.id)
    },
  }
  const pick = shot ? pickOf(shot, takes) : null

  return (
    // Columns only when the tab itself is wide (the dock may be open beside it); else they stack.
    <div className="@container absolute inset-0 overflow-x-hidden overflow-y-auto">
      <div className="flex min-h-full flex-col @5xl:h-full @5xl:flex-row">
        {/* Shots */}
        <nav
          aria-label="Shots"
          className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line bg-bg p-2 @5xl:w-56 @5xl:flex-col @5xl:overflow-y-auto @5xl:border-r @5xl:border-b-0"
        >
          <p className="hidden px-2 pt-1 pb-1 text-xs font-medium text-fg-subtle @5xl:block">
            Shots
          </p>
          {s.shots.map((x) => (
            <ShotRow
              key={x.key}
              shot={x}
              active={x.key === shot?.key}
              pick={pickOf(x, takesOf(x, s.takes))}
              live={takesOf(x, s.takes).some(isLive)}
              onSelect={() => {
                setSelectedKey(x.key)
                setViewing(null)
                setComparing(null)
              }}
            />
          ))}
          {!s.shots.some((x) => x.saved) && (
            <p className="hidden px-2 pt-2 text-[11px] text-fg-subtle @5xl:block">
              The standard set for a {s.piece.kind}. It is saved the first time you change or render
              a shot.
            </p>
          )}
        </nav>

        {/* Stage, filmstrip */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <button
              type="button"
              onClick={() => setEngineOpen(true)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs shadow-[inset_0_0_0_1px_var(--line)] hover:bg-bg-hover',
                browser ? 'text-warn' : 'text-fg-muted',
              )}
            >
              <Settings2 className="size-3.5" aria-hidden />
              {engineLabel(s.engine)}
            </button>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  assistant.open({
                    context: { pieceId },
                    prompt: shot ? `For the ${shot.title} shot: ` : undefined,
                  })
                }
              >
                <AiMark className="size-3" /> Direct it…
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!shot}
                onClick={() => void s.render(s.shots)}
              >
                Render all
                {all.data && !browser && (
                  <span className="hidden font-mono text-[11px] text-fg-subtle @lg:inline">
                    {machineTime(all.data.seconds)}
                  </span>
                )}
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={Camera}
                disabled={!shot}
                onClick={() => shot && void s.render([shot])}
              >
                {browser ? 'Render preview' : 'Render'}
              </Button>
            </div>
          </div>

          <div className="stage relative min-h-[360px] flex-1 overflow-hidden p-4 @5xl:min-h-0">
            {pair && pair.length === 2 ? (
              <Compare a={pair[0]!} b={pair[1]!} onClose={() => setComparing(null)} />
            ) : view ? (
              <figure className="absolute inset-4 flex flex-col items-center justify-center gap-2">
                <img
                  src={assetUrl(view.assetIds[0]!, 1600)}
                  alt={`Take: ${takeLabel(view)}`}
                  className="min-h-0 max-w-full flex-1 object-contain shadow-[0_0_0_1px_var(--line)]"
                />
                <figcaption className="flex items-center gap-2 text-xs text-fg-muted">
                  {takeLabel(view)}
                  {view.engine === 'browser' && ' · Preview quality'}
                  {view.seconds ? ` · ${Math.round(view.seconds)} s` : ''}
                  {view.note && ` · ${view.note}`}
                  <Button size="sm" variant="ghost" icon={X} onClick={() => setViewing(null)}>
                    Live view
                  </Button>
                </figcaption>
              </figure>
            ) : shot ? (
              <ShotPreview
                evaluation={evaluation}
                scene={shot.scene}
                label={`Live preview of the ${shot.title} shot`}
                className="absolute inset-4"
              />
            ) : null}
            {!view && !pair && shot && (
              <span className="glass absolute bottom-3 left-3 rounded-md px-2 py-1 text-[11px] whitespace-nowrap text-fg-muted">
                Live preview{browser ? '' : ' · takes render in Blender'}
              </span>
            )}
          </div>

          <section aria-label="Takes" className="border-t border-line bg-bg">
            <div className="flex items-center justify-between px-3 pt-2">
              <h2 className="text-xs font-medium text-fg-subtle">
                Takes{shot ? ` of ${shot.title}` : ''}
              </h2>
            </div>
            {takes.length === 0 && others.length === 0 ? (
              <EmptyState
                className="py-6"
                title="No takes yet"
                description={
                  browser
                    ? 'Render draws a preview here in seconds. For photoreal takes, set up Blender.'
                    : 'Render this shot, or the whole set; takes land here.'
                }
              />
            ) : (
              <ul className="flex gap-2 overflow-x-auto p-3">
                {[...takes, ...(shot?.saved ? [] : others)].map((t) => (
                  <li key={t.id}>
                    <TakeTile
                      take={t}
                      estimate={perTake}
                      inSet={pick?.id === t.id}
                      isCover={!!t.assetIds[0] && s.piece!.coverAssetId === t.assetIds[0]}
                      selected={viewing === t.id}
                      actions={actions}
                    />
                  </li>
                ))}
              </ul>
            )}
            {shot?.saved && others.length > 0 && (
              <details className="px-3 pb-3">
                <summary className="cursor-pointer text-xs text-fg-subtle">
                  {others.length} other {others.length === 1 ? 'take' : 'takes'} (variants and
                  one-off scenes)
                </summary>
                <ul className="mt-2 flex gap-2 overflow-x-auto">
                  {others.map((t) => (
                    <li key={t.id}>
                      <TakeTile
                        take={t}
                        estimate={null}
                        inSet={false}
                        isCover={!!t.assetIds[0] && s.piece!.coverAssetId === t.assetIds[0]}
                        selected={viewing === t.id}
                        actions={actions}
                      />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </div>

        {/* Settings */}
        <aside
          aria-label="Shot settings"
          className="shrink-0 border-t border-line bg-bg @5xl:w-[300px] @5xl:overflow-y-auto @5xl:border-t-0 @5xl:border-l"
        >
          <div className="flex h-11 items-center px-4">
            <h2 className="truncate text-sm font-medium">{shot?.title ?? 'Shot'}</h2>
          </div>
          {shot && (
            <ShotInspector
              scene={shot.scene}
              engine={s.engine ? (s.engine.available ? 'blender' : 'browser') : null}
              estimate={
                estimate.data ? { seconds: perTake ?? 0, basis: estimate.data.basis } : null
              }
              onChange={(patch) =>
                void s.adjust(shot, patch).then((next) => next && setSelectedKey(next.key))
              }
            />
          )}
        </aside>
        <EngineDialog open={engineOpen} onOpenChange={setEngineOpen} />
      </div>
    </div>
  )
}

function ShotRow({
  shot,
  active,
  pick,
  live,
  onSelect,
}: {
  shot: Shot
  active: boolean
  pick: RenderJob | null
  live: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-md p-1.5 text-left text-sm hover:bg-bg-hover',
        active && 'bg-bg-active',
      )}
    >
      <span className="relative size-10 shrink-0 overflow-hidden rounded-sm bg-bg-muted shadow-[inset_0_0_0_1px_var(--line)]">
        {pick && (
          <img src={assetUrl(pick.assetIds[0]!, 96)} alt="" className="size-full object-cover" />
        )}
        {live && (
          <span className="absolute right-0.5 bottom-0.5 size-2 animate-pulse rounded-full bg-select motion-reduce:animate-none" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{shot.title}</span>
        <span className="block truncate text-[11px] text-fg-subtle">
          {shot.scene.camera.preset} · {shot.scene.output.width}×{shot.scene.output.height}
        </span>
      </span>
    </button>
  )
}

/** Two takes, one over the other: drag the line to wipe between them. */
function Compare({ a, b, onClose }: { a: RenderJob; b: RenderJob; onClose: () => void }) {
  const [at, setAt] = useState(50)
  return (
    <div className="absolute inset-4 flex flex-col gap-2">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <img
          src={assetUrl(b.assetIds[0]!, 1600)}
          alt={`Take: ${takeLabel(b)}`}
          className="absolute inset-0 size-full object-contain"
        />
        <img
          src={assetUrl(a.assetIds[0]!, 1600)}
          alt={`Take: ${takeLabel(a)}`}
          className="absolute inset-0 size-full object-contain"
          style={{ clipPath: `inset(0 ${100 - at}% 0 0)` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-fg/60"
          style={{ left: `${at}%` }}
        />
      </div>
      <div className="flex items-center gap-3 text-xs text-fg-muted">
        <Columns2 className="size-3.5" aria-hidden />
        <span className="truncate">{takeLabel(a)}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={at}
          onChange={(e) => setAt(Number(e.target.value))}
          aria-label="Wipe between the two takes"
          className="flex-1"
        />
        <span className="truncate">{takeLabel(b)}</span>
        <Button size="sm" variant="ghost" icon={X} onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}
