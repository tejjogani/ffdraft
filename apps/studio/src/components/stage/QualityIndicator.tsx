/**
 * The Performance setting as a control (Settings › General and the viewport's indicator share
 * it), and the quiet indicator a 3D view shows while it draws below full quality: a small chip
 * that opens the setting with a sentence on what is reduced and why.
 */
import { Popover, Segmented } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Gauge } from 'lucide-react'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { PERFORMANCE_WORDS, usePerformance } from '../../stores/performance'
import { PERFORMANCE_MODES, type PerformanceMode, type QualityState } from './adaptive'

/** Anything that draws adaptively: the CAD viewer and the Render tab's live preview. */
export interface QualitySource {
  readonly qualityState: QualityState
  onQuality(listener: () => void): () => void
}

const NONE = () => () => {}

export function useQuality(source: QualitySource | null): QualityState | null {
  const subscribe = useCallback(
    (l: () => void) => (source ? source.onQuality(l) : NONE()),
    [source],
  )
  return useSyncExternalStore(subscribe, () => source?.qualityState ?? null)
}

/** Views asking for solid glass now; the attribute stays while any of them does. */
let solidGlassViews = 0

/**
 * Drops the page's frosted glass for solid fills while this view asks for it (see
 * `QualityState.solidGlass`), through `<html data-glass="solid">` (packages/ui styles.css).
 */
export function useSolidGlass(q: QualityState | null): void {
  const solid = q?.solidGlass === true
  useEffect(() => {
    if (!solid) return
    solidGlassViews++
    document.documentElement.dataset.glass = 'solid'
    return () => {
      if (--solidGlassViews === 0) delete document.documentElement.dataset.glass
    }
  }, [solid])
}

export function PerformanceControl({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const mode = usePerformance((s) => s.mode)
  const setMode = usePerformance((s) => s.setMode)
  return (
    <Segmented<PerformanceMode>
      aria-label="Performance"
      size={size}
      value={mode}
      onChange={setMode}
      options={PERFORMANCE_MODES.map((m) => ({ value: m, label: PERFORMANCE_WORDS[m].label }))}
    />
  )
}

const times = (dpr: number) => `${Number.isInteger(dpr) ? dpr : dpr.toFixed(2).replace(/0$/, '')}×`

/** One sentence on what the view is doing, in the words of the setting. */
export function qualitySentence(q: QualityState, deviceDpr: number): string {
  const screen = deviceDpr > 1 ? ` (this screen is ${times(deviceDpr)})` : ''
  const still =
    q.stillEffects !== 'full'
      ? `Still pictures are drawn at ${times(q.stillDpr)}${screen} with lighter stone effects`
      : `Still pictures are drawn at ${times(q.stillDpr)}${screen}`
  const moving =
    q.mode === 'sharp'
      ? 'and moving ones at full detail.'
      : `and moving ones at about ${times(q.movingDpr)}, then sharpened when you stop.`
  return `${still}, ${moving}`
}

export function QualityIndicator({
  source,
  className,
}: {
  source: QualitySource | null
  className?: string
}) {
  const q = useQuality(source)
  const mode = usePerformance((s) => s.mode)
  useSolidGlass(q)
  if (!q || !(q.reducedStill || q.reducedNow)) return null
  const label = q.reducedNow
    ? 'Lighter while moving'
    : mode === 'smooth'
      ? 'Smooth view'
      : q.effects !== 'full'
        ? 'Lighter view'
        : `Sharpness ${times(q.stillDpr)}`
  const deviceDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return (
    <Popover
      side="top"
      align="end"
      title="Performance"
      className="w-80"
      trigger={
        <button
          type="button"
          data-quality-indicator={q.reducedNow ? 'moving' : 'still'}
          aria-label={`${label}. Performance setting`}
          className={
            'chip-solid flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-3xs font-medium text-fg-muted hover:text-fg ' +
            (className ?? '')
          }
        >
          <Gauge aria-hidden className="size-3" />
          {label}
        </button>
      }
    >
      <div className="flex flex-col gap-2.5">
        <p className="text-sm font-medium">Performance</p>
        <PerformanceControl size="sm" />
        <p className="text-xs text-fg-muted">{PERFORMANCE_WORDS[mode].blurb}</p>
        <p className="text-xs text-fg-muted">{qualitySentence(q, deviceDpr)}</p>
        <Link to="/settings/general" className="text-xs font-medium hover:underline">
          Open Settings
        </Link>
      </div>
    </Popover>
  )
}
