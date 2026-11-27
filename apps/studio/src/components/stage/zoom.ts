/** The slider moves in equal ratios, giving close-up adjustments room on the track. */
export function zoomSliderDistance(value: number, min: number, max: number): number {
  if (value <= 0) return max
  if (value >= 100) return min
  return max * (min / max) ** (value / 100)
}

export function zoomSliderValue(distance: number, min: number, max: number): number {
  const progress = Math.log(max / distance) / Math.log(max / min)
  return Math.round(Math.max(0, Math.min(1, progress)) * 100)
}

/** Pinch events carry smaller deltas than ordinary mouse-wheel notches. */
export function pinchWheelFactor(deltaY: number): number {
  return Math.exp(-Math.max(-100, Math.min(100, deltaY)) / 50)
}
