/** Facts about the evaluated piece: metal per alloy, stones, size. */
import { type Design, type MetalId, metalMassG, ringInnerDiameter } from '@pave/schema'
import type { ScenePart, SceneStone } from '../core'
import { gemUnit } from '../gems/index'
import { fromFrame, transformPoint } from '../geometry/vec'
import { unionBounds } from '../solid/meshing'
import type { Bounds, Report } from '../types'
import { stoneLots } from './stones'

/** A box around a stone: girdle rectangle swept from culet to table. */
function stoneBounds({ instance, stone }: SceneStone): Bounds {
  if (stone.imported) {
    const { positions } = stone.imported.mesh
    const min: Bounds['min'] = [Infinity, Infinity, Infinity]
    const max: Bounds['max'] = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < positions.length; i += 3) {
      const point = transformPoint(instance.matrix, [
        positions[i]!,
        positions[i + 1]!,
        positions[i + 2]!,
      ])
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis]!, point[axis]!)
        max[axis] = Math.max(max[axis]!, point[axis]!)
      }
    }
    return { min, max }
  }
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
  /** The metal each part adds, when that is not its own volume (draft: see `draftVolumes`). */
  adds: readonly number[] = parts.map((p) => p.part.volumeMm3),
): Report {
  const volumes = new Map<MetalId, number>()
  parts.forEach(({ part }, i) => {
    volumes.set(part.material, (volumes.get(part.material) ?? 0) + adds[i]!)
  })
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
