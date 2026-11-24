/**
 * Where a check points: a ring pinned to a model point for a couple of seconds after "Show me",
 * pulsing (static under reduced motion), in the check's colour.
 */
import { cn } from '@pave/ui'
import { useEffect, useRef } from 'react'
import type { Viewer } from '../../../components/stage/viewer'

export interface MarkerSpot {
  at: [number, number, number]
  level: 'error' | 'warning' | 'info'
  /** Changes for every "Show me", so showing the same spot again restarts the marker. */
  key: number
}

const SHOW_MS = 2200

export function Marker({
  viewer,
  spot,
  onDone,
}: {
  viewer: Viewer | null
  spot: MarkerSpot
  onDone(): void
}) {
  const el = useRef<HTMLDivElement>(null)
  const done = useRef(onDone)
  done.current = onDone
  const at = spot.at.join(',')

  useEffect(() => {
    if (!viewer) return
    const point = at.split(',').map(Number) as [number, number, number]
    const place = () => {
      const p = viewer.project(point)
      const node = el.current
      if (!node) return
      node.style.visibility = p.visible ? 'visible' : 'hidden'
      node.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`
    }
    place()
    const off = viewer.onRender(place)
    const timer = setTimeout(() => done.current(), SHOW_MS)
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [viewer, at])

  return (
    <div ref={el} aria-hidden className="pointer-events-none absolute top-0 left-0 z-10">
      <span
        className={cn(
          'absolute -top-[5px] -left-[5px] size-2.5 rounded-full border-2',
          spot.level === 'error' ? 'border-danger' : 'border-warn',
        )}
      />
      <span
        className={cn(
          'absolute -top-[5px] -left-[5px] size-2.5 animate-ping rounded-full border-2 motion-reduce:hidden',
          spot.level === 'error' ? 'border-danger' : 'border-warn',
        )}
      />
    </div>
  )
}
