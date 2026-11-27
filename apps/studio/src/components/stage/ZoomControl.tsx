import { IconButton } from '@pave/ui'
import { Minus, Plus } from 'lucide-react'
import { useCallback, useSyncExternalStore } from 'react'
import type { Viewer } from './viewer'
import { zoomSliderDistance, zoomSliderValue } from './zoom'

export function ZoomControl({ viewer }: { viewer: Viewer }) {
  const subscribe = useCallback((listener: () => void) => viewer.onRender(listener), [viewer])
  const distance = useSyncExternalStore(subscribe, () => viewer.controls.distance)
  const percent = useSyncExternalStore(subscribe, () => viewer.zoomPercent)
  if (percent === null) return null
  const { minDistance, maxDistance } = viewer.controls
  return (
    <div className="glass flex h-9 items-center gap-1 rounded-lg px-1 shadow-sm">
      <IconButton
        icon={Minus}
        label="Zoom out"
        onClick={() => viewer.zoom(0.8)}
        disabled={distance >= maxDistance}
      />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={zoomSliderValue(distance, minDistance, maxDistance)}
        aria-label="Viewport zoom"
        aria-valuetext={`${percent}% of fitted view`}
        onChange={(e) =>
          viewer.setZoomDistance(
            zoomSliderDistance(e.currentTarget.valueAsNumber, minDistance, maxDistance),
          )
        }
        className="h-7 w-24 cursor-pointer rounded accent-select focus-visible:outline-2 focus-visible:outline-select"
      />
      <IconButton
        icon={Plus}
        label="Zoom in"
        onClick={() => viewer.zoom(1.25)}
        disabled={distance <= minDistance}
      />
      <span aria-hidden className="min-w-12 select-none pr-1 text-right font-mono text-xs tabular">
        {percent}%
      </span>
    </div>
  )
}
