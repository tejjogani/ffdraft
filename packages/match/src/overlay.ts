/** What the read card draws over the photo: a difference tint and an outline heat map. */
import { edges } from './mask'
import { mmPerPixel } from './scale'
import type { Camera, LabelRaster, Prepared } from './types'

/** Per pixel: 0 neither, 1 both, 2 model only, 3 photo only. */
export function diffClasses(r: LabelRaster, t: Prepared): Uint8Array {
  const m = t.view.matte
  const out = new Uint8Array(m.length)
  for (let k = 0; k < m.length; k++) {
    const a = r.cls[k] ? 1 : 0
    const b = m[k] ? 1 : 0
    out[k] = a && b ? 1 : a ? 2 : b ? 3 : 0
  }
  return out
}

/** At each model outline pixel, the distance in mm to the photo's outline; −1 elsewhere. */
export function edgeHeat(r: LabelRaster, t: Prepared, c: Camera): Float32Array {
  const size = { width: r.width, height: r.height }
  const metal = new Uint8Array(r.cls.length)
  for (let k = 0; k < metal.length; k++) metal[k] = r.cls[k] ? 1 : 0
  const e = edges(metal, size)
  const s = mmPerPixel(c, size)
  const out = new Float32Array(metal.length).fill(-1)
  for (let k = 0; k < metal.length; k++) if (e[k]) out[k] = t.edgeDist[k]! * s
  return out
}
