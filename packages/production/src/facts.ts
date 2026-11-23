/**
 * Piece facts: the design parameters and evaluated quantities every part of the package talks
 * about (ring size, band, centre stone, bail, marks, findings), resolved once so the drawings,
 * spec sheet, BOM, DFM report and RFQ cannot disagree.
 */
import type { Bounds, Evaluation, Part, StoneInstance } from '@pave/kernel/types'
import {
  type Design,
  formatRingSize,
  type GemDims,
  gemDims,
  type NodeKind,
  type NodeOf,
  type RingSizeSystem,
  ringInnerDiameter,
  ringSizeFromDiameter,
} from '@pave/schema'

export interface RingFacts {
  node: NodeOf<'ringShank'>
  innerDiameter: number
  /** "US 6", "UK L½", "EU 52" — the node's own system is exact, the others are nearest sizes. */
  sizes: Record<'us' | 'uk' | 'eu', string>
}

export interface StoneFacts {
  node: NodeOf<'gem'>
  instance?: StoneInstance
  dims: GemDims
  carat?: number
}

export interface PieceFacts {
  ring?: RingFacts
  centre?: StoneFacts
  /** `built` is false when the kernel reported it could not build the bail. */
  bail?: { node: NodeOf<'bail'>; part?: Part; built: boolean }
  /** The body a pendant hangs from (the bail's host), when it is its own part. */
  body?: Part
  settings: NodeOf<'setting'>[]
  engravings: NodeOf<'engraving'>[]
  findings: NodeOf<'finding'>[]
  chains: NodeOf<'chain'>[]
  paves: NodeOf<'pave'>[]
  /** Nodes the kernel reported it could not build (feature.unsupported / blocked / failed). */
  missing: Set<string>
  bounds: Bounds
  /** Overall extents along X, Y, Z in mm. */
  extent: [number, number, number]
}

const MISSING = new Set(['feature.unsupported', 'feature.blocked', 'feature.failed'])

function nodesOf<K extends NodeKind>(design: Design, kind: K): NodeOf<K>[] {
  return design.order
    .map((id) => design.nodes[id])
    .filter((n): n is NodeOf<K> => n?.kind === kind && n.visible !== false)
}

export function pieceFacts(design: Design, evaluation: Evaluation): PieceFacts {
  const shank = nodesOf(design, 'ringShank')[0]
  const gems = nodesOf(design, 'gem')
  const bailNode = nodesOf(design, 'bail')[0]
  const bounds = evaluation.report.bounds
  const missing = new Set(
    evaluation.diagnostics.filter((d) => MISSING.has(d.code) && d.nodeId).map((d) => d.nodeId!),
  )
  const built = <T extends { id: string }>(list: T[]) => list.filter((n) => !missing.has(n.id))

  const ring = shank ? ringFacts(shank, evaluation.report.ringInnerDiameter) : undefined
  const centreNode =
    gems.find((g) => evaluation.stones.some((s) => s.nodeId === g.id && s.role === 'center')) ??
    gems[0]
  const centre = centreNode ? stoneFacts(centreNode, evaluation) : undefined
  const partOf = (nodeId?: string) => evaluation.parts.find((p) => p.nodeId === nodeId)
  const bailPart = partOf(bailNode?.id)

  return {
    ...(ring ? { ring } : {}),
    ...(centre ? { centre } : {}),
    ...(bailNode
      ? {
          bail: {
            node: bailNode,
            built: !missing.has(bailNode.id),
            ...(bailPart ? { part: bailPart } : {}),
          },
        }
      : {}),
    ...(bailNode?.host && partOf(bailNode.host) ? { body: partOf(bailNode.host)! } : {}),
    settings: nodesOf(design, 'setting'),
    engravings: nodesOf(design, 'engraving'),
    findings: built(nodesOf(design, 'finding')),
    chains: built(nodesOf(design, 'chain')),
    paves: nodesOf(design, 'pave'),
    missing,
    bounds,
    extent: [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ],
  }
}

function ringFacts(node: NodeOf<'ringShank'>, evaluated?: number): RingFacts {
  const innerDiameter = evaluated ?? ringInnerDiameter(node.size)
  const label = (system: RingSizeSystem) =>
    formatRingSize(
      node.size.system === system ? node.size : ringSizeFromDiameter(innerDiameter, system),
    )
  return { node, innerDiameter, sizes: { us: label('us'), uk: label('uk'), eu: label('eu') } }
}

function stoneFacts(node: NodeOf<'gem'>, evaluation: Evaluation): StoneFacts {
  const instance = evaluation.stones.find((s) => s.nodeId === node.id)
  return {
    node,
    ...(instance ? { instance, carat: instance.carat } : {}),
    dims: instance?.dims ?? gemDims(node.cut, node.width, node.lw),
  }
}
