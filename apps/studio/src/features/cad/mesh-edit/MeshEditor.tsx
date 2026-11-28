import { MeshVertexEdits, nodeTitle } from '@pave/schema'
import { Button, Dialog, Input, Spinner } from '@pave/ui'
import { type ComponentProps, useEffect, useId, useRef, useState } from 'react'
import { assetUrl } from '../../../lib/assets'
import {
  type ComponentKind,
  type ImportedMesh,
  type MeshComponent,
  type MeshReply,
  type MeshRequest,
  type VertexPositions,
  type ViewportMesh,
  vertexAt,
  type XYZ,
} from './model'
import { createMeshViewport, type ViewName, views } from './viewport'

const ZERO = ['0', '0', '0']
const AXES = ['X', 'Y', 'Z'] as const
const kinds: ComponentKind[] = ['Vertex', 'Edge', 'Face']
const viewNames = Object.keys(views) as ViewName[]
const sizeLabel = (n: number) => Number(n.toPrecision(8)).toString()

function componentLabel(component: MeshComponent): string {
  if (component.kind === 'Vertex') return `Vertex ${component.ids[0]}`
  if (component.kind === 'Edge') return `Edge · vertices ${component.ids.join(', ')}`
  return `Face ${component.face} · vertices ${component.ids.join(', ')}`
}

function useMesh(node: ImportedMesh) {
  const [result, setResult] = useState<MeshReply>()
  const { assetId } = node.source
  const edits = node.meshEdits?.vertices
  useEffect(() => {
    const controller = new AbortController()
    let worker: Worker | undefined
    const load = async () => {
      const response = await fetch(assetUrl(assetId), { signal: controller.signal })
      if (!response.ok) throw new Error(`The stored mesh could not load (${response.status}).`)
      const bytes = await response.arrayBuffer()
      if (controller.signal.aborted) return
      worker = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = ({ data }: MessageEvent<MeshReply>) => {
        setResult(data)
        worker?.terminate()
      }
      worker.onerror = () => {
        setResult({ error: 'The mesh editor could not load this part.' })
        worker?.terminate()
      }
      worker.postMessage({ bytes, edits } satisfies MeshRequest, [bytes])
    }
    void load().catch((error: unknown) => {
      if (!controller.signal.aborted)
        setResult({ error: error instanceof Error ? error.message : String(error) })
    })
    return () => {
      controller.abort()
      worker?.terminate()
    }
  }, [assetId, edits])
  return result
}

interface MeshViewportProps {
  mesh: ViewportMesh
  view: { name: ViewName }
  kind: ComponentKind
  selected: MeshComponent | null
  preview: VertexPositions
  canPick: boolean
  onPick(component: MeshComponent | null): void
}

function MeshViewport({ mesh, view, kind, selected, preview, canPick, onPick }: MeshViewportProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewport = useRef<ReturnType<typeof createMeshViewport> | null>(null)
  const [failure, setFailure] = useState(false)
  const pick = useRef(onPick)
  useEffect(() => {
    pick.current = onPick
  }, [onPick])

  useEffect(() => {
    const target = canvas.current
    if (!target) return
    let scene: ReturnType<typeof createMeshViewport>
    try {
      scene = createMeshViewport(target, mesh, (component) => pick.current(component))
      viewport.current = scene
    } catch {
      setFailure(true)
      return
    }
    const lost = () => setFailure(true)
    target.addEventListener('webglcontextlost', lost)
    return () => {
      target.removeEventListener('webglcontextlost', lost)
      scene.dispose()
      viewport.current = null
    }
  }, [mesh])

  useEffect(() => viewport.current?.setView(view.name), [view])
  useEffect(
    () => viewport.current?.show({ kind, selected, preview, canPick }),
    [kind, selected, preview, canPick],
  )

  return failure ? (
    <p role="status" className="rounded-md border border-line p-4 text-sm text-fg-muted">
      The mesh preview is unavailable. You can still select a vertex by ID.
    </p>
  ) : (
    <canvas
      ref={canvas}
      role="img"
      aria-label="Mesh component viewport"
      className={`block h-[clamp(210px,41dvh,440px)] w-full touch-none rounded-md bg-[#252a32] ${canPick ? 'cursor-crosshair' : 'cursor-grab'}`}
    />
  )
}

export function MeshEditor({
  node,
  stale,
  finalFocus,
  onClose,
  onSave,
}: {
  node: ImportedMesh
  stale: boolean
  finalFocus?: ComponentProps<typeof Dialog>['finalFocus']
  onClose(): void
  onSave(positions: VertexPositions, component: ComponentKind): void
}) {
  const inputId = useId()
  const result = useMesh(node)
  const mesh = result && 'mesh' in result ? result.mesh : null
  const [view, setView] = useState<{ name: ViewName }>({ name: 'Perspective' })
  const [kind, setKind] = useState<ComponentKind>('Vertex')
  const [selected, setSelected] = useState<MeshComponent | null>(null)
  const [vertex, setVertex] = useState('')
  const [offsets, setOffsets] = useState<string[]>(ZERO)
  const [error, setError] = useState<string | null>(null)

  const select = (component: MeshComponent | null) => {
    setSelected(component)
    setOffsets(ZERO)
    setError(null)
    setVertex(component?.kind === 'Vertex' ? String(component.ids[0]) : '')
  }
  const entered = offsets.map(Number)
  const hasOffset = entered.some((offset) => offset !== 0)
  const moved: VertexPositions = {}
  if (mesh && selected && hasOffset && entered.every(Number.isFinite)) {
    for (const id of selected.ids) {
      const start = vertexAt(mesh.positions, id)
      const end = start.map((mm, axis) => Math.fround(mm + entered[axis]!)) as XYZ
      if (end.some((mm, axis) => mm !== start[axis])) moved[id] = end
    }
  }
  const checked = MeshVertexEdits.safeParse(moved)
  const visual = checked.success ? checked.data : {}
  const canSave = !stale && checked.success && Object.keys(visual).length > 0
  const maxId = mesh ? mesh.positions.length / 3 - 1 : 0
  const vertexId = /^\d+$/.test(vertex.trim()) ? Number(vertex) : -1
  const canSelectId = mesh && Number.isSafeInteger(vertexId) && vertexId >= 0 && vertexId <= maxId
  const selectId = () => {
    if (!canSelectId || stale || hasOffset) return
    select({ kind: 'Vertex', ids: [vertexId] })
  }
  const location =
    mesh && selected?.kind === 'Vertex'
      ? (visual[selected.ids[0]] ?? vertexAt(mesh.positions, selected.ids[0]))
      : null
  const loadError = result && 'error' in result ? result.error : null
  let message = loadError ?? error
  if (stale)
    message =
      'The design changed while this editor was open. Close it and reopen to edit the saved mesh.'
  else if (hasOffset && !checked.success)
    message = 'Enter a displacement within the supported mesh coordinates.'
  else if (hasOffset && !canSave)
    message = 'The displacement is smaller than this mesh’s coordinate precision.'
  return (
    <Dialog
      open
      finalFocus={finalFocus}
      onOpenChange={(open) => !open && onClose()}
      title="Edit mesh"
      description={nodeTitle(node)}
      className="top-[max(12px,7dvh)] max-h-[calc(100dvh-2*max(12px,7dvh))] w-[min(960px,calc(100vw-24px))]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={() => {
              if (!selected || !canSave) return
              try {
                onSave(visual, selected.kind)
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            }}
          >
            Save mesh edit
          </Button>
        </>
      }
    >
      {!result && (
        <p role="status" className="flex items-center gap-2 py-5 text-sm text-fg-muted">
          <Spinner /> Loading mesh…
        </p>
      )}
      {mesh && (
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
          <div className="min-w-0 space-y-2">
            <fieldset aria-label="Mesh view" className="flex flex-wrap gap-1">
              {viewNames.map((name) => (
                <Button
                  key={name}
                  size="sm"
                  variant={view.name === name ? 'secondary' : 'ghost'}
                  aria-pressed={view.name === name}
                  onClick={() => setView({ name })}
                  className="px-2 text-xs"
                >
                  {name}
                </Button>
              ))}
            </fieldset>
            <MeshViewport
              mesh={mesh}
              view={view}
              kind={kind}
              selected={selected}
              preview={visual}
              canPick={!stale && !hasOffset}
              onPick={select}
            />
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-fg-muted">
              <p>
                {view.name === 'Perspective' ? 'Drag to orbit' : 'Drag to pan'}. Scroll or pinch to
                zoom.
              </p>
              <p className="font-mono tabular">{mesh.size.map(sizeLabel).join(' × ')} mm</p>
            </div>
          </div>
          <div className="min-w-0 space-y-3">
            <fieldset aria-label="Component type" className="grid grid-cols-3 gap-1">
              {kinds.map((mode) => (
                <Button
                  key={mode}
                  size="sm"
                  variant={mode === kind ? 'primary' : 'secondary'}
                  aria-pressed={mode === kind}
                  disabled={stale || hasOffset}
                  onClick={() => {
                    if (kind === mode) return
                    select(null)
                    setKind(mode)
                  }}
                >
                  {mode}
                </Button>
              ))}
            </fieldset>
            <div aria-live="polite" className="space-y-0.5">
              <p className="break-words text-sm font-medium">
                {selected ? componentLabel(selected) : `Select a visible ${kind.toLowerCase()}`}
              </p>
              {location && (
                <p className="break-words font-mono text-xs text-fg-muted">
                  {location.map((value, i) => `${AXES[i]} ${sizeLabel(value)}`).join(' · ')} mm
                </p>
              )}
            </div>
            {kind === 'Vertex' && (
              <div className="flex items-end gap-1.5">
                <label htmlFor={inputId} className="min-w-0 flex-1 space-y-1 text-xs text-fg-muted">
                  <span>Vertex ID</span>
                  <Input
                    id={inputId}
                    aria-label="Vertex ID"
                    type="text"
                    inputMode="numeric"
                    placeholder={`0–${maxId}`}
                    value={vertex}
                    disabled={stale || hasOffset}
                    onChange={(e) => {
                      setVertex(e.target.value)
                      setSelected(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      selectId()
                    }}
                    className="h-8 px-2 font-mono"
                  />
                </label>
                <Button size="sm" disabled={!canSelectId || stale || hasOffset} onClick={selectId}>
                  Select vertex
                </Button>
              </div>
            )}
            <fieldset
              disabled={!selected || stale}
              className="space-y-1.5 border-t border-line pt-2.5"
            >
              <legend className="sr-only">Displacement in source millimetres</legend>
              <p className="text-sm font-medium">Displacement (mm)</p>
              <div className="grid grid-cols-3 gap-1.5">
                {AXES.map((axis, i) => (
                  <label
                    key={axis}
                    htmlFor={inputId + axis}
                    className="min-w-0 space-y-1 text-xs text-fg-muted"
                  >
                    <span>{axis}</span>
                    <Input
                      id={inputId + axis}
                      aria-label={`${axis} displacement (mm)`}
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={offsets[i]}
                      onChange={(e) =>
                        setOffsets(offsets.map((n, at) => (at === i ? e.target.value : n)))
                      }
                      className="h-8 px-2 font-mono"
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-fg-muted">
                XYZ uses the imported mesh’s source axes, before the part’s transform.
              </p>
            </fieldset>
            {hasOffset && (
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                {canSave && (
                  <p role="status" className="text-sm font-medium">
                    Preview
                  </p>
                )}
                <Button size="sm" variant="ghost" onClick={() => setOffsets(ZERO)}>
                  Reset displacement
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      {message && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {message}
        </p>
      )}
    </Dialog>
  )
}
