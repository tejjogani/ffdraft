import { createHash } from 'node:crypto'
import { readRhino3dm } from '@pave/kernel/rhino-import'
import type { Asset, MountCage, NodeInput } from '@pave/schema'
import type { Brep, RhinoModule } from 'rhino3dm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { parseStl } from '../../../packages/kernel/src/mesh/parse/stl'
import { archive, handles } from '../../../packages/kernel/src/qa/rhino-archive'
import { loadRhino3dm } from '../../../packages/kernel/src/runtime/rhino'
import { makeCappedPrismFixture } from '../../../packages/kernel/test-fixtures/capped-prism'
import { assetBytes, engineServer } from './test/engines'
import { BOOT_TIMEOUT, type Client, client, type TestServer } from './test/harness'

type Point = [number, number, number]
const point = (v: readonly number[]): Point => [v[0]!, v[1]!, v[2]!]
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const mountIds = ['mount-a', 'mount-b']
const names = ['Sleeve', 'Upper pierced gallery', 'Original centre stone'] as const
const girdle: Point = [4, 0.25, 2.75]
const beforeFit = { width: 5, length: 6, depth: 3 }
const afterFit = { width: 5.5, length: 7.2, depth: 3.3 }

let server: TestServer
let api: Client
let rhino: RhinoModule

beforeAll(async () => {
  ;[server, rhino] = await Promise.all([engineServer({ config: { plan: 'pro' } }), loadRhino3dm()])
  api = client(server)
}, BOOT_TIMEOUT)
afterAll(() => server?.dispose())

async function assemblyFixture() {
  return archive(rhino, await makeCappedPrismFixture(), (doc, hold) => {
    const objects = hold(doc.objects())
    const existing = hold(objects.get(0))
    const original = hold(existing.geometry())
    const attrs = hold(new rhino.ObjectAttributes())
    attrs.name = names[1]!
    // Different diameter, bore, axial length and source placement.
    const upper = hold(original.duplicate())
    const scaleAndMove = hold(
      Object.assign(rhino.Transform.identity(), {
        m00: 1.25,
        m11: 1.25,
        m22: 1.25,
        m03: 9,
        m13: 0.75,
        m23: 0.5,
      }),
    )
    if (!(upper instanceof rhino.Brep) || !upper.transform(scaleAndMove))
      throw Error('Could not place the second native gallery.')
    objects.addBrep(upper, attrs)

    const stone = hold(new rhino.Mesh())
    const vertices = hold(stone.vertices())
    for (const [dx, dy, dz] of [
      [-2.5, 0, 0],
      [0, -3, 0],
      [2.5, 0, 0],
      [0, 3, 0],
      [0, 0, -2.5],
      [0, 0, 0.5],
    ] as Point[])
      vertices.add(girdle[0] + dx, girdle[1] + dy, girdle[2] + dz)
    const faces = hold(stone.faces())
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      faces.addTriFace(i, j, 5)
      faces.addTriFace(j, i, 4)
    }
    attrs.name = names[2]!
    objects.addMesh(stone, attrs)
    expect(objects.count).toBe(3)
    return doc.toByteArray().slice()
  })
}

function solidReadback(solid: Brep, place: (p: Point) => Point) {
  return handles((hold) => {
    expect(solid.isValid && solid.isSolid && solid.isManifold).toBe(true)
    const faces = hold(solid.faces())
    const edges = hold(solid.edges())
    return {
      faceLoops: Array.from({ length: faces.count }, (_, i) =>
        handles((take) => take(take(faces.get(i)).loops).count),
      ),
      edges: Array.from({ length: edges.count }, (_, i) =>
        handles((take) => {
          const edge = take(edges.get(i))
          const nurbs = take(edge.toNurbsCurve())
          const curve = nurbs ?? edge
          const [a, b] = curve.domain as [number, number]
          return {
            closed: edge.isClosed,
            curved: !edge.isLinear(),
            points: [0, 0.11, 0.23, 0.38, 0.5, 0.71, 0.86, 1].map((t) =>
              place(point(curve.pointAt(a + t * (b - a)))),
            ),
          }
        }),
      ),
    }
  })
}

function readExchange(bytes: Uint8Array, key: 'source' | 'node') {
  return archive(rhino, bytes, (doc, hold) => {
    expect(hold(doc.settings()).modelUnitSystem).toBe(rhino.UnitSystem.Millimeters)
    const objects = hold(doc.objects())
    const defs = hold(doc.instanceDefinitions())
    const solids = new Map<string, ReturnType<typeof solidReadback>>()
    const meshes = new Map<string, { points: Point[]; closed: boolean; triangleCount: number }>()
    const alloys = new Map<string, string>()
    for (let i = 0; i < objects.count; i++)
      handles((take) => {
        const object = take(objects.get(i))
        const attrs = take(object.attributes())
        if (attrs.isInstanceDefinitionObject) return
        const id = key === 'source' ? attrs.name : attrs.getUserString('nodeIds')
        if (!id) return
        expect(alloys.has(id), 'Each selected member needs its own identity in the archive.').toBe(
          false,
        )
        alloys.set(id, attrs.getUserString('alloy'))
        let geometry = take(object.geometry())
        let place = (p: Point): Point => p
        if (geometry instanceof rhino.InstanceReference) {
          const transform = take(geometry.xform)
          const definition = take(defs.findId(geometry.parentIdefId))
          const members = definition.getObjectIds() as string[]
          expect(members).toHaveLength(1)
          geometry = take(take(objects.findId(members[0]!)).geometry())
          place = ([x, y, z]) => [
            transform.m00 * x + transform.m01 * y + transform.m02 * z + transform.m03,
            transform.m10 * x + transform.m11 * y + transform.m12 * z + transform.m13,
            transform.m20 * x + transform.m21 * y + transform.m22 * z + transform.m23,
          ]
        }
        if (geometry instanceof rhino.Brep) solids.set(id, solidReadback(geometry, place))
        if (geometry instanceof rhino.Mesh) {
          const vertices = take(geometry.vertices())
          meshes.set(id, {
            points: Array.from({ length: vertices.count }, (_, p) => place(point(vertices.get(p)))),
            closed: geometry.isClosed,
            triangleCount: take(geometry.faces()).count,
          })
        }
      })
    return { solids, meshes, alloys }
  })
}

async function upload(
  target: Client,
  bytes: Uint8Array,
  mime: string,
  name: string,
): Promise<Asset> {
  const form = new FormData()
  form.append('file', new Blob([Uint8Array.from(bytes)], { type: mime }), name)
  const result = await target.request('/api/assets', { method: 'POST', body: form })
  if (!result.ok) throw Error(`Upload failed (${result.status}): ${await result.text()}`)
  return result.json() as Promise<Asset>
}

async function importAssembly(bytes: Uint8Array) {
  const { objects } = await readRhino3dm(bytes)
  expect(objects).toHaveLength(3)
  const nodes: NodeInput[] = []
  const immutableSources: { asset: Asset; hash: string }[] = []
  for (const [i, object] of objects.entries()) {
    const id = mountIds[i] ?? 'original-stone'
    const mesh = await upload(api, object.bytes, 'model/stl', `${id}.stl`)
    immutableSources.push({ asset: mesh, hash: digest(object.bytes) })
    const native = object.native
    const retained = native && (await upload(api, native.bytes, 'model/vnd.3dm', `${id}.3dm`))
    if (native && retained) immutableSources.push({ asset: retained, hash: digest(native.bytes) })
    nodes.push({
      id,
      kind: 'meshBody',
      name: object.name,
      keepSourcePlacement: true,
      importRole: 'unassigned',
      source: {
        type: 'asset',
        assetId: mesh.id,
        ...(native &&
          retained && {
            nativeAssetId: retained.id,
            nativeMeshAssetId: mesh.id,
            nativeTransform: native.transform ? [...native.transform] : undefined,
            rhinoObjectId: native.objectId,
            rhinoInstancePath: [...native.instancePath],
          }),
      },
    })
  }
  expect(immutableSources).toHaveLength(5)
  nodes.push(
    {
      id: 'neighbour-gem',
      kind: 'gem',
      width: 2.8,
      transform: { position: [17.5, 0, 3.3], rotation: [0, 0, 0], scale: 1 },
    },
    {
      id: 'neighbour-setting',
      kind: 'setting',
      name: 'Adjacent setting',
      gem: 'neighbour-gem',
      material: 'au18k-rose',
      style: 'bezel',
    },
  )
  const create = async (title: string) => {
    const { id } = await api.call('pieces.create', { title, kind: 'other' })
    await api.call('design.apply', {
      pieceId: id,
      label: 'Import handmade mount and stone',
      ops: nodes.map((node) => ({ t: 'add', node })),
    })
    const plan = await api.call('design.planImportRoles', {
      pieceId: id,
      choices: [
        ...mountIds.map((sourceId) => ({
          sourceId,
          role: 'metal' as const,
          material: 'au18k-yellow' as const,
        })),
        {
          sourceId: 'original-stone',
          role: 'stone',
          stone: {
            ...beforeFit,
            species: 'diamond',
            cut: 'oval',
            girdle,
            rotation: [0, 0, 0],
          },
        },
      ],
    })
    await api.call('design.apply', {
      pieceId: id,
      label: 'Confirm imported metal and stone roles',
      ops: plan.ops,
      baseVersion: plan.version,
    })
    return api.call('pieces.get', { id })
  }
  return { create, immutableSources, objects }
}

async function rhinoOutput(target: Client, pieceId: string) {
  const { asset } = await target.call('design.export', { pieceId, format: '3dm', stones: false })
  return readExchange(await assetBytes(target, asset), 'node')
}

async function portableCopy(receiving: Client, id: string) {
  const saved = await api.call('pieces.saveFile', { id })
  const file = await upload(
    receiving,
    await assetBytes(api, saved.asset),
    'application/octet-stream',
    'mount.pave',
  )
  const { piece } = await receiving.call('pieces.openFile', { assetId: file.id })
  return piece
}

const width = 15.75
const depth = 7.5
const height = 3
const fullBox: { min: Point; max: Point } = { min: [-3, -3, 0], max: [12.75, 4.5, 3] }
const normalized = ([x, y, z]: Point): Point => [(x + 3) / width, (y + 3) / depth, z / height]
const freeform = (p: Point): Point => {
  const [u, v, w] = normalized(p)
  return [p[0] + 1.5 * u * v, p[1], p[2] + 0.6 * v * w]
}
function atPart(center: Point, p: Point): Point {
  // The tangent of u*v and v*w at each part's own geometric centre, in normalized coordinates.
  const [u0, v0, w0] = normalized(center)
  const [u, v, w] = normalized(p)
  return [p[0] + 1.5 * (u0 * v + v0 * u - u0 * v0), p[1], p[2] + 0.6 * (v0 * w + w0 * v - v0 * w0)]
}

function compareSolids(
  original: ReturnType<typeof readExchange>,
  result: ReturnType<typeof readExchange>,
  alloy: string,
  transform: (index: number, p: Point) => Point,
) {
  expect(result.solids.size).toBe(2)
  for (const [i, id] of mountIds.entries()) {
    const before = original.solids.get(names[i]!)!
    const after = result.solids.get(id)
    expect(after, `${id} must remain a native Rhino solid or placed native solid.`).toBeDefined()
    expect(after!.faceLoops).toEqual(before.faceLoops)
    expect(after!.faceLoops.filter((loops) => loops === 2)).toHaveLength(2)
    expect(after!.edges.filter(({ closed, curved }) => closed && curved)).toHaveLength(4)
    expect(result.alloys.get(id)).toBe(alloy)
    expect(after!.edges).toHaveLength(before.edges.length)
    for (const [edge, source] of before.edges.entries()) {
      const current = after!.edges[edge]!
      expect(current.closed).toBe(source.closed)
      expect(current.curved).toBe(source.curved)
      for (const [sample, p] of source.points.entries()) {
        const expected = transform(i, p)
        const actual = current.points[sample]!
        expect(Math.hypot(...expected.map((value, axis) => value - actual[axis]!))).toBeLessThan(
          2e-6,
        )
      }
    }
  }
}

it('round-trips a selected handmade mount with native topology, freeform geometry and measured stone refit', async () => {
  const bytes = await assemblyFixture()
  const ownReadback = readExchange(bytes, 'source')
  const { create, immutableSources, objects } = await importAssembly(bytes)
  const before = await create('Handmade mount exchange')
  const sibling = await create('Other project using the same sources')
  const get = () => api.call('pieces.get', { id: before.id })
  const untouched = (design: typeof before.design) => {
    for (const id of ['neighbour-setting', 'neighbour-gem', 'original-stone'])
      expect(design.nodes[id]).toEqual(before.design.nodes[id])
  }
  const confirmed = Object.values(before.design.nodes).find(
    (node) => node.kind === 'gem' && node.importSourceId === 'original-stone',
  )
  expect(confirmed).toMatchObject({ importSourceFit: { ...beforeFit, cut: 'oval' } })
  const gemId = confirmed!.id
  const beforeExport = await rhinoOutput(api, before.id)
  compareSolids(ownReadback, beforeExport, 'au18k-yellow', (_, p) => p)
  expect(beforeExport.meshes.get('neighbour-setting')?.points.length).toBeGreaterThan(0)
  const selection = { pieceId: before.id, nodeIds: mountIds }
  const inspected = await api.call('design.inspectMount', selection)
  expect(inspected.version).toBe(before.version)
  expect(inspected.parts.every(({ native }) => native)).toBe(true)
  expect(new Set(inspected.parts.map(({ assetId }) => assetId)).size).toBe(2)
  expect(inspected.bounds).toEqual(fullBox)

  const cage: MountCage = {
    ...fullBox,
    offsets: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [1.5, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0.6],
      [1.5, 0, 0.6],
    ],
    mode: 'byPart',
  }
  const edit = {
    ...selection,
    baseVersion: inspected.version,
    cage,
    material: 'pt950' as const,
    changeId: 'mounted-gallery-cage',
  }
  const changed = await api.call('design.editMount', edit)
  expect(changed.version).toBe(before.version + 1)
  expect(await api.call('design.editMount', edit)).toEqual(changed)
  const stale = await api.fail('design.editMount', { ...edit, changeId: 'stale-cage' })
  expect(stale.status).toBe(409)
  expect(stale.error.currentVersion).toBe(changed.version)

  const byPart = await rhinoOutput(api, before.id)
  const centers: Point[] = [
    [0, 0, 1],
    [9, 0.75, 1.75],
  ]
  compareSolids(ownReadback, byPart, 'pt950', (i, p) => atPart(centers[i]!, p))
  expect(byPart.meshes.get('neighbour-setting')).toEqual(
    beforeExport.meshes.get('neighbour-setting'),
  )
  const changedDesign = (await get()).design
  untouched(changedDesign)
  expect(changedDesign.nodes[gemId]).toEqual(before.design.nodes[gemId])
  for (const id of mountIds) {
    const source = before.design.nodes[id]
    expect(source?.kind).toBe('meshBody')
    if (source?.kind === 'meshBody')
      expect(changedDesign.nodes[id]).toMatchObject({ source: source.source })
  }

  const undo = await api.call('design.revert', { pieceId: before.id, seq: changed.change.seq })
  expect((await get()).design).toEqual(before.design)
  expect(
    (await api.fail('design.revert', { pieceId: before.id, seq: changed.change.seq })).status,
  ).toBe(409)
  const redo = await api.call('design.revert', { pieceId: before.id, seq: undo.change.seq })
  expect((await get()).design).toEqual(changedDesign)

  const receiver = await engineServer()
  try {
    const receiving = client(receiver)
    const piece = await portableCopy(receiving, before.id)
    const reloaded = await rhinoOutput(receiving, piece.id)
    expect(reloaded).toEqual(byPart)
    await receiving.call('design.revert', { pieceId: piece.id, seq: redo.change.seq })
    compareSolids(ownReadback, await rhinoOutput(receiving, piece.id), 'au18k-yellow', (_, p) => p)
  } finally {
    await receiver.dispose()
  }

  const shaped = await api.call('design.editMount', {
    ...selection,
    baseVersion: redo.version,
    changeId: 'flex-exactly',
    cage: { ...cage, mode: 'freeform' },
  })
  const nonlinear = await rhinoOutput(api, before.id)
  expect(nonlinear.solids.size).toBe(0)
  expect(nonlinear.meshes.get('neighbour-setting')).toEqual(
    beforeExport.meshes.get('neighbour-setting'),
  )
  for (const [i, id] of mountIds.entries()) {
    const mesh = nonlinear.meshes.get(id)
    expect(mesh?.closed).toBe(true)
    const { positions, indices } = parseStl(objects[i]!.bytes)
    expect(mesh!.triangleCount).toBe(indices.length / 3)
    let deviationFromTangent = 0
    for (let v = 0; v < positions.length; v += 3) {
      const p: Point = [positions[v]!, positions[v + 1]!, positions[v + 2]!]
      const mapped = freeform(p)
      const linearized = atPart(centers[i]!, p)
      deviationFromTangent = Math.max(
        deviationFromTangent,
        Math.hypot(...mapped.map((value, axis) => value - linearized[axis]!)),
      )
      const nearest = Math.min(
        ...mesh!.points.map((q) =>
          Math.hypot(mapped[0] - q[0], mapped[1] - q[1], mapped[2] - q[2]),
        ),
      )
      expect(nearest).toBeLessThan(2e-5)
    }
    expect(deviationFromTangent).toBeGreaterThan(0.02)
  }

  // Link just one member to the original girdle and remove both cages for an independent fit test.
  const cleared = await api.call('design.editMount', {
    ...selection,
    baseVersion: shaped.version,
    cage: null,
    changeId: 'clear-cage',
  })
  const linked = await api.call('design.editMount', {
    ...selection,
    nodeIds: [mountIds[0]!],
    baseVersion: cleared.version,
    fitGemId: gemId,
    changeId: 'link-to-centre-stone',
  })
  const replace = {
    pieceId: before.id,
    target: { nodeId: gemId },
    change: {
      fit: { provider: 'diaex', sku: 'SYNTHETIC-FIT', measured: afterFit },
    },
    baseVersion: linked.version,
  }
  const preview = await api.call('design.replaceStone', { ...replace, dryRun: true })
  expect(preview.applied).toBe(false)
  expect((await get()).version).toBe(linked.version)
  const fitted = await api.call('design.replaceStone', {
    ...replace,
    changeId: 'fit-measured-stone',
  })
  expect(fitted.applied).toBe(true)
  expect(fitted.version).toBe(linked.version + 1)
  const current = await get()
  untouched(current.design)
  expect(current.design.nodes[gemId]).toMatchObject({ sourcing: { measured: afterFit } })
  const fitOutput = await rhinoOutput(api, before.id)
  const ratio = [
    afterFit.width / beforeFit.width,
    afterFit.length / beforeFit.length,
    afterFit.depth / beforeFit.depth,
  ]
  compareSolids(ownReadback, fitOutput, 'pt950', (i, p) =>
    i === 1
      ? p
      : [
          girdle[0] + (p[0] - girdle[0]) * ratio[0]!,
          girdle[1] + (p[1] - girdle[1]) * ratio[1]!,
          girdle[2] + (p[2] - girdle[2]) * ratio[2]!,
        ],
  )
  expect(fitOutput.meshes.get('neighbour-setting')).toEqual(
    beforeExport.meshes.get('neighbour-setting'),
  )
  const portableFit = await portableCopy(api, before.id)
  expect(await rhinoOutput(api, portableFit.id)).toEqual(fitOutput)

  const guarded = await api.fail('design.revert', { pieceId: before.id, seq: redo.change.seq })
  expect(guarded.status).toBe(409)
  expect((await get()).version).toBe(current.version)
  await api.call('design.revert', { pieceId: before.id, seq: fitted.change!.seq })
  compareSolids(ownReadback, await rhinoOutput(api, before.id), 'pt950', (_, p) => p)
  expect((await api.call('pieces.get', { id: sibling.id })).design).toEqual(sibling.design)
  for (const { asset, hash } of immutableSources)
    expect(digest(await assetBytes(api, asset))).toBe(hash)
}, 120_000)
