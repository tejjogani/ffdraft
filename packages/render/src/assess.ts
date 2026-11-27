/**
 * The numeric half of the critique loop (research §4, "Split the critique loop. Do not ask a
 * vision model to measure pixels"). The worker measures a render; this turns the measurements
 * into machine-readable issues, each with RenderScene patches the assistant can apply as-is.
 */
import type { RenderScene } from '@pave/schema'
import { clamp } from './math'

/** Measured by `workers/render` (see `metrics.py`) from the beauty pass and the subject mask. */
export interface RenderMetrics {
  width: number
  height: number
  /** Subject bounding box [x0, y0, x1, y1] in 0–1 image coordinates (y down); null if empty. */
  subjectBox: [number, number, number, number] | null
  /** Fraction of the frame covered by the subject mask. */
  subjectCoverage: number
  /** % of subject pixels with a channel at ≥ 254/255. */
  clippedPct: number
  /** % of subject pixels below 2 % display luminance. */
  crushedPct: number
  /** Mean display-referred luminance (0–1) inside the subject mask. */
  subjectLuminance: number
  /** Isolated hot pixels per megapixel (brighter than their 3×3 median by > 0.25 and 2×). */
  firefliesPerMp: number
  /** Immerkær noise σ (0–1 display units) over smooth regions. */
  noise: number
}

/** The thresholds; research §4 "Numeric, from render passes". */
export const CHECKS = {
  fill: [0.55, 0.75],
  fillTarget: 0.66,
  minMargin: 0.05,
  maxCentreOffset: 0.07,
  maxClippedPct: 1,
  maxCrushedPct: 25,
  luminance: [0.18, 0.8],
  maxFirefliesPerMp: 30,
  maxNoise: 0.012,
} as const

export type AdjustablePath =
  | 'camera.focalLength'
  | 'camera.preset'
  | 'environment.intensity'
  | 'output.quality'
  | 'sparkle'

export interface SceneAdjustment {
  path: AdjustablePath
  value: number | string
}

export interface RenderIssue {
  code:
    | 'subject.missing'
    | 'framing.cropped'
    | 'framing.small'
    | 'framing.large'
    | 'framing.margin'
    | 'framing.offCentre'
    | 'exposure.clipped'
    | 'exposure.crushed'
    | 'exposure.dark'
    | 'exposure.bright'
    | 'noise.high'
    | 'noise.fireflies'
  severity: 'error' | 'warning'
  message: string
  value: number
  limit: number
  adjust: SceneAdjustment[]
}

const QUALITY_UP: Record<
  RenderScene['output']['quality'],
  RenderScene['output']['quality'] | null
> = {
  preview: 'standard',
  standard: 'final',
  final: null,
}

const r2 = (n: number) => Math.round(n * 100) / 100

function framingIssues(
  [x0, y0, x1, y1]: [number, number, number, number],
  scene: RenderScene,
  focal: (k: number) => SceneAdjustment,
): RenderIssue[] {
  const issues: RenderIssue[] = []
  const fill = Math.max(x1 - x0, y1 - y0)
  const margin = Math.min(x0, y0, 1 - x1, 1 - y1)
  if (margin <= 0.002) {
    issues.push({
      code: 'framing.cropped',
      severity: 'error',
      message: 'The piece touches the frame edge and is cropped.',
      value: r2(margin),
      limit: CHECKS.minMargin,
      adjust: [focal(CHECKS.fillTarget / Math.max(fill, 1))],
    })
  } else if (fill > CHECKS.fill[1]) {
    issues.push({
      code: 'framing.large',
      severity: 'warning',
      message: `The piece fills ${Math.round(fill * 100)}% of the frame; aim for 55–75%.`,
      value: r2(fill),
      limit: CHECKS.fill[1],
      adjust: [focal(CHECKS.fillTarget / fill)],
    })
  } else if (margin < CHECKS.minMargin) {
    issues.push({
      code: 'framing.margin',
      severity: 'warning',
      message: 'The piece sits too close to the frame edge.',
      value: r2(margin),
      limit: CHECKS.minMargin,
      adjust: [focal(0.9)],
    })
  }
  if (fill < CHECKS.fill[0]) {
    issues.push({
      code: 'framing.small',
      severity: 'warning',
      message: `The piece fills only ${Math.round(fill * 100)}% of the frame; aim for 55–75%.`,
      value: r2(fill),
      limit: CHECKS.fill[0],
      adjust: [focal(CHECKS.fillTarget / fill)],
    })
  }
  const offset = Math.hypot((x0 + x1) / 2 - 0.5, (y0 + y1) / 2 - 0.5)
  if (offset > CHECKS.maxCentreOffset) {
    issues.push({
      code: 'framing.offCentre',
      severity: 'warning',
      message:
        'The piece is off-centre. Presets centre it automatically; a custom camera needs a new target.',
      value: r2(offset),
      limit: CHECKS.maxCentreOffset,
      adjust: scene.camera.preset === 'custom' ? [{ path: 'camera.preset', value: 'hero' }] : [],
    })
  }
  return issues
}

export function assessRender(
  m: RenderMetrics,
  scene: RenderScene,
  intentionalCrop = false,
): RenderIssue[] {
  const issues: RenderIssue[] = []
  const issue = (i: RenderIssue) => issues.push(i)
  const focal = (k: number): SceneAdjustment => ({
    path: 'camera.focalLength',
    value: Math.round(clamp(scene.camera.focalLength * k, 18, 200)),
  })
  const intensity = (k: number): SceneAdjustment => ({
    path: 'environment.intensity',
    value: r2(clamp(scene.environment.intensity * k, 0.05, 5)),
  })
  const betterQuality = QUALITY_UP[scene.output.quality]

  const box = m.subjectBox
  if (!box) {
    issue({
      code: 'subject.missing',
      severity: 'error',
      message: 'The piece is not visible in the frame.',
      value: 0,
      limit: 0,
      adjust: [{ path: 'camera.preset', value: 'hero' }],
    })
    return issues
  }

  // The whole-piece mask extends outside an intentional detail crop.
  if (scene.camera.preset !== 'macro' && !intentionalCrop)
    issues.push(...framingIssues(box, scene, focal))

  if (m.clippedPct > CHECKS.maxClippedPct) {
    issue({
      code: 'exposure.clipped',
      severity: 'warning',
      message: `${m.clippedPct.toFixed(1)}% of the piece is blown out.`,
      value: r2(m.clippedPct),
      limit: CHECKS.maxClippedPct,
      adjust: [intensity(0.8)],
    })
  }
  if (m.subjectLuminance < CHECKS.luminance[0]) {
    issue({
      code: 'exposure.dark',
      severity: 'warning',
      message: 'The piece is underexposed.',
      value: r2(m.subjectLuminance),
      limit: CHECKS.luminance[0],
      adjust: [intensity(Math.min(1.6, 0.35 / Math.max(m.subjectLuminance, 0.05)))],
    })
  } else if (m.subjectLuminance > CHECKS.luminance[1]) {
    issue({
      code: 'exposure.bright',
      severity: 'warning',
      message: 'The piece is overexposed.',
      value: r2(m.subjectLuminance),
      limit: CHECKS.luminance[1],
      adjust: [intensity(0.8)],
    })
  }
  if (m.crushedPct > CHECKS.maxCrushedPct) {
    issue({
      code: 'exposure.crushed',
      severity: 'warning',
      message: `${Math.round(m.crushedPct)}% of the piece is near-black; the metal is reflecting empty studio.`,
      value: r2(m.crushedPct),
      limit: CHECKS.maxCrushedPct,
      adjust: [intensity(1.25)],
    })
  }

  if (m.noise > CHECKS.maxNoise) {
    issue({
      code: 'noise.high',
      severity: 'warning',
      message: 'Visible residual noise.',
      value: Math.round(m.noise * 1000) / 1000,
      limit: CHECKS.maxNoise,
      adjust: betterQuality ? [{ path: 'output.quality', value: betterQuality }] : [],
    })
  }
  if (m.firefliesPerMp > CHECKS.maxFirefliesPerMp) {
    issue({
      code: 'noise.fireflies',
      severity: 'warning',
      message: `${Math.round(m.firefliesPerMp)} fireflies per megapixel.`,
      value: Math.round(m.firefliesPerMp),
      limit: CHECKS.maxFirefliesPerMp,
      adjust: betterQuality
        ? [{ path: 'output.quality', value: betterQuality }]
        : [{ path: 'sparkle', value: r2(scene.sparkle * 0.7) }],
    })
  }
  return issues
}

/** Applies adjustments immutably; the result still needs schema validation by the caller. */
export function applyAdjustments(
  scene: RenderScene,
  adjustments: readonly SceneAdjustment[],
): RenderScene {
  const next: RenderScene = structuredClone(scene)
  for (const { path, value } of adjustments) {
    const [head, tail] = path.split('.') as [string, string | undefined]
    const record = next as unknown as Record<string, unknown>
    if (tail) (record[head] as Record<string, unknown>)[tail] = value
    else record[head] = value
  }
  return next
}
