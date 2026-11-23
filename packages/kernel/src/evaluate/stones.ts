/** Turns placed stones into public, instanced `StoneInstance`s and the stone report. */
import { type Design, gemCarat } from '@pave/schema'
import type { NodeResult, SceneStone } from '../core'
import { gemUnit } from '../gems/index'
import { frameMatrix } from '../geometry/vec'
import type { MeshData, StoneInstance, StoneLot } from '../types'

/** Setting style of every gem held by a `setting` node. */
function heldBy(design: Design): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of Object.values(design.nodes))
    if (node.kind === 'setting' && node.visible) map.set(node.gem, node.style)
  return map
}

export function instanceStones(
  design: Design,
  active: readonly NodeResult[],
): { stones: SceneStone[]; gemMeshes: Record<string, MeshData> } {
  const held = heldBy(design)
  const stones: SceneStone[] = []
  const gemMeshes: Record<string, MeshData> = {}
  for (const result of active) {
    result.stones.forEach((stone, index) => {
      const unit = gemUnit(stone.cut, stone.dims.length / stone.dims.width)
      gemMeshes[unit.key] ??= unit.mesh
      stones.push({
        stone,
        instance: {
          id: `${result.id}:${index}`,
          nodeId: result.id,
          cut: stone.cut,
          stone: stone.stone,
          dims: stone.dims,
          carat: gemCarat(stone.cut, stone.dims, stone.stone),
          meshKey: unit.key,
          matrix: [
            ...frameMatrix(stone.frame, [
              stone.dims.width,
              stone.dims.length / unit.length,
              stone.dims.depth / unit.depth,
            ]),
          ],
          role: stone.role,
          setting: held.get(result.id) ?? stone.setting,
        },
      })
    })
  }
  // Among individually placed gems the largest are the centre stones; the rest flank them.
  const singles = stones.filter((s) => s.instance.role === 'center')
  const widest = Math.max(0, ...singles.map((s) => s.stone.dims.width))
  for (const s of singles) if (s.stone.dims.width < widest * 0.95) s.instance.role = 'side'
  return { stones, gemMeshes }
}

/** Groups stones into the parcels a setter or buyer thinks in. Sizes are rounded to 0.01 mm. */
export function stoneLots(stones: readonly StoneInstance[]): StoneLot[] {
  const lots = new Map<string, StoneLot>()
  for (const s of stones) {
    const width = Math.round(s.dims.width * 100) / 100
    const length = Math.round(s.dims.length * 100) / 100
    const key = [s.cut, s.stone, width, length, s.setting, s.role].join('|')
    let lot = lots.get(key)
    if (!lot) {
      lot = {
        cut: s.cut,
        stone: s.stone,
        width,
        length,
        count: 0,
        caratEach: s.carat,
        caratTotal: 0,
        setting: s.setting,
        role: s.role,
        nodeIds: [],
      }
      lots.set(key, lot)
    }
    lot.count++
    lot.caratTotal += s.carat
    if (!lot.nodeIds.includes(s.nodeId)) lot.nodeIds.push(s.nodeId)
  }
  for (const lot of lots.values()) lot.caratEach = lot.caratTotal / lot.count
  return [...lots.values()]
}
