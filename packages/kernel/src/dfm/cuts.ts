/**
 * Cutters that go too far: an engraving or seat that cuts through to the other side of a wall
 * or splits metal off, and seats sunk so close to an edge that the wall beside the stone is
 * thinner than a setter needs.
 */
import { isImportReference } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import type { Scene, SceneStone } from '../core'
import { activeResults } from '../evaluate/assemble'
import { cutTargets, importSeatMatches, settingsByGem } from '../evaluate/import-seats'
import { fromFrame } from '../geometry/vec'
import { runtime } from '../runtime/index'
import { boundsOfPositions, boundsOverlap } from '../solid/meshing'
import type { Bounds, Diagnostic } from '../types'
import type { DfmProfile } from './profile'
import { explainedBy, stoneName } from './subjects'

const centre = (b: Bounds): [number, number, number] => [
  (b.min[0] + b.max[0]) / 2,
  (b.min[1] + b.max[1]) / 2,
  (b.min[2] + b.max[2]) / 2,
]

/** Settings whose stones sit in a seat cut into metal, so metal must surround the seat. */
const SEATED = new Set(['pave', 'channel', 'flush', 'bar'])

/**
 * Number of separate pieces of metal (decompose, then free the pieces). A cutter wholly inside
 * the metal leaves an internal void, whose surface decomposes as a shell of negative volume:
 * that is not metal cut off, so only shells enclosing metal count.
 */
function shellCount(m: Manifold): number {
  const pieces = m.decompose()
  let count = 0
  for (const p of pieces) {
    if (p.volume() > 1e-3) count++
    p.delete()
  }
  return count
}

/**
 * Cuts that change the topology of what they cut: metal cut free (more shells), or, for an
 * engraving, a hole right through (higher genus). Each body's cutters are applied together, as
 * production assembly does, so a pavé field costs one boolean per body.
 */
function breakthroughs(scene: Scene): Diagnostic[] {
  const { manifold: mf } = runtime()
  const out: Diagnostic[] = []
  const results = [...scene.nodes.values()].filter(
    (r) => r.status === 'ok' && r.node.visible && !isImportReference(r.node),
  )
  const active = new Set(activeResults(scene.design, scene.nodes))
  const settings = settingsByGem(results)
  const cutters = results.flatMap((r) =>
    r.cuts
      .filter((cut) => !cut.importSeatGem || active.has(r))
      .map((cut) => ({
        owner: r,
        cut,
        targets: cutTargets(cut, scene.design, settings),
        box: cut.solid.bounds(),
      })),
  )
  for (const host of results)
    for (const body of host.bodies) {
      const box = body.solid.bounds()
      const aimed = cutters.filter(
        (c) =>
          (c.cut.importSeatGem
            ? c.targets !== 'all' && importSeatMatches(c.owner, host.id, body, c.targets)
            : c.owner.id !== host.id && (c.targets === 'all' || c.targets.includes(host.id))) &&
          boundsOverlap(c.box, box),
      )
      for (const engraving of [true, false]) {
        const group = aimed.filter((c) => (c.owner.node.kind === 'engraving') === engraving)
        if (group.length === 0) continue
        const before = body.solid.manifold(scene.quality)
        const tool = mf.Manifold.union(group.map((c) => c.cut.solid.manifold(scene.quality)))
        const after = before.subtract(tool)
        try {
          const split = shellCount(after) > shellCount(before)
          if (!split && !(engraving && after.genus() > before.genus())) continue
          const first = group[0]!
          out.push({
            level: 'error',
            code: engraving ? 'engraving.through' : 'seat.through',
            nodeId: first.owner.id,
            message: split
              ? `Cutting into “${host.node.name ?? host.id}” cuts a piece of it clean off.`
              : `The engraving cuts right through “${host.node.name ?? host.id}”; make it shallower or the wall thicker.`,
            at: centre(first.box),
            related: [host.id],
          })
        } finally {
          tool.delete()
          after.delete()
        }
      }
    }
  return out
}

/** Probe points around a seated stone, `wall` outside its girdle, a little below it. */
function wallProbe(stone: SceneStone, wall: number): [number, number, number][] {
  const { dims, frame } = stone.stone
  const points: [number, number, number][] = []
  for (const depth of [0.1, 0.3])
    for (let i = 0; i < 16; i++) {
      const a = (2 * Math.PI * i) / 16
      const p = fromFrame(frame, [
        (dims.width / 2 + wall) * Math.cos(a),
        (dims.length / 2 + wall) * Math.sin(a),
        -depth * dims.depth,
      ])
      points.push([p[0], p[1], p[2]])
    }
  return points
}

/**
 * Inside a closed mesh: a ray from the point crosses its surface an odd number of times. Exact
 * parity, not a nearest-face test: the probes sit at seat rims, on sharp edges.
 */
const inside = (m: Manifold, p: readonly number[]) =>
  m.rayCast([p[0]!, p[1]!, p[2]!], [p[0]!, p[1]!, p[2]! + 1e3]).length % 2 === 1

/**
 * Seated stones need `seatWall` of metal all round; neighbouring seats may share theirs. One
 * diagnostic per node, naming how many of its stones are short and where the worst one is.
 */
function seatWalls(scene: Scene, profile: DfmProfile): Diagnostic[] {
  // No seat wall to measure where the seats were never cut (a pavé too large to cut) or there
  // is no metal at all (a flush setting with nothing to sink into): both are reported already.
  const uncut = explainedBy(scene, 'pave.tooLarge')
  const bare = explainedBy(scene, 'setting.noHost')
  const seated = scene.stones.filter(
    (s) =>
      SEATED.has(s.instance.setting) &&
      !uncut.has(s.instance.nodeId) &&
      !bare.has(s.instance.nodeId),
  )
  if (seated.length === 0 || scene.detail !== 'production') return []
  const short = new Map<string, { count: number; worst: SceneStone; open: number }>()
  // Neighbours from a hash grid: testing every probe against every stone was 300 million tests
  // on a 3 000-stone pavé. A cell holds the reach of the largest seat, so a probe's neighbours
  // are in its own cell or the 26 around it.
  const reach = seated.reduce(
    (r, s) => Math.max(r, s.stone.dims.length / 2 + profile.seatWall + s.stone.dims.depth),
    1e-3,
  )
  const cellOf = (p: readonly number[]) => p.map((v) => Math.floor(v / reach))
  const grid = new Map<string, SceneStone[]>()
  for (const s of seated) {
    const key = cellOf(s.stone.frame.origin).join(',')
    grid.set(key, [...(grid.get(key) ?? []), s])
  }
  const around = (p: readonly number[]): SceneStone[] => {
    const [x, y, z] = cellOf(p) as [number, number, number]
    const out: SceneStone[] = []
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          out.push(...(grid.get(`${x + dx},${y + dy},${z + dz}`) ?? []))
    return out
  }
  for (const stone of seated) {
    const neighbourSeat = (p: readonly number[]) =>
      around(p).some((other) => {
        if (other === stone) return false
        const f = other.stone.frame
        const d = [p[0]! - f.origin[0], p[1]! - f.origin[1], p[2]! - f.origin[2]]
        const along = d[0]! * f.z[0] + d[1]! * f.z[1] + d[2]! * f.z[2]
        const radial = Math.hypot(
          d[0]! - along * f.z[0],
          d[1]! - along * f.z[1],
          d[2]! - along * f.z[2],
        )
        return radial < other.stone.dims.length / 2 + profile.seatWall
      })
    const probe = wallProbe(stone, profile.seatWall).filter((p) => !neighbourSeat(p))
    if (probe.length === 0) continue
    const reach = boundsOfPositions(new Float32Array(probe.flat()))
    const metal = scene.parts.filter((part) => part.fused && boundsOverlap(part.part.bounds, reach))
    const open =
      probe.filter((p) => !metal.some((part) => inside(part.fused!.manifold(scene.quality), p)))
        .length / probe.length
    if (open <= 1 / 8) continue
    const node = stone.instance.nodeId
    const entry = short.get(node)
    if (!entry) short.set(node, { count: 1, worst: stone, open })
    else {
      entry.count++
      if (open > entry.open) Object.assign(entry, { worst: stone, open })
    }
  }
  return [...short].map(([nodeId, { count, worst }]) => ({
    level: 'warning' as const,
    code: 'seat.wall',
    nodeId,
    message: `${count === 1 ? `${stoneName(scene, worst.instance)} has` : `${count} stones (worst: ${stoneName(scene, worst.instance)}) have`} less than ${profile.seatWall} mm of metal beside their seats; move them in from the edge or use smaller stones.`,
    at: [...worst.stone.frame.origin] as [number, number, number],
    related: [worst.instance.id],
    value: count,
    limit: profile.seatWall,
  }))
}

export const cutChecks = (scene: Scene, profile: DfmProfile): Diagnostic[] =>
  scene.detail === 'production' ? [...breakthroughs(scene), ...seatWalls(scene, profile)] : []
