/**
 * Minimum sizes read straight from node parameters, for the kinds whose features do not check
 * them while building (settings report their own claws and bezels).
 */
import type { Scene } from '../core'
import type { ChainData } from '../features/chain'
import type { Diagnostic } from '../types'
import type { DfmProfile } from './profile'

const fmt = (v: number) => v.toFixed(2)

export function sizeChecks(scene: Scene, profile: DfmProfile): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const result of scene.nodes.values()) {
    const node = result.node
    if (result.status !== 'ok' || !node.visible) continue
    const thin = (
      level: Diagnostic['level'],
      code: string,
      what: string,
      value: number,
      limit: number,
    ) =>
      out.push({
        level,
        code,
        nodeId: node.id,
        message: `${what} is ${fmt(value)} mm; use ${fmt(limit)} mm or more.`,
        value,
        limit,
      })
    switch (node.kind) {
      case 'chain': {
        // The wire as built: the chain thins a wire too heavy for its links.
        const { wire } = result.data as ChainData
        if (node.style === 'tennis') {
          const prong = profile.accentProng(result.stones[0]?.dims.width ?? node.linkWidth)
          if (wire < prong) thin('warning', 'prong.small', 'The tennis prong wire', wire, prong)
        } else if (wire < profile.chainWire)
          thin(
            'info',
            'chain.fine',
            'The chain wire (fine chain is bought, not cast)',
            wire,
            profile.chainWire,
          )
        break
      }
      case 'finding':
        if (node.type === 'earringPost' && node.wire < profile.postWire.warn)
          thin(
            node.wire < profile.postWire.error ? 'error' : 'warning',
            'post.thin',
            'The earring post',
            node.wire,
            profile.postWire.warn,
          )
        if (
          (node.type === 'jumpRing' || node.type === 'lobsterClasp') &&
          node.wire < profile.ringWire
        )
          thin('warning', 'ring.thin', 'The ring wire', node.wire, profile.ringWire)
        break
      case 'bail':
        if (node.wire < profile.bailWire)
          thin('warning', 'bail.thin', 'The bail wire', node.wire, profile.bailWire)
        break
    }
  }
  return out
}
