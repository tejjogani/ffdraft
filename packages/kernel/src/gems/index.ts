/** Unit gem meshes (girdle width = 1, table +Z, girdle plane z = 0), keyed by cut and ratio. */
import type { GemCutId } from '@pave/schema'
import type { MeshData } from '../types'

export interface GemUnit {
  key: string
  mesh: MeshData
  /** Girdle length for a girdle width of 1. */
  length: number
  /** Table height above and culet depth below the girdle plane (bottom is negative). */
  top: number
  bottom: number
  /** top − bottom. */
  depth: number
}

export function gemUnit(cut: GemCutId, _lw: number): GemUnit {
  throw new Error(`Gem meshes are not built yet (${cut})`)
}
