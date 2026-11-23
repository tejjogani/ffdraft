/**
 * Cycles settings per quality tier — research §1 "Recommended Cycles settings", with the
 * "Decisions for Pavé" floor of 24 transmission and 12 glossy bounces applied to every tier
 * (brilliant cuts need long internal-reflection chains; prongs reflect prongs).
 */
import type { RenderScene } from '@pave/schema'
import type { ResolvedOutput } from './types'

type Quality = RenderScene['output']['quality']

interface Tier extends Omit<ResolvedOutput, 'width' | 'height' | 'seed'> {
  /** Longest image side is capped here; null = as requested. */
  maxSide: number | null
}

const DEEP = { total: 32, transmission: 32, glossy: 16, diffuse: 4, transparent: 8 }
const FLOOR = { total: 24, transmission: 24, glossy: 12, diffuse: 2, transparent: 8 }

const STILL: Record<Quality, Tier> = {
  // The critique-loop draft: 768², 64 spp (research §4). Paths inside a stone are indirect,
  // so a low indirect clamp or a wide glossy filter turns fire milky; these are the lowest
  // values that kept the fixture diamond crisp at this sample count.
  preview: {
    maxSide: 768,
    samples: 64,
    noiseThreshold: 0.05,
    bounces: FLOOR,
    clampDirect: 0,
    clampIndirect: 30,
    filterGlossy: 0.5,
    denoise: true,
  },
  standard: {
    maxSide: 2048,
    samples: 384,
    noiseThreshold: 0.02,
    bounces: DEEP,
    clampDirect: 0,
    clampIndirect: 0,
    filterGlossy: 0.2,
    denoise: true,
  },
  // Clamping dims sparkle, so finals do not clamp.
  final: {
    maxSide: null,
    samples: 1024,
    noiseThreshold: 0.01,
    bounces: DEEP,
    clampDirect: 0,
    clampIndirect: 0,
    filterGlossy: 0.1,
    denoise: true,
  },
}

const ANIMATION: Record<Quality, Tier> = {
  preview: { ...STILL.preview, maxSide: 512, samples: 32, clampIndirect: 10 },
  standard: {
    maxSide: 1080,
    samples: 192,
    noiseThreshold: 0.02,
    bounces: { ...FLOOR, diffuse: 4 },
    clampDirect: 0,
    clampIndirect: 5,
    filterGlossy: 0.5,
    denoise: true,
  },
  final: {
    maxSide: 1920,
    samples: 256,
    noiseThreshold: 0.02,
    bounces: { ...FLOOR, diffuse: 4 },
    clampDirect: 0,
    clampIndirect: 10,
    filterGlossy: 0.5,
    denoise: true,
  },
}

/** Fixed seed: identical scenes give identical pixels, so critique-loop scores compare. */
const SEED = 0

export function resolveOutput(output: RenderScene['output'], animated: boolean): ResolvedOutput {
  const { maxSide, ...settings } = (animated ? ANIMATION : STILL)[output.quality]
  const k = maxSide ? Math.min(1, maxSide / Math.max(output.width, output.height)) : 1
  // Even dimensions keep video encoders happy.
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2)
  return { width: even(output.width), height: even(output.height), ...settings, seed: SEED }
}
