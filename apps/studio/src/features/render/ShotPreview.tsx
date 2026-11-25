/**
 * The selected shot, drawn live in the browser from the same resolved scene Blender renders:
 * the look, the angle, the backdrop and the metals. It redraws when the shot or the design
 * changes (after a slider is released, not on every step), so what you see is what a take will
 * frame, before any machine time is spent.
 */
import type { Evaluation } from '@pave/kernel'
import type { RenderScene } from '@pave/schema'
import { cn } from '@pave/ui'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ShotRenderer } from './shot-renderer'

export function ShotPreview({
  evaluation,
  scene,
  className,
  label,
}: {
  evaluation: Evaluation | null
  scene: RenderScene
  className?: string
  label: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<ShotRenderer | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  useEffect(() => {
    try {
      renderer.current = new ShotRenderer(canvas.current!)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'WebGL is not available')
    }
    return () => {
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const el = host.current!
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect
      setBox({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The frame keeps the shot's aspect inside whatever room the stage has.
  const aspect = scene.output.width / scene.output.height
  const fit =
    box.width / Math.max(1, box.height) > aspect
      ? { width: box.height * aspect, height: box.height }
      : { width: box.width, height: box.width / aspect }

  useEffect(() => {
    const r = renderer.current
    if (!r || !evaluation || fit.width < 8 || fit.height < 8) return
    // Next frame, so a burst of changes draws once.
    const frame = requestAnimationFrame(() => {
      try {
        r.draw(
          evaluation,
          scene,
          fit.width * Math.min(2, devicePixelRatio),
          fit.height * Math.min(2, devicePixelRatio),
        )
        setFailed(null)
      } catch (e) {
        setFailed(e instanceof Error ? e.message : String(e))
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [evaluation, scene, fit.width, fit.height])

  return (
    <div className={className}>
      <div ref={host} className="relative flex size-full items-center justify-center">
        <canvas
          ref={canvas}
          role="img"
          aria-label={label}
          style={{ width: fit.width, height: fit.height }}
          className={cn(
            'rounded-sm shadow-[0_0_0_1px_var(--line)]',
            (failed || !evaluation) && 'invisible',
          )}
        />
        {failed && (
          <p className="absolute max-w-sm text-center text-sm text-fg-muted">
            The live preview isn’t available in this browser ({failed}). Takes still render.
          </p>
        )}
      </div>
    </div>
  )
}
