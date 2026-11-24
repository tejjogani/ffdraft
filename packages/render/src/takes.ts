/**
 * What a take is before it is rendered: the default shot list for a piece kind, the looks and
 * sizes offered in plain words, the preview draft auto-tune measures first, and how long the
 * take will keep this machine busy. Pure, shared by the server (estimates, the queue's draft)
 * and the studio (the Render tab, the job's plan).
 */
import type { PieceKind, RenderScene, RenderSceneInput } from '@pave/schema'
import { resolveOutput } from './quality'

export interface ShotPreset {
  /** Stable key, so the studio can tell a default shot from a saved one. */
  key: string
  title: string
  scene: RenderSceneInput
}

const square = (quality: RenderScene['output']['quality'] = 'standard') => ({
  width: 2000,
  height: 2000,
  quality,
})

/**
 * Hero, Front, Top and Macro. Flat pieces (pendants, brooches, earrings) read face-on, so their
 * "Top" is the profile from the side instead, which shows depth and the bail or post.
 */
export function DEFAULT_SHOTS(kind: PieceKind): ShotPreset[] {
  const flat = kind === 'pendant' || kind === 'brooch' || kind === 'earrings'
  const shots: { key: string; title: string; scene: RenderSceneInput }[] = [
    { key: 'hero', title: 'Hero', scene: { camera: { preset: 'hero', focalLength: 90 } } },
    { key: 'front', title: 'Front', scene: { camera: { preset: 'front', focalLength: 90 } } },
    flat
      ? { key: 'side', title: 'Profile', scene: { camera: { preset: 'side', focalLength: 90 } } }
      : { key: 'top', title: 'Top', scene: { camera: { preset: 'top', focalLength: 90 } } },
    { key: 'macro', title: 'Macro', scene: { camera: { preset: 'macro', focalLength: 105 } } },
  ]
  return shots.map((s) => ({ ...s, scene: { ...s.scene, output: square() } }))
}

/** The looks, in the words a person picks them by; the first three lead. */
export const LOOK_CHOICES: readonly {
  look: RenderScene['look']
  label: string
  hint: string
}[] = [
  { look: 'catalog-white', label: 'Studio white', hint: 'Seamless white, soft shadow' },
  { look: 'black-acrylic', label: 'Black acrylic', hint: 'Dark, with a mirror floor' },
  { look: 'studio-soft', label: 'Soft gradient', hint: 'Warm grey sweep, soft light' },
  { look: 'studio-contrast', label: 'High contrast', hint: 'Crisp edges, deep blacks' },
  { look: 'editorial-warm', label: 'Editorial warm', hint: 'Low, warm light' },
  { look: 'daylight', label: 'Daylight', hint: 'Window light, natural' },
]

export const lookLabel = (look: RenderScene['look']): string =>
  LOOK_CHOICES.find((l) => l.look === look)?.label ?? look

/** Sizes in pixels; quality is chosen apart from size. */
export const SIZE_PRESETS: readonly {
  key: string
  label: string
  width: number
  height: number
}[] = [
  { key: 'square', label: 'Square 2000', width: 2000, height: 2000 },
  { key: 'portrait', label: 'Portrait 1600×2000', width: 1600, height: 2000 },
  { key: 'landscape', label: 'Landscape 2400×1600', width: 2400, height: 1600 },
  { key: 'web', label: 'Web 1200', width: 1200, height: 1200 },
]

export const QUALITY_LABELS: Record<RenderScene['output']['quality'], string> = {
  preview: 'Draft',
  standard: 'Standard',
  final: 'Final',
}

/** Drafts are measured, not looked at: fractions of the frame need few pixels. */
const DRAFT_LONG_SIDE = 512
const DRAFT_MIN_SIDE = 256

/** The request as a small preview still, same aspect ratio, for auto-tune to measure. */
export function draftOf(scene: RenderScene): RenderScene {
  const { width, height } = scene.output
  const k = Math.min(
    1,
    Math.max(DRAFT_LONG_SIDE / Math.max(width, height), DRAFT_MIN_SIDE / Math.min(width, height)),
  )
  const { animation: _still, ...rest } = scene
  return {
    ...rest,
    // Spread first, so the keys keep their order and an unchanged request compares equal.
    output: {
      ...scene.output,
      quality: 'preview',
      width: Math.round(width * k),
      height: Math.round(height * k),
    },
  }
}

const sameScene = (a: RenderScene, b: RenderScene) => JSON.stringify(a) === JSON.stringify(b)

/** Cycles work of one pass: pixels × samples × frames, in millions. */
function passWork(scene: RenderScene): number {
  const out = resolveOutput(scene.output, scene.animation !== undefined)
  const frames = scene.animation
    ? Math.max(1, Math.round(scene.animation.seconds * scene.animation.fps))
    : 1
  return (out.width * out.height * out.samples * frames) / 1e6
}

/** The Blender passes a take runs: the auto-tune draft (unless it is the take), then the take. */
export function takePasses(scene: RenderScene, autoTune: boolean): RenderScene[] {
  if (!autoTune) return [scene]
  const draft = draftOf(scene)
  return sameScene(draft, scene) ? [scene] : [draft, scene]
}

/** A take's work in million pixel-samples, and how many Blender passes it starts. */
export function takeWork(scene: RenderScene, autoTune: boolean): { work: number; passes: number } {
  const passes = takePasses(scene, autoTune)
  return { work: passes.reduce((sum, s) => sum + passWork(s), 0), passes: passes.length }
}

/**
 * Seconds per million pixel-samples with Cycles on a CPU, and the fixed cost of a pass (starting
 * Blender, importing the piece, building the BVH). From the development machine (4 shared cores,
 * the fixture solitaire): a 640 px preview with its auto-tune draft took 62 s. Rounded towards a
 * quicker machine; after two finished takes a machine's own rate replaces this.
 */
export const TYPICAL_RATE = { secondsPerWork: 0.6, passSeconds: 10 }

export interface RenderRate {
  secondsPerWork: number
  passSeconds: number
  /** `measured`: from this machine's finished takes; `typical`: the fallback above. */
  basis: 'measured' | 'typical'
}

/**
 * The rate this machine renders at, from its finished Blender takes (what was rendered, whether
 * auto-tune ran, and the seconds it took). The median keeps one cached or odd take from
 * skewing it; fewer than two takes and the typical rate stands.
 */
export function rateFrom(
  history: readonly { scene: RenderScene; autoTune: boolean; seconds: number }[],
): RenderRate {
  const rates = history
    .filter((h) => h.seconds > 0)
    .map((h) => {
      const { work, passes } = takeWork(h.scene, h.autoTune)
      return (h.seconds - passes * TYPICAL_RATE.passSeconds) / work
    })
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b)
  if (rates.length < 2) return { ...TYPICAL_RATE, basis: 'typical' }
  const mid = rates.length / 2
  const median = rates.length % 2 ? rates[Math.floor(mid)]! : (rates[mid - 1]! + rates[mid]!) / 2
  return { secondsPerWork: median, passSeconds: TYPICAL_RATE.passSeconds, basis: 'measured' }
}

/** How long one Blender take keeps the machine busy, in seconds. */
export function estimateTakeSeconds(scene: RenderScene, autoTune: boolean, rate: RenderRate) {
  const { work, passes } = takeWork(scene, autoTune)
  return passes * rate.passSeconds + work * rate.secondsPerWork
}

/** A browser preview: building the piece and a few frames, whatever the size. */
export const BROWSER_TAKE_SECONDS = 4

/** "about 40 s", "about 6 min", "about 1 h 20 min": estimates are rough, so they say so. */
export function machineTime(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `about ${h} h${m ? ` ${m} min` : ''}`
}
