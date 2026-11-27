/**
 * A .pave file with the real kernel: the display mesh inside is a real GLB, written without
 * claiming an export, the exact STEP (a counted export) is left out, and the reopened piece
 * evaluates to the same facts as the one it was saved from.
 */
import { readRhino3dm } from '@pave/kernel/rhino-import'
import { unzipSync } from 'fflate'
import rhino3dm, { type Mesh, type MeshType } from 'rhino3dm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { assetBytes, engineServer } from '../test/engines'
import { BOOT_TIMEOUT, type Client, client, type TestServer } from '../test/harness'

let server: TestServer
let api: Client
beforeAll(async () => {
  server = await engineServer()
  api = client(server)
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

it('carries real GLB geometry, no STEP, and reopens to the same facts, never counted', async () => {
  const piece = await api.call('pieces.create', { templateId: 'solitaire', title: 'Real' })
  const { asset, notes } = await api.call('pieces.saveFile', { id: piece.id })
  expect(notes).toEqual([])
  const bytes = await assetBytes(api, asset)
  const entries = unzipSync(bytes)
  // The exact STEP is a counted export, so the free file never carries it.
  expect(entries['geometry/exact.step']).toBeUndefined()
  const glb = entries['geometry/display.glb']!
  expect(new TextDecoder().decode(glb.subarray(0, 4))).toBe('glTF')

  const form = new FormData()
  form.set('file', new File([bytes as Uint8Array<ArrayBuffer>], 'Real.pave'))
  const uploaded = (await (
    await api.request('/api/assets', { method: 'POST', body: form })
  ).json()) as { id: string }
  const { piece: opened } = await api.call('pieces.openFile', { assetId: uploaded.id })
  const [a, b] = await Promise.all([
    api.call('design.evaluate', { pieceId: piece.id, detail: 'draft' }),
    api.call('design.evaluate', { pieceId: opened.id, detail: 'draft' }),
  ])
  expect(a.metalMassG).toBeGreaterThan(0)
  expect(a.stoneCount).toBeGreaterThan(0)
  expect(b).toEqual(a)
  const plan = await api.call('plan.get', {})
  expect(plan.allowances.find((x) => x.allowance === 'export')!.used).toBe(0)
}, 240_000)

async function upload(to: Client, bytes: Uint8Array, name: string): Promise<string> {
  const body = new FormData()
  body.set('file', new File([bytes.slice()], name))
  const result = await to.request('/api/assets', { method: 'POST', body })
  expect(result.ok).toBe(true)
  return ((await result.json()) as { id: string }).id
}

it('reopens a Rhino source on another server and restores exact geometry when a mesh edit is undone', async () => {
  const rhino = await rhino3dm()
  const doc = new rhino.File3dm()
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters
  const brep = rhino.Brep.createFromSphere(new rhino.Sphere([0, 0, 0], 4))
  const mesh = new rhino.Mesh()
  const verts = mesh.vertices()
  verts.add(4, 0, 0)
  verts.add(0, 4, 0)
  verts.add(-4, 0, 0)
  verts.add(0, -4, 0)
  verts.add(0, 0, 4)
  verts.add(0, 0, -4)
  const faces = mesh.faces()
  for (let i = 0; i < 4; i++) {
    faces.addTriFace(i, (i + 1) % 4, 4)
    faces.addTriFace((i + 1) % 4, i, 5)
  }
  const face = brep.faces().get(0)
  const setMesh = face.setMesh as unknown as (mesh: Mesh, type: MeshType) => boolean
  expect(setMesh.call(face, mesh, rhino.MeshType.Render)).toBe(true)
  const attrs = new rhino.ObjectAttributes()
  attrs.name = 'Selected solid'
  const material = new rhino.Material()
  material.diffuseColor = {
    r: 36,
    g: 75,
    b: 141,
    a: 255,
  } as unknown as typeof material.diffuseColor
  material.transparency = 0.25
  attrs.materialSource = rhino.ObjectMaterialSource.MaterialFromObject
  attrs.materialIndex = doc.materials().add(material) as unknown as number
  const objects = doc.objects()
  objects.addBrep(brep, attrs)
  attrs.name = 'Unselected solid'
  objects.addBrep(brep, attrs)
  const {
    objects: [selected],
  } = await readRhino3dm(doc.toByteArray())
  const assetId = await upload(api, selected!.bytes, 'selected.stl')
  const nativeAssetId = await upload(api, selected!.native!.bytes, 'selected.3dm')
  const piece = await api.call('pieces.create', { kind: 'other', title: 'Rhino part' })
  await api.call('design.apply', {
    pieceId: piece.id,
    label: 'Imported Rhino solid',
    ops: [
      {
        t: 'add',
        node: {
          id: 'selected',
          kind: 'meshBody',
          source: {
            type: 'asset',
            assetId,
            nativeAssetId,
            nativeMeshAssetId: assetId,
            rhinoObjectId: selected!.native!.objectId,
            rhinoContext: selected!.rhinoContext,
          },
          keepSourcePlacement: true,
        },
      },
    ],
  })
  const edited = await api.call('design.apply', {
    pieceId: piece.id,
    label: 'Moved a mesh vertex',
    ops: [
      {
        t: 'update',
        id: 'selected',
        patch: { meshEdits: { assetId, vertices: { 0: [5, 0, 0] } } },
      },
    ],
  })
  const saved = await api.call('pieces.saveFile', { id: piece.id })
  const bytes = await assetBytes(api, saved.asset)
  const entries = unzipSync(bytes)
  const paths = Object.keys(entries).filter((path) => path.startsWith('assets/'))
  expect(paths.map((path) => path.split('.').at(-1)).sort()).toEqual(['3dm', 'stl'])

  const receiver = await engineServer()
  try {
    const other = client(receiver)
    expect((await other.request(`/api/assets/${assetId}`)).status).toBe(404)
    const archived = await upload(other, bytes, 'Rhino part.pave')
    const { piece: opened } = await other.call('pieces.openFile', { assetId: archived })
    const node = opened.design.nodes.selected!
    expect(node.kind).toBe('meshBody')
    if (node.kind !== 'meshBody' || node.source.type !== 'asset') throw new Error('Expected a mesh')
    expect(node.source.assetId).not.toBe(assetId)
    expect(node.source.nativeAssetId).not.toBe(nativeAssetId)
    expect(node.meshEdits?.assetId).toBe(node.source.assetId)
    expect(node.source.rhinoContext?.materialAppearance).toEqual({
      color: '#244b8d',
      opacity: 0.75,
    })

    const read = async () => {
      const { asset } = await other.call('design.export', { pieceId: opened.id, format: '3dm' })
      const file = rhino.File3dm.fromByteArray(await assetBytes(other, asset))
      expect(file.objects().count).toBe(1)
      const object = file.objects().get(0)
      const appearance = file.materials().findIndex(object.attributes().materialIndex)
      expect(appearance.diffuseColor).toEqual({ r: 36, g: 75, b: 141, a: 255 })
      expect(appearance.transparency).toBe(0.25)
      return object.geometry()
    }
    expect(await read()).toBeInstanceOf(rhino.Mesh)
    await other.call('design.revert', { pieceId: opened.id, seq: edited.version })
    expect(await read()).toBeInstanceOf(rhino.Brep)
  } finally {
    await receiver.dispose()
  }
}, 240_000)
