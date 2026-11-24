/**
 * Pictures of the piece from the live viewport, for the assistant (`viewport.capture`) and for
 * automatic covers. Only a mounted <Stage/> can capture; callers wait for the design session
 * and the evaluation to settle first.
 */
import type { CaptureOptions, Viewer } from './viewer'

let live: Viewer | null = null

/** Called by <Stage/> when it mounts and unmounts. */
export function setLiveViewer(viewer: Viewer | null): void {
  live = viewer
}

/** Paints the stage sweep (`--stage-a` → `--stage-b`) so captures match what the designer sees. */
function stageBackground(ctx: CanvasRenderingContext2D, size: number): void {
  const css = getComputedStyle(document.documentElement)
  const g = ctx.createRadialGradient(size / 2, size * 0.2, 0, size / 2, size * 0.2, size * 1.1)
  g.addColorStop(0, css.getPropertyValue('--stage-a').trim() || '#f6f5f2')
  g.addColorStop(1, css.getPropertyValue('--stage-b').trim() || '#e7e5e0')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
}

/** PNGs of the current evaluation from each view, at `size`×`size`. Rejects without a viewport. */
export function captureViewport(opts: Omit<CaptureOptions, 'background'>): Promise<Blob[]> {
  if (!live) return Promise.reject(new Error('No viewport is open'))
  return live.capture({ ...opts, background: stageBackground })
}
