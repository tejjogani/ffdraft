/**
 * How much the viewport may ask of the GPU. Software rasterisers (SwiftShader, llvmpipe,
 * Microsoft Basic Render) can draw everything correctly but not at interactive rates with the
 * ray-traced gem shader, so they start in clay mode, render at DPR 1 and trace fewer bounces.
 */
import type { GemQuality } from '@pave/render/three'
import type { Effects } from './adaptive'

export type GpuTier = 'software' | 'low' | 'high'

const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render|microsoft basic|software/i
/**
 * Integrated GPUs. Safari names every Apple GPU "Apple GPU"; Chrome and Electron name the chip
 * ("ANGLE Metal Renderer: Apple M2"), so the base M-series chips of a MacBook Air are named here
 * and their Pro, Max and Ultra siblings are not.
 */
const LOW = /intel|mali|adreno [1-5]|powervr|apple gpu|apple m\d+(?!\s*(pro|max|ultra))\b/i

/** The renderer string, when the browser exposes it. */
export function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '')
}

let caveat: boolean | undefined

/**
 * True when the browser itself says WebGL would run with a major performance caveat. Probed
 * once per page: each probe costs a WebGL context, and browsers cap how many may be alive.
 */
function hasPerformanceCaveat(): boolean {
  if (caveat !== undefined) return caveat
  try {
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true })
    caveat = gl === null
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    caveat = false
  }
  return caveat
}

/** The tier for a renderer string (exported for tests; `gpuTier` also probes the browser). */
export function tierOfName(name: string): GpuTier {
  if (SOFTWARE.test(name)) return 'software'
  return LOW.test(name) ? 'low' : 'high'
}

export function gpuTier(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuTier {
  const name = rendererName(gl)
  return hasPerformanceCaveat() ? 'software' : tierOfName(name)
}

export interface QualityPolicy {
  maxDpr: number
  /**
   * Gem shader quality per tier at rest and while the camera moves. Only bounces differ between
   * the two: toggling dispersion recompiles the shader, which would stall every orbit.
   */
  rest: Record<'hero' | 'melee', GemQuality>
  moving: Record<'hero' | 'melee', GemQuality>
  /** Above this many melee stones the melee tier drops to its moving quality even at rest. */
  meleeBudget: number
}

export function qualityFor(tier: GpuTier): QualityPolicy {
  switch (tier) {
    case 'software':
      return {
        maxDpr: 1,
        rest: { hero: { bounces: 3, dispersion: false }, melee: { bounces: 1, dispersion: false } },
        moving: {
          hero: { bounces: 1, dispersion: false },
          melee: { bounces: 1, dispersion: false },
        },
        meleeBudget: 0,
      }
    case 'low':
      return {
        maxDpr: 1.5,
        rest: { hero: { bounces: 5, dispersion: true }, melee: { bounces: 2, dispersion: false } },
        moving: {
          hero: { bounces: 2, dispersion: true },
          melee: { bounces: 1, dispersion: false },
        },
        meleeBudget: 600,
      }
    case 'high':
      return {
        maxDpr: 2,
        rest: { hero: { bounces: 6, dispersion: true }, melee: { bounces: 3, dispersion: false } },
        moving: {
          hero: { bounces: 2, dispersion: true },
          melee: { bounces: 2, dispersion: false },
        },
        meleeBudget: 3000,
      }
  }
}

/**
 * The gem shader quality for an effects level (see ./adaptive). `reduced` keeps dispersion as
 * the tier has it (toggling it recompiles the shader) and lowers only the bounces, a uniform;
 * `minimal` is one bounce without dispersion, a one-off recompile on a machine that needs it.
 */
export function gemQualityFor(
  policy: QualityPolicy,
  effects: Effects,
  moving: boolean,
): Record<'hero' | 'melee', GemQuality> {
  const set = moving ? policy.moving : policy.rest
  if (effects === 'full') return set
  if (effects === 'reduced')
    return {
      hero: { bounces: Math.min(set.hero.bounces, 2), dispersion: set.hero.dispersion },
      melee: { bounces: 1, dispersion: false },
    }
  return { hero: { bounces: 1, dispersion: false }, melee: { bounces: 1, dispersion: false } }
}
