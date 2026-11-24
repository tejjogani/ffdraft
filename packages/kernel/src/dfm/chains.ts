/**
 * A chain through a bail: the bail's clear hole — measured from its metal, not read off its
 * nominal opening — must pass the chain with the bail rule's clearance both ways, and the chain
 * as built must not run through the bail's metal.
 */
import type { NodeOf } from '@pave/schema'
import type { NodeResult, Scene } from '../core'
import { bailGeometry } from '../features/bail'
import type { ChainData } from '../features/chain'
import { type ChainSection, clearSpan, holeProfile, seatHeight } from '../features/chain/seat'
import { transformFrame } from '../geometry/vec'
import { runtime } from '../runtime/index'
import type { Diagnostic } from '../types'
import type { DfmProfile } from './profile'

/** Overlap below this is tessellation noise, not a clash (mm³). */
const CLASH_MM3 = 1e-3

const mm = (v: number) => v.toFixed(1)

/** Largest opening the bail schema allows, mm. */
const MAX_OPENING = 20

/**
 * The least opening (to 0.1 mm) at which the bail, rebuilt by its own builder on its host,
 * passes the chain's section with the rule's clearance — found by bisection on the real hole,
 * because a bail's hole does not grow in proportion to its opening (its wire, its stem and its
 * footing do not scale). Null when even the largest opening does not pass.
 */
function openingThatFits(
  bail: NodeResult,
  scene: Scene,
  section: ChainSection,
  spare: number,
): number | null {
  const node = bail.node as NodeOf<'bail'>
  const host = node.host ? scene.nodes.get(node.host) : undefined
  const hostSolids = host?.status === 'ok' ? host.bodies.map((b) => b.solid) : []
  const metal = bail.bodies[0]
  if (!metal) return null
  const need = { ...section, up: section.up + spare, across: section.across + spare }
  const passes = (opening: number) => {
    const built = bailGeometry({ ...node, opening }, hostSolids)
    const placed = built.solids.map((s) => s.transformed(bail.matrix))
    try {
      const frame = transformFrame(bail.matrix, {
        origin: built.opening,
        x: [1, 0, 0],
        y: [0, 1, 0],
        z: [0, 0, 1],
      })
      const hole = holeProfile(
        placed.map((solid) => ({ ...metal, solid })),
        frame,
        scene.quality,
      )
      return hole !== null && seatHeight(hole, need, 0, 0) !== null
    } finally {
      for (const s of [...built.solids, ...placed]) s.dispose()
    }
  }
  if (!passes(MAX_OPENING)) return null
  let lo = node.opening
  let hi = MAX_OPENING
  while (hi - lo > 0.05) {
    const mid = (lo + hi) / 2
    if (passes(mid)) hi = mid
    else lo = mid
  }
  return Math.min(MAX_OPENING, Math.ceil(hi * 10) / 10)
}

export function chainChecks(scene: Scene, profile: DfmProfile): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const result of scene.nodes.values()) {
    const node = result.node
    if (result.status !== 'ok' || !node.visible || node.kind !== 'chain' || !node.through) continue
    const bail = scene.nodes.get(node.through)
    const opening = bail?.frames.opening
    // A hidden bail is not part of the piece, so there is nothing for the chain to pass.
    if (bail?.status !== 'ok' || !bail.node.visible || bail.node.kind !== 'bail' || !opening)
      continue
    const { section } = result.data as ChainData
    const hole = holeProfile(bail.bodies, opening, scene.quality)
    // How far the chain's section, with the rule's clearance all round, must shrink to pass the
    // hole (reported as the check's value; the fix is measured on the rebuilt bail).
    const spare = profile.bailClearance / 2
    const fits = (scale: number) =>
      hole !== null &&
      seatHeight(
        hole,
        { ...section, up: (section.up + spare) * scale, across: (section.across + spare) * scale },
        0,
        0,
      ) !== null
    let fit = fits(1) ? 1 : 0
    if (fit === 0) {
      let hi = 1
      for (let i = 0; i < 16; i++) {
        const mid = (fit + hi) / 2
        if (fits(mid)) fit = mid
        else hi = mid
      }
    }
    if (fit < 1) {
      const clear = hole ? clearSpan(hole) : { height: 0, width: 0 }
      const wider = openingThatFits(bail, scene, section, spare)
      out.push({
        level: 'error',
        code: 'bail.small',
        nodeId: bail.id,
        message: `The bail's hole (${mm(clear.height)} mm high, ${mm(clear.width)} mm at its widest) does not pass the ${mm(2 * section.up)} × ${mm(2 * section.across)} mm chain with ${profile.bailClearance} mm to spare.${wider === null ? ' No bail opening up to 20 mm passes it: use a narrower chain or another bail style.' : ''}`,
        value: fit,
        limit: 1,
        ...(wider === null
          ? {}
          : {
              fix: {
                label: `Open the bail to ${wider} mm`,
                ops: [{ t: 'update' as const, id: bail.id, patch: { opening: wider } }],
              },
            }),
      })
    }
    if (scene.detail !== 'production') continue
    // The chain must clear the bail's metal and the piece the bail hangs (a chain is threaded
    // on after casting, so an overlap is metal that cannot be there).
    const hostId = bail.node.host
    const host = hostId ? scene.nodes.get(hostId) : undefined
    const against = [
      {
        bodies: bail.bodies,
        what: "the bail's metal",
        fix: 'use a larger or rounder bail, or a narrower chain',
      },
      ...(host?.status === 'ok' && host.bodies.length > 0
        ? [{ bodies: host.bodies, what: 'the pendant', fix: 'raise the bail or use a finer chain' }]
        : []),
    ]
    const { manifold: mf } = runtime()
    const a = mf.Manifold.union(result.bodies.map((b) => b.solid.manifold(scene.quality)))
    try {
      for (const { bodies, what, fix } of against) {
        const b = mf.Manifold.union(bodies.map((x) => x.solid.manifold(scene.quality)))
        const overlap = a.intersect(b)
        try {
          const volume = overlap.volume()
          if (volume > CLASH_MM3) {
            const box = overlap.boundingBox()
            out.push({
              level: 'error',
              code: 'chain.clash',
              nodeId: node.id,
              message: `The chain runs through ${what} (${volume.toFixed(2)} mm³ overlap): ${fix}.`,
              at: [0, 1, 2].map((k) => (box.min[k]! + box.max[k]!) / 2) as [number, number, number],
              value: volume,
              limit: 0,
            })
          }
        } finally {
          overlap.delete()
          b.delete()
        }
      }
    } finally {
      a.delete()
    }
  }
  return out
}
