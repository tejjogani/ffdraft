import type { RhinoNativePart } from '@pave/kernel/rhino-import'
import type { Bounds } from '@pave/kernel/types'

export const MODEL_ACCEPT = '.3dm,.stl'

export const isModelFile = (name: string) => /\.(3dm|stl)$/i.test(name)
export const isStlFile = (name: string) => /\.stl$/i.test(name)

export const STL_UNITS = {
  mm: { label: 'Millimetres', scale: 1 },
  cm: { label: 'Centimetres', scale: 10 },
  in: { label: 'Inches', scale: 25.4 },
  m: { label: 'Metres', scale: 1000 },
} as const

export type StlUnit = keyof typeof STL_UNITS

export interface ModelPart {
  name: string
  layer: string | null
  bounds: Bounds
  bytes: Uint8Array<ArrayBuffer>
  native?: RhinoNativePart
}

export interface ModelPreview {
  units: string
  parts: ModelPart[]
  skipped: { name: string; layer: string | null; reason: string }[]
}

export interface ModelRequest {
  file: File
  stlUnit: StlUnit
}

export type ModelResponse = { preview: ModelPreview } | { error: string }
