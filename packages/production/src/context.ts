/**
 * The resolved package context: facts, profile and the stone and metal requirements from
 * @pave/sourcing, paired with what the design says about supply and provenance. Every output
 * reads from this, so the BOM, stones.csv, cost estimate and spec sheet agree to the gram.
 */
import type { StoneLot } from '@pave/kernel/types'
import { type GemMaterialId, type StoneSourcing, gemDims } from '@pave/schema'
import { type MetalRequirement, type StoneRequirement, metalRequirements, stoneRequirements } from '@pave/sourcing'
import { lotKey } from './drawing/dimensions'
import { type PieceFacts, pieceFacts } from './facts'
import { type ManufacturerProfile, resolveProfile } from './dfm/profile'
import type { Units } from './format'
import { skuSlug } from './paths'
import type { BuildInput } from './types'

export type StoneOrigin = 'natural' | 'lab-grown' | 'lab-created' | 'simulant' | 'unspecified'

export interface LotInfo {
  key: string
  lot: StoneLot
  requirement: StoneRequirement
  depth: number
  origin: StoneOrigin
  suppliedBy: 'brand' | 'manufacturer'
  sourcing?: StoneSourcing
}

export interface PackageContext {
  input: BuildInput
  facts: PieceFacts
  profile: ManufacturerProfile
  sku: string
  /** File-name stem (ASCII-safe SKU). */
  stem: string
  units: Units
  quantity: number
  lots: LotInfo[]
  /** Per piece, with the profile's casting allowance. */
  metals: MetalRequirement[]
}

/** FTC Jewelry Guides vocabulary: lab-grown diamonds, lab-created gems, simulants. */
export function stoneOrigin(material: GemMaterialId, declared: StoneRequirement['origin']): StoneOrigin {
  if (material === 'diamond-lab') return 'lab-grown'
  if (material === 'moissanite') return 'lab-created'
  if (material === 'cz') return 'simulant'
  if (declared === 'lab') return material.startsWith('diamond') ? 'lab-grown' : 'lab-created'
  if (declared === 'natural') return 'natural'
  return 'unspecified'
}

export function createContext(input: BuildInput): PackageContext {
  const { design, evaluation, options } = input
  const profile = resolveProfile(options.manufacturerProfile)
  const requirements = stoneRequirements(design, evaluation.report)
  const lots = evaluation.report.lots.map((lot, i): LotInfo => {
    const requirement = requirements[i]!
    const sourcing = lot.nodeIds
      .map((id) => design.nodes[id])
      .map((n) => (n && 'sourcing' in n ? n.sourcing : undefined))
      .find((s): s is StoneSourcing => !!s)
    const declared = lot.nodeIds.map((id) => options.stonesSuppliedBy?.[id]).find(Boolean)
    return {
      key: lotKey(i),
      lot,
      requirement,
      depth: gemDims(lot.cut, lot.width, lot.length / lot.width).depth,
      origin: stoneOrigin(lot.stone, requirement.origin),
      suppliedBy: declared ?? (sourcing ? 'brand' : 'manufacturer'),
      ...(sourcing ? { sourcing } : {}),
    }
  })
  const sku = input.piece.sku?.trim() || input.piece.id
  return {
    input,
    facts: pieceFacts(design, evaluation),
    profile,
    sku,
    stem: skuSlug(sku),
    units: options.units ?? 'mm',
    quantity: options.quantity,
    lots,
    metals: metalRequirements(evaluation.report, profile.castingAllowancePct),
  }
}
