/**
 * How much the viewport may ask of the GPU. Software rasterisers (SwiftShader, llvmpipe,
 * Microsoft Basic Render) can draw everything correctly but not at interactive rates with the
 * ray-traced gem shader, so they start in clay mode, render at DPR 1 and trace fewer bounces.
 */
import type { GemQuality } from '@pave/render/three'

export type GpuTier = 'software' | 'low' | 'high'

const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render|microsoft basic|software/i
const LOW = /intel|mali|adreno [1-5]|powervr|apple gpu/i

/** The renderer string, when the browser exposes it. */
export function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '')
}

/** True when the browser itself says WebGL would run with a major performance caveat. */
function hasPerformanceCaveat(): boolean {
  try {
    const probe = document.createElement('canvas')
    return probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) === null
  } catch {
    return false
  }
}

export function gpuTier(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuTier {
  const name = rendererName(gl)
  if (SOFTWARE.test(name) || hasPerformanceCaveat()) return 'software'
  return LOW.test(name) ? 'low' : 'high'
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
        moving: { hero: { bounces: 1, dispersion: false }, melee: { bounces: 1, dispersion: false } },
        meleeBudget: 0,
      }
    case 'low':
      return {
        maxDpr: 1.5,
        rest: { hero: { bounces: 5, dispersion: true }, melee: { bounces: 2, dispersion: false } },
        moving: { hero: { bounces: 2, dispersion: true }, melee: { bounces: 1, dispersion: false } },
        meleeBudget: 600,
      }
    case 'high':
      return {
        maxDpr: 2,
        rest: { hero: { bounces: 6, dispersion: true }, melee: { bounces: 3, dispersion: false } },
        moving: { hero: { bounces: 2, dispersion: true }, melee: { bounces: 2, dispersion: false } },
        meleeBudget: 3000,
      }
  }
}
