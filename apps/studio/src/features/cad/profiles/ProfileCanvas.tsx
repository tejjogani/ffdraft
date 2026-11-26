import type { ProfilePlane, ProfilePoint } from '@pave/schema'
import { useLayoutEffect, useRef } from 'react'

const WIDTH = 640
const HEIGHT = 340
const AXES = { front: ['X', 'Z'], top: ['X', 'Y'], right: ['Y', 'Z'] } as const

/** A measured orthographic view, independent of the orbit camera. */
export function ProfileCanvas({
  points,
  plane,
  corner,
  onPoint,
}: {
  points: readonly ProfilePoint[]
  plane: ProfilePlane
  corner: ProfilePoint | null
  onPoint(point: ProfilePoint): void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const extent = Math.max(14, ...points.flatMap(([u, v]) => [Math.abs(u) * 0.6, Math.abs(v)]))
  const scale = (HEIGHT / 2 - 24) / extent
  const horizontal = (u: number) => WIDTH / 2 + u * scale
  const vertical = (v: number) => HEIGHT / 2 - v * scale
  useLayoutEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const css = getComputedStyle(canvas)
    const ink = css.getPropertyValue('--ink').trim()
    const color = css.getPropertyValue('--select').trim()
    const grid = css.getPropertyValue('--line').trim()
    const axis = css.getPropertyValue('--line-strong').trim()
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    const step = [1, 2, 5, 10, 25, 50].find((n) => n * scale >= 15) ?? 100
    ctx.strokeStyle = grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = (WIDTH / 2) % (step * scale); x < WIDTH; x += step * scale) {
      ctx.moveTo(Math.round(x) + 0.5, 0)
      ctx.lineTo(Math.round(x) + 0.5, HEIGHT)
    }
    for (let y = (HEIGHT / 2) % (step * scale); y < HEIGHT; y += step * scale) {
      ctx.moveTo(0, Math.round(y) + 0.5)
      ctx.lineTo(WIDTH, Math.round(y) + 0.5)
    }
    ctx.stroke()
    ctx.strokeStyle = axis
    ctx.beginPath()
    ctx.moveTo(WIDTH / 2 + 0.5, 0)
    ctx.lineTo(WIDTH / 2 + 0.5, HEIGHT)
    ctx.moveTo(0, HEIGHT / 2 + 0.5)
    ctx.lineTo(WIDTH, HEIGHT / 2 + 0.5)
    ctx.stroke()
    ctx.fillStyle = ink
    ctx.font = '12px monospace'
    ctx.fillText(AXES[plane][0], WIDTH - 19, HEIGHT / 2 - 8)
    ctx.fillText(AXES[plane][1], WIDTH / 2 + 8, 16)
    ctx.fillText(`${step} mm grid`, 12, HEIGHT - 12)
    if (points.length) {
      const [first, ...rest] = points
      ctx.beginPath()
      ctx.moveTo(horizontal(first![0]), vertical(first![1]))
      for (const [u, v] of rest) ctx.lineTo(horizontal(u), vertical(v))
      if (points.length >= 3) {
        ctx.closePath()
        ctx.fillStyle = color
        ctx.globalAlpha = 0.12
        ctx.fill()
        ctx.globalAlpha = 1
      }
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.fillStyle = color
    for (const [u, v] of corner ? [...points, corner] : points) {
      ctx.beginPath()
      ctx.arc(horizontal(u), vertical(v), 4, 0, Math.PI * 2)
      ctx.fill()
    }
  })

  return (
    <canvas
      ref={ref}
      width={WIDTH}
      height={HEIGHT}
      aria-label={`Profile drawing area, ${plane} plane`}
      className="block w-full cursor-crosshair rounded-md border border-line bg-bg"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const rect = event.currentTarget.getBoundingClientRect()
        const u = (((event.clientX - rect.left) * WIDTH) / rect.width - WIDTH / 2) / scale
        const v = (HEIGHT / 2 - ((event.clientY - rect.top) * HEIGHT) / rect.height) / scale
        onPoint([Math.round(u * 10) / 10, Math.round(v * 10) / 10])
      }}
    />
  )
}
