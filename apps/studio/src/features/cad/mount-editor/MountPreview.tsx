import { Button, Spinner } from '@pave/ui'
import { useEffect, useRef, useState } from 'react'
import type { ViewName } from '../mesh-edit/viewport'
import type { PreviewBox, PreviewPart, PreviewReply } from './preview-model'
import { createMountViewport, type ViewportFrame } from './viewport'

type MountViewport = ReturnType<typeof createMountViewport>
const views = ['Perspective', 'Front', 'Right', 'Top'] as const

function usePreview(parts: PreviewPart[]) {
  const [result, setResult] = useState<PreviewReply>()
  useEffect(() => {
    const worker = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<PreviewReply>) => {
      setResult(data)
      worker.terminate()
    }
    worker.onerror = () => {
      setResult({ error: 'The selected bodies could not load for preview.' })
      worker.terminate()
    }
    worker.postMessage(parts)
    return () => worker.terminate()
  }, [parts])
  return result
}

type HandleEvents = Parameters<typeof createMountViewport>[3]

export function MountPreview({
  parts,
  bounds,
  frame,
  events,
  showFitButton,
  onToggleFit,
}: {
  parts: PreviewPart[]
  bounds: PreviewBox
  frame: ViewportFrame
  events: HandleEvents
  showFitButton: boolean
  onToggleFit(): void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewport = useRef<MountViewport>(null)
  const handlers = useRef(events)
  const result = usePreview(parts)
  const meshes = result && 'meshes' in result ? result.meshes : null
  const error = result && 'error' in result ? result.error : null
  const [unavailable, setUnavailable] = useState(false)
  const [view, setView] = useState<ViewName>('Perspective')
  useEffect(() => {
    handlers.current = events
  }, [events])
  useEffect(() => {
    const target = canvas.current
    if (!target || !meshes) return
    let scene: MountViewport
    try {
      scene = createMountViewport(target, meshes, bounds, {
        onPick: (handle) => handlers.current.onPick(handle),
        onMove: (handle, delta) => handlers.current.onMove(handle, delta),
        onRelease: (handle, delta) => handlers.current.onRelease(handle, delta),
      })
      viewport.current = scene
    } catch {
      setUnavailable(true)
      return
    }
    const lost = () => setUnavailable(true)
    target.addEventListener('webglcontextlost', lost)
    return () => {
      target.removeEventListener('webglcontextlost', lost)
      scene.dispose()
      viewport.current = null
    }
  }, [meshes, bounds])
  // Reapply the current frame and view if the asynchronously loaded scene changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: meshes also trigger a new viewport
  useEffect(() => viewport.current?.setView(view), [view, meshes])
  // biome-ignore lint/correctness/useExhaustiveDependencies: meshes also trigger a new viewport
  useEffect(() => viewport.current?.show(frame), [frame, meshes])

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <fieldset className="flex flex-wrap justify-between gap-1" aria-label="Cage views">
        <div className="flex flex-wrap gap-0.5">
          {views.map((name) => (
            <Button
              key={name}
              size="sm"
              variant="ghost"
              className={view === name ? 'bg-select-soft text-fg' : undefined}
              aria-pressed={view === name}
              onClick={() => setView(name)}
            >
              {name}
            </Button>
          ))}
        </div>
        {showFitButton && (
          <Button
            size="sm"
            className={frame.fitted ? 'bg-select-soft text-fg' : undefined}
            aria-pressed={!!frame.fitted}
            onClick={onToggleFit}
          >
            Fitted view
          </Button>
        )}
      </fieldset>
      {error || unavailable ? (
        <p role="status" className="rounded-md border border-line p-4 text-sm text-fg-muted">
          {error ?? 'The 3D preview is unavailable.'} You can still edit the cage by millimetres.
        </p>
      ) : !meshes ? (
        <div
          role="status"
          className="grid h-44 place-items-center rounded-md border border-line text-sm text-fg-muted"
        >
          <span className="flex items-center gap-2">
            <Spinner /> Loading bodies…
          </span>
        </div>
      ) : (
        <canvas
          ref={canvas}
          role="img"
          aria-label={frame.fitted ? 'Fitted mount viewport' : 'Mount cage viewport'}
          className="block h-[clamp(240px,47dvh,500px)] w-full touch-none rounded-md bg-[#20252e]"
        />
      )}
      {meshes && !unavailable && (
        <p className="text-xs text-fg-muted">
          {frame.fitted
            ? 'Fitted geometry at current stone dimensions.'
            : 'Drag a corner or face handle to move it in the view. The cage uses source placement before fitting.'}
          {frame.stone && ' The blue outline shows the stone’s girdle envelope.'}
        </p>
      )}
    </div>
  )
}
