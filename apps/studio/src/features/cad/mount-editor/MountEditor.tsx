import { mountFitToGemMatrix } from '@pave/kernel/client'
import {
  type CommandInput,
  type CommandOutput,
  customMountFitForStone,
  customMountPartIssue,
  customMountStoneIssue,
  type Design,
  isImportReference,
  METAL_IDS,
  METALS,
  type MetalId,
  type MountCage,
  mountCageForPart,
  mountCageIsAffine,
  mountCageIsSafe,
  newId,
  nodeTitle,
  sameJson,
  stoneDims,
} from '@pave/schema'
import { Button, Dialog, Input, Select, Spinner } from '@pave/ui'
import { RotateCcw, Undo2 } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { hasGap } from '../../../lib/design-session/core'
import {
  type DesignSession,
  type SessionStore,
  useSessionState,
} from '../../../lib/design-session/store'
import { num } from '../../../lib/format'
import { RpcError, rpc } from '../../../lib/rpc'
import { isImportedMesh, type XYZ } from '../mesh-edit/model'
import {
  type CageHandle,
  cornerIds,
  cornerName,
  faceNames,
  handleOffsets,
  moveHandles,
  zeroOffsets,
} from './handles'
import { MountPreview } from './MountPreview'
import type { PreviewCages, PreviewGirdle, PreviewPart } from './preview-model'

type Inspection = CommandOutput<'design.inspectMount'>
type Edit = CommandInput<'design.editMount'> & { changeId: string }
type Draft = Pick<Edit, 'cage' | 'fitGemId' | 'material'> & { mode?: CageMode }
type CageMode = NonNullable<MountCage['mode']>
const AXES = ['X', 'Y', 'Z'] as const
const ZERO: [string, string, string] = ['', '', '']
const ALL: CageHandle = { kind: 'all' }
const KEEP = 'keep'
const UNLINKED = 'unlinked'
const alloyOptions = METAL_IDS.map((metal) => ({ value: metal, label: METALS[metal].label }))
const modeOptions = [
  { value: 'byPart', label: 'Keep each part’s surfaces' },
  { value: 'freeform', label: 'Bend across parts' },
] satisfies { value: CageMode; label: string }[]
const handleOptions = [
  { label: '', options: [{ value: 'all', label: 'All corners' }] },
  { label: 'Faces', options: faceNames.map((label, i) => ({ label, value: `face/${i}` })) },
  {
    label: 'Corners',
    options: cornerIds.map((i) => ({ label: cornerName(i), value: `corner/${i}` })),
  },
]
const versionOf = (s: SessionStore) => s.version
export const mountSessionBusy = (s: SessionStore) => s.save.status !== 'saved' || hasGap(s)
const staleNotice = 'The design changed. Reopen Edit handmade mount to see the latest parts.'
const labelDimensions = ({
  width,
  length,
  depth,
}: {
  width: number
  length: number
  depth: number
}) => `${[width, length, depth].map((size) => num(size, 3)).join(' × ')} mm`
const hasOffset = (v: XYZ) => v.some((offset) => offset !== 0)
const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

function handleValue(handle: CageHandle): string {
  return handle.kind === 'all' ? 'all' : `${handle.kind}/${handle.index}`
}

function parseHandle(value: string): CageHandle {
  if (value === 'all') return ALL
  const [kind, index] = value.split('/')
  return { kind: kind === 'corner' ? 'corner' : 'face', index: Number(index) }
}

function useInspection(pieceId: string, ids: string[], session: DesignSession) {
  const [result, setResult] = useState<{ ids: string[]; value: Inspection | { error: string } }>()
  useEffect(() => {
    let active = true
    void rpc.call('design.inspectMount', { pieceId, nodeIds: ids }).then(
      (read) => {
        if (!active) return
        setResult({ ids, value: read })
        if (read.version > session.get().version) void session.resync()
      },
      (error) => {
        if (active)
          setResult({
            ids,
            value: { error: errorText(error, 'Unable to inspect the selected bodies.') },
          })
      },
    )
    return () => {
      active = false
    }
  }, [ids, pieceId, session])
  return result?.ids === ids ? result.value : undefined
}

export function MountEditor({
  pieceId,
  design,
  initialIds,
  baseVersion,
  session,
  isCurrent,
  onClose,
}: {
  pieceId: string
  design: Design
  initialIds: string[]
  baseVersion: number
  session: DesignSession
  isCurrent(): boolean
  onClose(): void
}) {
  const parts = useMemo(
    () => design.order.filter((id) => !customMountPartIssue(design, id)),
    [design],
  )
  const stones = useMemo(
    () =>
      design.order.flatMap((id) => {
        const node = design.nodes[id]
        return node?.kind === 'gem' && !customMountStoneIssue(design, id) ? [node] : []
      }),
    [design],
  )
  const [ids, setIds] = useState(initialIds)
  const inputId = useId()
  const result = useInspection(pieceId, ids, session)
  const read = result && 'bounds' in result ? result : null
  const readError = result && 'error' in result ? result.error : null
  const previewParts = useMemo(
    () =>
      read?.parts.flatMap(({ nodeId, assetId }): PreviewPart[] => {
        const node = design.nodes[nodeId]
        return isImportedMesh(node)
          ? [{ nodeId, assetId, transform: node.transform, edits: node.meshEdits?.vertices }]
          : []
      }) ?? [],
    [design, read],
  )
  const nodes = useMemo(
    () =>
      ids.flatMap((id) => {
        const node = design.nodes[id]
        return isImportedMesh(node) ? [node] : []
      }),
    [ids, design],
  )
  const [history, setHistory] = useState<Draft[]>([])
  const [handle, setHandle] = useState<CageHandle>(ALL)
  const [entered, setEntered] = useState(ZERO)
  const [dragging, setDragging] = useState<XYZ | null>(null)
  const [replace, setReplace] = useState(false)
  const [fitted, setFitted] = useState(false)
  const [error, setError] = useState<string>()
  const [conflict, setConflict] = useState(false)
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState<Edit>()
  const active = useRef(false)
  const version = useSessionState(session, versionOf)
  const waiting = useSessionState(session, mountSessionBusy)
  const stale =
    conflict || version !== baseVersion || (read !== null && read.version !== baseVersion)
  const frozen = saving || !!retry || stale
  const draft = history.at(-1)
  const edited = draft ?? {}
  const mode = edited.mode
  const typed = entered.map(Number) as XYZ
  const parsing = typed.every(Number.isFinite)
  const pendingNumbers = !parsing || hasOffset(typed)
  const currentCage = nodes[0]?.mountCage
  const mixedCages = nodes.some((node) => !sameJson(node.mountCage, currentCage))
  const sharedCage = mixedCages ? undefined : currentCage
  const base = useMemo(
    () =>
      read && (sharedCage ?? { ...read.bounds, offsets: zeroOffsets(), mode: 'byPart' as const }),
    [read, sharedCage],
  )
  const emptyCage = useMemo(
    () => read && { ...read.bounds, offsets: zeroOffsets(), mode: 'byPart' as const },
    [read],
  )
  const storedMode = edited.cage
    ? (edited.cage.mode ?? 'freeform')
    : edited.cage === null
      ? 'byPart'
      : (base?.mode ?? (sharedCage ? 'freeform' : 'byPart'))
  const currentMode = mode ?? storedMode
  const activeCage = edited.cage ?? (edited.cage === null ? emptyCage : base)
  const offset = dragging ?? (parsing && pendingNumbers ? typed : null)
  const proposed = useMemo((): MountCage | undefined => {
    if (!activeCage || (!offset && (!mode || !activeCage.offsets.some(hasOffset)))) return undefined
    const next =
      offset && hasOffset(offset)
        ? moveHandles(activeCage.offsets, handle, offset)
        : activeCage.offsets
    return { ...activeCage, mode: currentMode, offsets: next }
  }, [activeCage, offset, handle, mode, currentMode])
  const proposedCage = proposed ?? edited.cage
  const cage = proposedCage && !proposedCage.offsets.some(hasOffset) ? null : proposedCage
  const shownCage = proposedCage ?? activeCage
  const shownOffsets = shownCage && handleOffsets(shownCage.offsets, handle)
  const cageProblem = cage && !mountCageIsSafe(cage)
  const changingCage =
    cage === null
      ? nodes.some((node) => node.mountCage)
      : cage !== undefined && nodes.some((node) => !sameJson(node.mountCage, cage))
  const replacing = !!(changingCage && cage && mixedCages)
  const materialNeeded = nodes.some(isImportReference)
  const alloyLabel = materialNeeded ? 'Choose an alloy' : 'Keep current alloys'

  const fitIds = nodes.map((node) =>
    edited.fitGemId === undefined ? node.mountFit?.gem : (edited.fitGemId ?? undefined),
  )
  const firstLink = fitIds[0]
  const splitLinks = fitIds.some((id) => id !== firstLink)
  const linkedGem = splitLinks ? undefined : stones.find((gem) => gem.id === firstLink)
  const bind = linkedGem && customMountFitForStone(design, linkedGem.id)
  const dimensions = linkedGem && stoneDims(linkedGem)
  const sourceGirdle: PreviewGirdle | undefined = bind && {
    frame: { ...bind.frame, scale: 1 },
    width: bind.base.width,
    length: bind.base.length,
  }
  const fittedGirdle: PreviewGirdle | undefined = linkedGem &&
    dimensions && {
      frame: linkedGem.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
      width: dimensions.width,
      length: dimensions.length,
    }
  const matrices = useMemo(() => {
    const result = new Map<string, readonly number[]>()
    for (const node of nodes) {
      const gemId = edited.fitGemId === undefined ? node.mountFit?.gem : edited.fitGemId
      const gem = stones.find((part) => part.id === gemId)
      if (gem) {
        const fit =
          edited.fitGemId === undefined && node.mountFit
            ? node.mountFit
            : customMountFitForStone(design, gem.id)
        result.set(node.id, mountFitToGemMatrix(fit, gem))
      }
    }
    return result
  }, [nodes, edited.fitGemId, design, stones])
  const memberCages = useMemo<PreviewCages>(
    () =>
      new Map(
        read?.parts.map(({ nodeId, bounds }) => {
          const node = design.nodes[nodeId]
          const next = cage === undefined && node?.kind === 'meshBody' ? node.mountCage : cage
          const center = bounds.min.map((start, k) => start + (bounds.max[k]! - start) / 2) as XYZ
          return [nodeId, next ? mountCageForPart(next, center) : next]
        }),
      ),
    [read, design, cage],
  )
  const nativeCount =
    read?.parts.filter(({ native, nodeId }) => {
      const shape = memberCages.get(nodeId)
      return native && (!shape || mountCageIsAffine(shape))
    }).length ?? 0
  const linkedChanged =
    edited.fitGemId !== undefined &&
    nodes.some((node) => (node.mountFit?.gem ?? null) !== edited.fitGemId)
  const alloyChanged =
    !!edited.material &&
    nodes.some((node) => node.material !== edited.material || isImportReference(node))
  const restoreAvailable =
    nodes.some((node) => node.mountCage || node.mountFit) || !!edited.cage || !!edited.fitGemId
  const clearAvailable = cage !== null && (nodes.some((node) => node.mountCage) || !!cage)
  const canApply =
    !!read &&
    !waiting &&
    !frozen &&
    !dragging &&
    !cageProblem &&
    parsing &&
    (!replacing || replace) &&
    (!materialNeeded || !!edited.material) &&
    (changingCage || linkedChanged || alloyChanged)
  const status =
    error ??
    (stale && !retry && !saving ? staleNotice : readError) ??
    (!parsing
      ? 'Enter finite millimetre offsets.'
      : cageProblem
        ? 'These moves would fold or collapse the cage. Reduce the displacement.'
        : null)
  const isDirty = !!draft || pendingNumbers || !!dragging || !!mode

  const locked = isDirty || saving || !!retry

  function change(next: Draft) {
    setHistory((prior) => [...prior.slice(-49), next])
    setError(undefined)
  }

  function commitNumbers() {
    if (!pendingNumbers || !parsing || cageProblem || frozen || !proposed) return
    change({ ...edited, cage: proposed, mode: undefined })
    setEntered(ZERO)
  }

  function undoDraft() {
    if (dragging || frozen) return
    if (pendingNumbers) setEntered(ZERO)
    else setHistory((previous) => previous.slice(0, -1))
    setError(undefined)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key.toLowerCase() !== 'z' || !(event.metaKey || event.ctrlKey)) return
    event.stopPropagation()
    if (event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') return
    event.preventDefault()
    if (!event.shiftKey) undoDraft()
  }

  function reset() {
    setHistory([])
    setEntered(ZERO)
    setDragging(null)
    setReplace(false)
    setError(undefined)
  }

  async function save() {
    if (active.current || !isCurrent()) return
    if (!retry) {
      const state = session.get()
      if (
        !read ||
        read.version !== baseVersion ||
        state.version !== baseVersion ||
        state.pieceId !== pieceId ||
        stale
      ) {
        setConflict(true)
        return
      }
      if (!canApply || mountSessionBusy(state)) return
    }
    const payload: Edit = retry ?? {
      pieceId,
      nodeIds: ids,
      baseVersion: read!.version,
      changeId: newId('chg'),
      ...(changingCage && { cage }),
      ...(linkedChanged && { fitGemId: edited.fitGemId }),
      ...(alloyChanged && { material: edited.material }),
    }
    active.current = true
    setSaving(true)
    setError(undefined)
    try {
      const answer = await rpc.call('design.editMount', payload)
      if (
        answer?.change?.id !== payload.changeId ||
        answer.change.pieceId !== pieceId ||
        answer.change.actor.type !== 'user'
      )
        throw new RpcError('invalid_response', 'The save could not be confirmed.', 0)
      session.adoptChange(payload.changeId, answer.change)
      if (isCurrent()) onClose()
    } catch (reason) {
      const code = reason instanceof RpcError ? reason.status : 0
      if (code === 0 || code === 408 || code === 429 || code >= 500) {
        setRetry(payload)
        setError('The save could not be confirmed. Retry to check the same edit.')
        void session.resync()
      } else {
        setRetry(undefined)
        if (code === 409) {
          setConflict(true)
          void session.resync()
        } else setError(errorText(reason, 'Unable to save the mount edit.'))
      }
    } finally {
      active.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !active.current) onClose()
      }}
      title="Edit handmade mount"
      description="Move the shared cage or link the selected bodies to a confirmed imported stone."
      className="top-[max(12px,5dvh)] max-h-[calc(100dvh-2*max(12px,5dvh))] w-[min(1040px,calc(100vw-24px))]"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {retry ? 'Close' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            disabled={saving || (!retry && !canApply)}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : retry ? 'Retry save' : 'Save mount edit'}
          </Button>
        </>
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: catch CAD undo from any editor control before it reaches the workspace */}
      <div
        className="grid gap-x-5 gap-y-3 md:grid-cols-[minmax(0,1.65fr)_minmax(290px,1fr)]"
        onKeyDown={onKeyDown}
      >
        <div className="min-w-0">
          <fieldset disabled={locked || frozen} className="mb-4 min-w-0 border-b border-line pb-3">
            <legend className="text-sm font-medium">
              Mount bodies{' '}
              <span className="ml-1 text-xs font-normal text-fg-muted">{ids.length} selected</span>
            </legend>
            <div className="mt-1 grid max-h-28 gap-1.5 overflow-auto py-1 sm:grid-cols-2">
              {parts.map((id) => (
                <label key={id} className="flex min-w-0 items-start gap-2 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={ids.includes(id)}
                    disabled={ids.length === 1 && ids[0] === id}
                    onChange={() => {
                      if (!locked) {
                        setIds((current) =>
                          current.includes(id)
                            ? current.filter((item) => item !== id)
                            : [...current, id],
                        )
                        setFitted(false)
                        setHandle(ALL)
                        setError(undefined)
                      }
                    }}
                    className="mt-0.5 accent-select"
                  />
                  <span className="truncate" title={nodeTitle(design.nodes[id]!)}>
                    {nodeTitle(design.nodes[id]!)}
                  </span>
                </label>
              ))}
            </div>
            {locked && !frozen && (
              <p className="mt-1 text-xs text-fg-muted">
                Reset this draft to change which bodies share the cage.
              </p>
            )}
          </fieldset>
          {!result && (
            <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
              <Spinner /> Measuring the selected bodies…
            </p>
          )}
          {read && shownCage && (
            <MountPreview
              parts={previewParts}
              bounds={read.bounds}
              frame={{
                cage: shownCage,
                cages: memberCages,
                selected: handle,
                interactive: !frozen && !pendingNumbers,
                stone: fitted && matrices.size ? fittedGirdle : sourceGirdle,
                fitted: fitted && matrices.size ? matrices : undefined,
              }}
              events={{
                onPick: (next) => setHandle(next),
                onMove: (_, delta) => setDragging(delta),
                onRelease: (target, delta) => {
                  setDragging(null)
                  if (frozen || !activeCage || !delta || !hasOffset(delta)) return
                  change({
                    ...edited,
                    mode: undefined,
                    cage: {
                      ...activeCage,
                      mode: currentMode,
                      offsets: moveHandles(activeCage.offsets, target, delta),
                    },
                  })
                },
              }}
              showFitButton={matrices.size > 0}
              onToggleFit={() => setFitted((show) => !show)}
            />
          )}
        </div>
        {read && shownCage && (
          <div className="flex min-w-0 flex-col gap-4">
            <fieldset disabled={frozen} className="grid min-w-0 gap-2 border-b border-line pb-4">
              <legend className="mb-1 text-sm font-medium">Cage controls</legend>
              <Select
                aria-label="Deformation mode"
                options={modeOptions}
                value={currentMode}
                disabled={frozen || !!dragging}
                onChange={(value) => {
                  setFitted(false)
                  change({ ...edited, mode: value === storedMode ? undefined : value })
                }}
              />
              <p className="text-xs text-fg-muted">
                {currentMode === 'byPart'
                  ? 'Each part moves, stretches or shears as a solid. Joined edges may separate.'
                  : 'The entire mount bends together. A nonlinear bend exports as mesh.'}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
                <span className="text-fg-muted">Source cage</span>
                <span className="font-mono tabular">
                  {shownCage.max.map((mx, i) => num(mx - shownCage.min[i]!, 3)).join(' × ')} mm
                </span>
              </div>
              <Select
                aria-label="Cage handles"
                options={handleOptions}
                value={handleValue(handle)}
                disabled={frozen || pendingNumbers || !!dragging}
                onChange={(value) => {
                  setHandle(parseHandle(value))
                  setFitted(false)
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
                <span className="text-fg-muted">
                  {mixedCages && cage === undefined ? 'New cage offsets' : 'Selected offsets'}
                </span>
                <span className="font-mono tabular">
                  {shownOffsets
                    ?.map((value, axis) =>
                      value === null ? `${AXES[axis]} mixed` : `${AXES[axis]} ${num(value, 3)} mm`,
                    )
                    .join(' · ')}
                </span>
              </div>
              <fieldset className="grid grid-cols-3 gap-2" aria-label="Handle move in millimetres">
                {AXES.map((axis, i) => (
                  <label
                    key={axis}
                    htmlFor={`${inputId}-${axis}`}
                    className="grid min-w-0 gap-1 text-2xs text-fg-muted"
                  >
                    <span>{axis} move</span>
                    <Input
                      id={`${inputId}-${axis}`}
                      aria-label={`${axis} move (mm)`}
                      inputMode="text"
                      placeholder="0 mm"
                      value={entered[i]}
                      disabled={!!dragging}
                      onChange={(event) => {
                        const values: typeof ZERO = [...entered]
                        values[i] = event.currentTarget.value
                        setEntered(values)
                        setFitted(false)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitNumbers()
                        } else if (event.key === 'Escape' && pendingNumbers) {
                          event.preventDefault()
                          event.stopPropagation()
                          setEntered(ZERO)
                        }
                      }}
                      className="h-8 px-2 font-mono"
                    />
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  disabled={!pendingNumbers || !parsing || !!cageProblem || frozen}
                  onClick={commitNumbers}
                >
                  Move handles
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Undo2}
                  disabled={!isDirty || !!dragging || frozen}
                  onClick={undoDraft}
                >
                  Undo draft
                </Button>
              </div>
              {replacing && (
                <label className="mt-1 flex items-start gap-2 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-select"
                    checked={replace}
                    onChange={(event) => setReplace(event.currentTarget.checked)}
                  />
                  Replace the selected bodies’ existing cages with this shared cage
                </label>
              )}
              <div className="grid gap-1 rounded-md bg-bg-sunken px-2.5 py-2 text-xs text-fg-muted">
                {nativeCount > 0 && (
                  <p>
                    {nativeCount} {nativeCount === 1 ? 'body keeps' : 'bodies keep'} native Rhino
                    surfaces.
                  </p>
                )}
                {read.parts.length > nativeCount && (
                  <p>
                    {read.parts.length - nativeCount}{' '}
                    {read.parts.length - nativeCount === 1 ? 'body exports' : 'bodies export'} as
                    mesh.
                  </p>
                )}
                <p>Original geometry is retained.</p>
              </div>
            </fieldset>
            <fieldset disabled={frozen} className="grid min-w-0 gap-2">
              <legend className="mb-1 text-sm font-medium">Stone fit and alloy</legend>
              <Select
                aria-label="Linked imported stone"
                options={[
                  ...(splitLinks ? [{ value: KEEP, label: 'Keep existing stone links' }] : []),
                  { value: UNLINKED, label: 'No stone link' },
                  ...stones.map((stone) => ({ value: stone.id, label: nodeTitle(stone) })),
                ]}
                value={splitLinks ? KEEP : (firstLink ?? UNLINKED)}
                disabled={frozen || (!stones.length && !firstLink && !splitLinks)}
                onChange={(value) => {
                  setFitted(false)
                  change({
                    ...edited,
                    fitGemId: value === KEEP ? undefined : value === UNLINKED ? null : value,
                  })
                }}
              />
              {linkedGem && bind && dimensions && (
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                  <dt>Imported stone</dt>
                  <dd className="text-right font-mono tabular">{labelDimensions(bind.base)}</dd>
                  <dt>
                    {linkedGem.sourcing?.measured ? 'Supplier dimensions' : 'Current dimensions'}
                  </dt>
                  <dd className="text-right font-mono tabular">{labelDimensions(dimensions)}</dd>
                </dl>
              )}
              {!stones.length && (
                <p className="text-xs text-fg-muted">
                  Confirm an imported stone in this project to link it here.
                </p>
              )}
              <Select<MetalId | typeof KEEP>
                aria-label="Mount alloy"
                options={[{ value: KEEP, label: alloyLabel }, ...alloyOptions]}
                value={edited.material ?? KEEP}
                onChange={(value) =>
                  change({ ...edited, material: value === KEEP ? undefined : value })
                }
                disabled={frozen}
              />
              {materialNeeded && !edited.material && (
                <p className="text-xs text-fg-muted">
                  Choose the casting alloy for the unassigned or reference bodies.
                </p>
              )}
            </fieldset>
            <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={!clearAvailable || !!dragging || frozen}
                onClick={() => {
                  change({ ...edited, cage: null, mode: undefined })
                  setEntered(ZERO)
                }}
              >
                Clear cages
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!restoreAvailable || !!dragging || frozen}
                onClick={() => {
                  change({ ...edited, cage: null, fitGemId: null, mode: undefined })
                  setEntered(ZERO)
                  setFitted(false)
                }}
              >
                Restore original
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={RotateCcw}
                disabled={!isDirty || !!dragging || frozen}
                onClick={reset}
              >
                Reset draft
              </Button>
            </div>
          </div>
        )}
        {waiting && !stale && !saving && !retry && (
          <p role="status" className="text-xs text-fg-muted md:col-span-2">
            Waiting for the design to finish saving…
          </p>
        )}
        {status && (
          <p role="alert" className="text-sm text-danger md:col-span-2">
            {status}
          </p>
        )}
      </div>
    </Dialog>
  )
}
