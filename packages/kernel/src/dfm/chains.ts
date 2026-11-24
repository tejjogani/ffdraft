/**
 * A chain through a bail: the bail's clear hole — measured from its metal, not read off its
 * nominal opening — must pass the chain with the bail rule's clearance both ways, and the chain
 * as built must not run through the bail's metal.
 */
import type { Scene } from '../core'
import type { ChainData } from '../features/chain'
import { clearSpan, holeProfile, seatHeight } from '../features/chain/seat'
import { runtime } from '../runtime/index'
import type { Diagnostic } from '../types'
import type { DfmProfile } from './profile'

/** Overlap below this is tessellation noise, not a clash (mm³). */
const CLASH_MM3 = 1e-3

const mm = (v: number) => v.toFixed(1)

export function chainChecks(scene: Scene, profile: DfmProfile): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const result of scene.nodes.values()) {
    const node = result.node
    if (result.status !== 'ok' || node.kind !== 'chain' || !node.through) continue
    const bail = scene.nodes.get(node.through)
    const opening = bail?.frames.opening
    if (bail?.status !== 'ok' || bail.node.kind !== 'bail' || !opening) continue
    const { section } = result.data as ChainData
    const hole = holeProfile(bail.bodies, opening, scene.quality)
    // How far the chain's section, with the rule's clearance all round, must shrink to pass the
    // hole; below 1 the bail, whose hole grows with its opening, must open up by the inverse.
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
      // The opening scales the whole bail, so it grows by the inverse of the fit.
      const wider = Math.min(20, Math.ceil((bail.node.opening / Math.max(fit, 0.05)) * 10) / 10)
      out.push({
        level: 'error',
        code: 'bail.small',
        nodeId: bail.id,
        message: `The bail's hole (${mm(clear.height)} mm high, ${mm(clear.width)} mm at its widest) does not pass the ${mm(2 * section.up)} × ${mm(2 * section.across)} mm chain with ${profile.bailClearance} mm to spare.`,
        value: fit,
        limit: 1,
        fix: {
          label: `Open the bail to ${wider} mm`,
          ops: [{ t: 'update', id: bail.id, patch: { opening: wider } }],
        },
      })
    }
    if (scene.detail !== 'production') continue
    const { manifold: mf } = runtime()
    const a = mf.Manifold.union(result.bodies.map((b) => b.solid.manifold(scene.quality)))
    const b = mf.Manifold.union(bail.bodies.map((b) => b.solid.manifold(scene.quality)))
    const overlap = a.intersect(b)
    try {
      const volume = overlap.volume()
      if (volume > CLASH_MM3) {
        const box = overlap.boundingBox()
        out.push({
          level: 'error',
          code: 'chain.clash',
          nodeId: node.id,
          message: `The chain runs through the bail's metal (${volume.toFixed(2)} mm³ overlap): use a larger or rounder bail, or a narrower chain.`,
          at: [0, 1, 2].map((k) => (box.min[k]! + box.max[k]!) / 2) as [number, number, number],
          value: volume,
          limit: 0,
        })
      }
    } finally {
      for (const m of [overlap, a, b]) m.delete()
    }
  }
  return out
}
