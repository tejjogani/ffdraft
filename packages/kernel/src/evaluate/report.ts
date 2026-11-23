/** Facts about the evaluated piece: metal per alloy, stones, size. */
import { type Design, type MetalId, metalMassG, ringInnerDiameter } from '@pave/schema'
import type { ScenePart, SceneStone } from '../core'
import { gemUnit } from '../gems/index'
import { fromFrame } from '../geometry/vec'
import { unionBounds } from '../solid/meshing'
import type { Bounds, Report } from '../types'
import { stoneLots } from './stones'

/** A box around a stone: girdle rectangle swept from culet to table. */
function stoneBounds({ stone }: SceneStone): Bounds {
  const unit = gemUnit(stone.cut, stone.dims.length / stone.dims.width)
  const top = (unit.top / unit.depth) * stone.dims.depth
  const bottom = (unit.bottom / unit.depth) * stone.dims.depth
  const corners = [-1, 1].flatMap((sx) =>
    [-1, 1].flatMap((sy) =>
      [bottom, top].map((z) =>
        fromFrame(stone.frame, [(sx * stone.dims.width) / 2, (sy * stone.dims.length) / 2, z]),
      ),
    ),
  )
  return {
    min: [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k]!))) as Bounds['min'],
    max: [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k]!))) as Bounds['max'],
  }
}

export function buildReport(
  design: Design,
  parts: readonly ScenePart[],
  stones: readonly SceneStone[],
): Report {
  const volumes = new Map<MetalId, number>()
  for (const { part } of parts)
    volumes.set(part.material, (volumes.get(part.material) ?? 0) + part.volumeMm3)
  const metals = [...volumes].map(([material, volumeMm3]) => ({
    material,
    volumeMm3,
    massG: metalMassG(material, volumeMm3),
  }))
  const lots = stoneLots(stones.map((s) => s.instance))
  const shank = design.order
    .map((id) => design.nodes[id])
    .find((n) => n?.kind === 'ringShank' && n.visible)
  return {
    metals,
    metalMassG: metals.reduce((sum, m) => sum + m.massG, 0),
    lots,
    stoneCount: stones.length,
    caratTotal: lots.reduce((sum, l) => sum + l.caratTotal, 0),
    bounds: unionBounds([...parts.map((p) => p.part.bounds), ...stones.map(stoneBounds)]),
    ...(shank?.kind === 'ringShank' ? { ringInnerDiameter: ringInnerDiameter(shank.size) } : {}),
  }
}
