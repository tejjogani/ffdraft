/**
 * The resolved package context: facts, profile and the stone and metal requirements from
 * @pave/sourcing, paired with what the design says about supply and provenance. Every output
 * reads from this, so the BOM, stones.csv, cost estimate and spec sheet agree to the gram.
 */
import type { Evaluation, Part, StoneLot } from '@pave/kernel/types'
import { type Design, type GemMaterialId, gemDims, type StoneSourcing } from '@pave/schema'
import {
  type MetalRequirement,
  metalRequirements,
  type StoneRequirement,
  stoneRequirements,
} from '@pave/sourcing'
import { type ManufacturerProfile, resolveProfile } from './dfm/profile'
import { lotKey } from './drawing/dimensions'
import { type PieceFacts, pieceFacts } from './facts'
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

/**
 * The bodies one design node produced, cast together: usually one part, or many identical bodies
 * (a chain's links) that the kernel returns separately.
 */
export interface CastingGroup {
  key: string
  name: string
  parts: Part[]
  /** Pieces to cast: the number of identical bodies, else 1. */
  count: number
  identical: boolean
  volumeMm3: number
}

export interface PackageContext {
  /** The input, with empty parts removed from the evaluation. */
  input: BuildInput
  /** Parts the kernel returned without geometry; reported, never exported. */
  emptyParts: string[]
  /** Casting groups in evaluation order: one STL and one BOM line each. */
  groups: CastingGroup[]
  /**
   * The piece as drawn and dimensioned: the evaluation without chains (a chain is a finding,
   * specified by style and length, not a dimensioned view), with bounds to match.
   */
  drawn: Evaluation
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
export function stoneOrigin(
  material: GemMaterialId,
  declared: StoneRequirement['origin'],
): StoneOrigin {
  if (material === 'diamond-lab') return 'lab-grown'
  if (material === 'moissanite') return 'lab-created'
  if (material === 'cz') return 'simulant'
  if (declared === 'lab') return material.startsWith('diamond') ? 'lab-grown' : 'lab-created'
  if (declared === 'natural') return 'natural'
  return 'unspecified'
}

export function createContext(raw: BuildInput): PackageContext {
  const parts = raw.evaluation.parts.filter((p) => p.mesh.indices.length > 0)
  const emptyParts = raw.evaluation.parts
    .filter((p) => p.mesh.indices.length === 0)
    .map((p) => p.id)
  const input: BuildInput = { ...raw, evaluation: { ...raw.evaluation, parts } }
  const { design, evaluation, options } = input
  const groups = castingGroups(parts)
  const drawn = withoutChains(evaluation, design, groups)
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
    emptyParts,
    groups,
    drawn,
    facts: pieceFacts(design, drawn),
    profile,
    sku,
    stem: skuSlug(sku),
    units: options.units ?? 'mm',
    quantity: options.quantity,
    lots,
    metals: metalRequirements(evaluation.report, profile.castingAllowancePct),
  }
}

/** Groups of many identical bodies are chain links, whatever node the kernel files them under. */
const LINKS = 8

function withoutChains(evaluation: Evaluation, design: Design, groups: CastingGroup[]): Evaluation {
  const chains = new Set(design.order.filter((id) => design.nodes[id]?.kind === 'chain'))
  const links = new Set(
    groups
      .filter((g) => chains.has(g.key) || (g.identical && g.count > LINKS))
      .flatMap((g) => g.parts),
  )
  if (!links.size) return evaluation
  const parts = evaluation.parts.filter((p) => !links.has(p))
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const grow = (v: readonly number[]) => {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, v[a]!)
      max[a] = Math.max(max[a]!, v[a]!)
    }
  }
  for (const p of parts) {
    grow(p.bounds.min)
    grow(p.bounds.max)
  }
  for (const s of evaluation.stones) {
    const r = Math.max(s.dims.length, s.dims.width) / 2
    grow([s.matrix[12]! - r, s.matrix[13]! - r, s.matrix[14]! - r])
    grow([s.matrix[12]! + r, s.matrix[13]! + r, s.matrix[14]! + r])
  }
  return { ...evaluation, parts, report: { ...evaluation.report, bounds: { min, max } } }
}

function castingGroups(parts: readonly Part[]): CastingGroup[] {
  const map = new Map<string, Part[]>()
  for (const p of parts) {
    const key = `${p.nodeId}|${p.material}`
    map.set(key, [...(map.get(key) ?? []), p])
  }
  return [...map.values()].map((list) => {
    const volumeMm3 = list.reduce((t, p) => t + p.volumeMm3, 0)
    const mean = volumeMm3 / list.length
    // Repeated bodies within 1 % of each other are one design cast N times.
    const identical =
      list.length > 1 && list.every((p) => Math.abs(p.volumeMm3 - mean) <= mean * 0.01)
    const first = list[0]!
    return {
      key: first.nodeId,
      name: first.name,
      parts: list,
      count: identical ? list.length : 1,
      identical,
      volumeMm3,
    }
  })
}

/** Where the fineness and maker's marks go, unless the designer said. */
export function stampLocation(ctx: PackageContext): string {
  return (
    ctx.input.options.marks?.location ??
    (ctx.facts.ring ? 'Inside shank at base' : 'Back of body, lower centre')
  )
}
