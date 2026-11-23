/** Inputs and outputs of the production package builder. Plain data; no I/O happens inside. */
import type { Evaluation, Kernel } from '@pave/kernel/types'
import type { Design, PieceKind, PieceSpec } from '@pave/schema'
import type { RateInput } from './cost'
import type { ProfileInput } from './dfm/profile'
import type { FontSet } from './fonts'
import type { Units } from './format'

export interface PieceInfo {
  id: string
  title: string
  kind: PieceKind
  sku?: string
}

export interface Party {
  name: string
  email?: string
  phone?: string
  address?: string
  website?: string
}

export interface RenderImage {
  name: string
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg'
  caption?: string
}

export type Market = 'US' | 'UK' | 'EU' | 'IN'

export interface ProductionOptions {
  quantity: number
  notes?: string
  rates?: RateInput
  manufacturerProfile?: ProfileInput
  units?: Units
  /** ISO date (YYYY-MM-DD or full timestamp) stamped on every file; injected for determinism. */
  date: string
  author: Party
  org: Party
  paper?: 'a4' | 'letter'
  /** Also export a 3MF (general print bureaus). Default true. */
  include3mf?: boolean
  /** Design version the evaluation came from (Piece.version). */
  sourceVersion?: number
  /** Who buys each stone group, by node id. Default: the brand when sourcing is attached. */
  stonesSuppliedBy?: Record<string, 'brand' | 'manufacturer'>
  markets?: Market[]
  marks?: { makerMark?: string; location?: string; logo?: string }
  plating?: { microns?: number; layers?: string }
  commercial?: {
    moq?: number
    targetCostUsd?: number
    leadTimeDays?: number
    sampleFirst?: boolean
  }
  packaging?: string
  /** Ring size run for production, e.g. ["US 5", "US 6", "US 7"]. */
  sizeRun?: string[]
}

export interface BuildInput {
  piece: PieceInfo
  revision: number
  design: Design
  spec?: PieceSpec | null
  /** A production-detail evaluation of `design`. */
  evaluation: Evaluation
  kernel: Kernel
  renders?: RenderImage[]
  /** Embedded typefaces; see `@pave/production/node` for a loader. */
  fonts: FontSet
  options: ProductionOptions
}

export interface PackageFile {
  /** Path inside the bundle folder, forward slashes. */
  path: string
  bytes: Uint8Array
  mime: string
}
