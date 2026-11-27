/**
 * The Render tab: the shot list on the left, the selected shot drawn live (or a take shown
 * large, or two takes compared) in the middle, its settings on the right, and its takes in a
 * filmstrip below. The live picture is a viewfinder: frame the shot by hand, and the take
 * renders exactly that (fixed seed, no automatic adjustment unless asked). Every change to a
 * shot can be undone (mod+z) and redone (mod+shift+z); a framed shot can be saved as a house
 * shot and reused on any piece. Render renders the selected shot, Render all the whole set
 * (mod+enter, mod+shift+enter). The first Blender take can install
 * the engine. Browser takes are marked "Preview quality". On a phone the columns stack.
 */
import {
  machineTime,
  redoTarget,
  renderEvaluation,
  resetCameraPatch,
  undoTarget,
} from '@pave/render'
import type { RenderJob, RenderScene } from '@pave/schema'
import {
  AiMark,
  Button,
  buttonClass,
  cn,
  EmptyState,
  IconButton,
  Menu,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  Skeleton,
  toast,
} from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Camera, Columns2, Copy, House, Play, Plus, Redo2, Settings2, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assetUrl } from '../../lib/assets'
import { type Command, useRegisterCommands } from '../../lib/commands'
import { usePieceEvaluation } from '../../lib/kernel/usePieceEvaluation'
import { useRpc } from '../../lib/query'
import { assistant, openAssistant } from '../../stores/assistant'
import { useUI } from '../../stores/ui'
import { useReadOnly } from '../assistant/AskAiSection'
import { jobState } from '../assistant/jobs/status'
import { useStageJob } from '../assistant/jobs/useJob'
import { renderAvailability, sourceMaterialSummary } from './availability'
import { engineLabel, useRenderInstallStatus } from './EngineDialog'
import { ShotInspector } from './ShotInspector'
import { addShot, saveHouseShot, takeShotIntent } from './shot-actions'
import { isLive, pickOf, type Shot, shotList, takeLabel, takeMedia, takesOf } from './shots'
import { TakeMedia } from './TakeMedia'
import { TakeTile } from './TakeTile'
import { useShots } from './useShots'
import { Viewfinder, type ViewfinderHandle } from './Viewfinder'

export function RenderStudio({ pieceId }: { pieceId: string }) {
  // Production detail, as Blender takes use: the viewfinder frames and fingerprints the take.
  const geometry = usePieceEvaluation(pieceId, 'production')
  const { evaluation } = geometry
  const baseAvailability = renderAvailability(geometry)
  const sourceMaterials = useMemo(
    () => sourceMaterialSummary(geometry.design, evaluation?.referenceParts),
    [geometry.design, evaluation?.referenceParts],
  )
  const canRenderShot = (scene: RenderScene) =>
    baseAvailability === 'ready' ||
    (baseAvailability === 'review-roles' && scene.includeUnassignedRhino === true)
  const s = useShots(pieceId, canRenderShot)
  const viewfinder = useRef<ViewfinderHandle>(null)
  const readOnly = useReadOnly()
  const renderJob = useStageJob(pieceId, 'render').run
  const jobInReview = renderJob ? jobState(renderJob) === 'review' : false
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // A shot made elsewhere ("Render this view") is selected once the list has it.
  const [wanted, setWanted] = useState<string | null>(() => takeShotIntent(pieceId))
  const [liveHash, setLiveHash] = useState<string | null>(null)
  const onHash = useCallback((h: string | null) => setLiveHash(h), [])
  const houses = useRpc('scenes.list', { pieceId: null })
  const [viewing, setViewing] = useState<string | null>(null)
  const [comparing, setComparing] = useState<[string, string] | null>(null)
  const [enablingImport, setEnablingImport] = useState(false)
  const setEngineOpen = useUI((s) => s.setEngineSetupOpen)

  const defaults = s.piece ? shotList(undefined, s.piece.kind) : []
  const defaultIndex = defaults.findIndex((preset) => preset.key === selectedKey)
  const savedDefault = s.shots.find(
    (candidate) =>
      candidate.saved?.position === defaultIndex + 1 &&
      candidate.title === defaults[defaultIndex]?.title,
  )
  const shot =
    s.shots.find((x) => x.key === selectedKey) ??
    savedDefault ??
    (baseAvailability === 'review-roles'
      ? s.shots.find((x) => x.scene.includeUnassignedRhino)
      : undefined) ??
    s.shots[0] ??
    null
  const includesImport = shot?.scene.includeUnassignedRhino
  const render = useMemo(
    () => evaluation && renderEvaluation(evaluation, geometry.design, includesImport),
    [evaluation, geometry.design, includesImport],
  )
  const hasPreview = !!(render?.parts.length || render?.stones.length)
  const canRender = !!shot && canRenderShot(shot.scene)
  const renderableShots = s.shots.filter(({ scene }) => canRenderShot(scene))
  const emptyView =
    !canRender &&
    (baseAvailability === 'review-roles' ||
      baseAvailability === 'references' ||
      baseAvailability === 'sheets' ||
      baseAvailability === 'empty')
  // A default shot becomes a saved one on the first edit: follow it by position.
  useEffect(() => {
    if (wanted && s.shots.some((x) => x.key === wanted)) {
      setSelectedKey(wanted)
      setWanted(null)
    } else if (selectedKey && !s.shots.some((x) => x.key === selectedKey))
      setSelectedKey(savedDefault?.key ?? null)
  }, [selectedKey, wanted, s.shots, savedDefault?.key])

  const takes = useMemo(() => (shot ? takesOf(shot, s.takes) : []), [shot, s.takes])
  const history = useRpc(
    'scenes.history',
    { id: shot?.saved?.id ?? '' },
    { enabled: !!shot?.saved },
  )
  const undo = history.data ? undoTarget(history.data) : null
  const redo = history.data ? redoTarget(history.data) : null
  const others = useMemo(
    () => s.takes.filter((t) => !s.shots.some((x) => x.saved && x.saved.id === t.sceneId)),
    [s.takes, s.shots],
  )
  const { status: setup } = useRenderInstallStatus()
  const estimate = useRpc(
    'renders.estimate',
    { pieceId, takes: shot ? [{ scene: shot.scene }] : [{ scene: {} as never }] },
    { enabled: canRender && !!shot && !!s.piece },
  )
  const all = useRpc(
    'renders.estimate',
    { pieceId, takes: renderableShots.map((x) => ({ scene: x.scene })) },
    { enabled: renderableShots.length > 0 },
  )
  const predictedEngine =
    estimate.data?.engine ??
    (s.engine ? (s.engine.available || setup.data?.supported ? 'blender' : 'browser') : null)
  const browser = predictedEngine === 'browser'
  const perTake = canRender ? (estimate.data?.takes[0] ?? null) : null
  const view = viewing ? s.takes.find((t) => t.id === viewing && t.assetIds[0]) : null
  const pair = comparing
    ? (comparing.map((id) => s.takes.find((t) => t.id === id)).filter(Boolean) as RenderJob[])
    : null

  const renderShots = (shots: Shot[], engine?: 'browser') => {
    viewfinder.current?.commitPending()
    void s.render(
      shots.filter(({ scene }) => canRenderShot(scene)),
      { engine },
    )
  }
  const rerenderTake = (take: RenderJob) => {
    viewfinder.current?.commitPending()
    void s.rerender(take)
  }

  const previewImport = async () => {
    const catalog =
      s.shots.find(({ scene }) => scene.look === 'catalog-white') ??
      s.shots.find(({ scene }) => scene.camera.preset === 'hero') ??
      s.shots[0]
    if (!catalog || enablingImport) return
    setEnablingImport(true)
    try {
      const updated = await s.adjust(catalog, {
        look: 'catalog-white',
        includeUnassignedRhino: true,
      })
      if (updated) setSelectedKey(updated.key)
    } finally {
      setEnablingImport(false)
    }
  }

  const commands: Command[] = shot
    ? [
        {
          id: 'render.undo',
          title: 'Undo the last shot change',
          group: 'Piece',
          icon: Undo2,
          shortcut: 'mod+z',
          when: () => !!undo,
          run: () => undo && s.revert(shot, undo.id),
        },
        {
          id: 'render.redo',
          title: 'Redo the shot change',
          group: 'Piece',
          icon: Redo2,
          shortcut: 'mod+shift+z',
          when: () => !!redo,
          run: () => redo && s.revert(shot, redo.id),
        },
        {
          id: 'render.shot',
          title: `Render ${shot.title}`,
          group: 'Piece',
          icon: Play,
          shortcut: 'mod+enter',
          when: () => canRender,
          run: () => renderShots([shot]),
        },
        {
          id: 'render.browserPreview',
          title: 'Render browser preview',
          group: 'Piece',
          when: () => canRender && !browser,
          run: () => renderShots([shot], 'browser'),
        },
        {
          id: 'render.all',
          title: 'Render all shots',
          group: 'Piece',
          shortcut: 'mod+shift+enter',
          when: () => renderableShots.length > 0,
          run: () => renderShots(renderableShots),
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
    rerender: canRender ? rerenderTake : undefined,
    cancel: s.cancel,
    open: (t: RenderJob) => {
      setComparing(null)
      setViewing(t.id)
    },
    improve: (t: RenderJob) =>
      openAssistant({
        pieceId,
        draft: `Improve the "${t.title}" shot: look at its latest take and change the framing or light where it falls short.${canRender ? ' Render it again after the changes.' : ''}`,
      }),
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
                viewfinder.current?.commitPending()
                setSelectedKey(x.key)
                setViewing(null)
                setComparing(null)
              }}
            />
          ))}
          <Menu
            trigger={
              <Button size="sm" variant="ghost" icon={Plus} className="shrink-0 justify-start">
                Add shot
              </Button>
            }
            align="start"
            className="min-w-56"
          >
            {shot && (
              <MenuItem
                icon={Copy}
                onClick={() =>
                  void addShot(pieceId, s.piece!.kind, `${shot.title} copy`, shot.scene)
                    .then((row) => setSelectedKey(row.id))
                    .catch((e: Error) => toast.error('Couldn’t add the shot', e.message))
                }
              >
                Copy of {shot.title}
              </MenuItem>
            )}
            {shot && (
              <MenuItem
                icon={House}
                onClick={() =>
                  void saveHouseShot(shot.title, shot.scene)
                    .then((h) => toast.success(`Saved “${h.title}” as a house shot`))
                    .catch((e: Error) => toast.error('Couldn’t save the house shot', e.message))
                }
              >
                Save {shot.title} as a house shot
              </MenuItem>
            )}
            {!!houses.data?.length && (
              <>
                <MenuSeparator />
                <MenuGroup label="House shots">
                  {houses.data.map((h) => (
                    <MenuItem
                      key={h.id}
                      onClick={() =>
                        void addShot(pieceId, s.piece!.kind, h.title, h.scene)
                          .then((row) => setSelectedKey(row.id))
                          .catch((e: Error) => toast.error('Couldn’t add the shot', e.message))
                      }
                    >
                      {h.title}
                    </MenuItem>
                  ))}
                </MenuGroup>
              </>
            )}
          </Menu>
          {!s.shots.some((x) => x.saved) && (
            <p className="hidden px-2 pt-2 text-2xs text-fg-subtle @5xl:block">
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
              {engineLabel(s.engine, setup.data)}
            </button>
            <span className="flex items-center gap-0.5">
              <IconButton
                icon={Undo2}
                label="Undo the last shot change"
                shortcut="mod+z"
                size="sm"
                disabled={!undo}
                onClick={() => shot && undo && s.revert(shot, undo.id)}
              />
              <IconButton
                icon={Redo2}
                label="Redo"
                shortcut="mod+shift+z"
                size="sm"
                disabled={!redo}
                onClick={() => shot && redo && s.revert(shot, redo.id)}
              />
            </span>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
              {!browser && shot && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canRender}
                  onClick={() => renderShots([shot], 'browser')}
                >
                  Browser preview
                </Button>
              )}
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
                disabled={renderableShots.length === 0}
                onClick={() => renderShots(renderableShots)}
              >
                Render all
                {all.data && renderableShots.length > 0 && !browser && (
                  <span className="hidden font-mono text-2xs text-fg-subtle @lg:inline">
                    {machineTime(all.data.seconds)}
                  </span>
                )}
              </Button>
              <Button
                size="sm"
                // While a Render job waits for review, its Accept is the one ink action here.
                variant={jobInReview ? 'secondary' : 'primary'}
                icon={Camera}
                disabled={!shot || !canRender}
                onClick={() => shot && renderShots([shot])}
              >
                {browser ? 'Render preview' : 'Render'}
              </Button>
            </div>
          </div>

          {canRender && sourceMaterials.count > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 border-b border-line px-4 py-2 text-xs text-fg-muted">
              <span>
                {includesImport
                  ? sourceMaterials.count === 1
                    ? '1 unassigned body appears in neutral clay.'
                    : `${sourceMaterials.count} unassigned bodies appear in neutral clay.`
                  : sourceMaterials.count === 1
                    ? '1 unassigned body is excluded from this render.'
                    : `${sourceMaterials.count} unassigned bodies are excluded from this render.`}
              </span>
              {!readOnly && (
                <Link
                  to="/pieces/$id/design"
                  params={{ id: pieceId }}
                  search={{ review: 'rhino-roles' }}
                  className="font-medium text-fg underline underline-offset-2"
                >
                  Review materials
                </Link>
              )}
            </div>
          )}
          <div className="stage relative min-h-[360px] flex-1 overflow-hidden p-4 @5xl:min-h-0">
            {pair && pair.length === 2 ? (
              <Compare a={pair[0]!} b={pair[1]!} onClose={() => setComparing(null)} />
            ) : view ? (
              <figure className="absolute inset-4 flex flex-col items-center justify-center gap-2">
                <TakeMedia
                  take={view}
                  width={1600}
                  large
                  alt={`Take: ${takeLabel(view)}`}
                  className="min-h-0 max-w-full flex-1 object-contain shadow-[0_0_0_1px_var(--line)]"
                />
                <figcaption className="flex items-center gap-2 text-xs text-fg-muted">
                  {takeLabel(view)}
                  {view.engine === 'browser' && ' · Preview quality'}
                  {view.seconds ? ` · ${Math.round(view.seconds)} s` : ''}
                  {view.note && ` · ${view.note}`}
                  {view.sceneHash && (
                    <span className="font-mono text-2xs text-fg-subtle">
                      · scene {view.sceneHash.slice(0, 8)}
                    </span>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => actions.improve(view)}>
                    <AiMark className="size-3" /> Improve with AI…
                  </Button>
                  <Button size="sm" variant="ghost" icon={X} onClick={() => setViewing(null)}>
                    Live view
                  </Button>
                </figcaption>
              </figure>
            ) : emptyView ? (
              <EmptyState
                className="stage cad-studio-backdrop absolute inset-4 justify-center rounded-lg [--fg:var(--cad-ink)] [--fg-muted:var(--cad-ink)]"
                title={
                  baseAvailability === 'review-roles'
                    ? 'Preview your imported CAD'
                    : baseAvailability === 'sheets'
                      ? 'Give the surface a thickness'
                      : 'No geometry to render'
                }
                description={
                  baseAvailability === 'review-roles' ? (
                    <>
                      See unassigned bodies in neutral clay with studio lighting.
                      {sourceMaterials.labels && (
                        <span className="mt-2 block break-words">
                          <span className="block font-medium">Source labels by body count</span>
                          <span className="block">{sourceMaterials.labels}</span>
                        </span>
                      )}
                      {!readOnly && (
                        <Link
                          to="/pieces/$id/design"
                          params={{ id: pieceId }}
                          search={{ review: 'rhino-roles' }}
                          className="mt-2 block font-medium underline underline-offset-2"
                        >
                          Review materials
                        </Link>
                      )}
                    </>
                  ) : baseAvailability === 'sheets' ? (
                    'In CAD, select the sheet and choose Add feature → Thicken surface to make a renderable solid.'
                  ) : baseAvailability === 'references' ? (
                    'The imported reference bodies are available in CAD. Renders use the piece’s metal and stones.'
                  ) : (
                    'The viewfinder shows metal and stones from the design.'
                  )
                }
                action={
                  baseAvailability === 'review-roles' && !readOnly ? (
                    <Button
                      variant="primary"
                      className="[--ink:var(--cad-ink)] [--ink-fg:var(--cad-paper)]"
                      disabled={enablingImport}
                      onClick={() => void previewImport()}
                    >
                      Preview imported CAD
                    </Button>
                  ) : baseAvailability === 'sheets' ? (
                    <Link
                      to="/pieces/$id/design"
                      params={{ id: pieceId }}
                      className={buttonClass({ variant: 'secondary' })}
                    >
                      Open CAD
                    </Link>
                  ) : undefined
                }
              />
            ) : baseAvailability === 'failed' && !hasPreview ? (
              <EmptyState
                className="absolute inset-4 justify-center"
                title="Couldn’t prepare the viewfinder"
                action={
                  geometry.status === 'error' ? (
                    <Button onClick={geometry.retry}>Retry</Button>
                  ) : undefined
                }
              />
            ) : shot ? (
              <Viewfinder
                ref={viewfinder}
                evaluation={hasPreview ? render : null}
                scene={shot.scene}
                design={{ pieceId, version: s.piece.version }}
                label={`Live preview of the ${shot.title} shot`}
                className="absolute inset-4"
                onHash={onHash}
                onCommit={(patch) => void s.adjust(shot, patch)}
                onLock={(locked) =>
                  void s.adjust(shot, { camera: { locked: locked ? true : null } })
                }
                onReset={() => void s.adjust(shot, resetCameraPatch(shot.scene.camera))}
              />
            ) : null}
            {/* An animated shot's scrubber sits where this caption would. */}
            {!view &&
              !pair &&
              shot &&
              !shot.scene.animation &&
              !emptyView &&
              baseAvailability !== 'failed' && (
                <span className="glass absolute bottom-3 left-3 rounded-md px-2 py-1 text-2xs whitespace-nowrap text-fg-muted">
                  Viewfinder ·{' '}
                  {browser ? 'takes draw in the browser' : 'takes render exactly this in Blender'}
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
                  !canRender
                    ? 'Finished takes appear here.'
                    : browser
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
                      isCover={!!takeMedia(t).still && s.piece!.coverAssetId === takeMedia(t).still}
                      selected={viewing === t.id}
                      actions={actions}
                      liveHash={canRender ? liveHash : null}
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
                        isCover={
                          !!takeMedia(t).still && s.piece!.coverAssetId === takeMedia(t).still
                        }
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
              showImportPreview={
                !!includesImport || (baseAvailability === 'ready' && sourceMaterials.count > 0)
              }
              importPreviewDisabled={readOnly}
              engine={predictedEngine}
              estimate={
                canRender && estimate.data
                  ? { seconds: perTake ?? 0, basis: estimate.data.basis }
                  : null
              }
              onChange={(patch) => {
                viewfinder.current?.commitPending()
                void s.adjust(shot, patch)
              }}
            />
          )}
        </aside>
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
          <img
            src={assetUrl(takeMedia(pick).still ?? pick.assetIds[0]!, 96)}
            alt=""
            className="size-full object-cover"
          />
        )}
        {live && (
          <span className="absolute right-0.5 bottom-0.5 size-2 animate-pulse rounded-full bg-select motion-reduce:animate-none" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{shot.title}</span>
        <span className="block truncate text-2xs text-fg-subtle">
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
