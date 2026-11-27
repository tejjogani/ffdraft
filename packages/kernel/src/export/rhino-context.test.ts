import { designFrom, type NodeInput } from '@pave/schema'
import type { InstanceReference, Mesh, MeshType, RhinoModule, Transform } from 'rhino3dm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readRhino3dm } from '../import/rhino'
import { createKernel } from '../kernel'
import { handles } from '../qa/rhino-archive'
import { loadRhino3dm } from '../runtime/rhino'

let rhino: RhinoModule
const kernel = createKernel()
beforeAll(async () => {
  rhino = await loadRhino3dm()
})
afterAll(() => kernel.dispose())

function contextArchive(affine = false) {
  return handles((hold) => {
    const doc = hold(new rhino.File3dm())
    hold(doc.settings()).modelUnitSystem = rhino.UnitSystem.Millimeters
    const materials = hold(doc.materials())
    const addMaterial = (name: string) => {
      const material = hold(new rhino.Material())
      material.name = name
      return materials.add(material) as unknown as number
    }
    const bronze = addMaterial('Display bronze')
    const blue = addMaterial('Display blue')
    const black = addMaterial('Display black')

    const layers = hold(doc.layers())
    const addLayer = (name: string, material?: number) => {
      const layer = hold(new rhino.Layer())
      layer.name = name
      if (material !== undefined) layer.renderMaterialIndex = material
      return layers.add(layer)
    }
    const memberLayer = addLayer('Block members')
    const firstLayer = addLayer('First placement')
    const secondLayer = addLayer('Second placement', blue)

    const groups = hold(doc.groups())
    const addGroup = (name: string) => {
      const group = hold(new rhino.Group())
      group.name = name
      groups.add(group)
      return hold(groups.findName(name)).index
    }
    const sharedWithCurve = addGroup('Workshop group')
    const otherGroup = addGroup('Second group')
    const member = hold(new rhino.ObjectAttributes())
    member.name = 'Seat'
    member.layerIndex = memberLayer
    member.materialSource = rhino.ObjectMaterialSource.MaterialFromParent

    const brep = hold(rhino.Brep.createFromSphere(hold(new rhino.Sphere([0, 0, 0], 1))))
    // The BRep face takes ownership of the render mesh.
    const mesh = new rhino.Mesh()
    const vertices = hold(mesh.vertices())
    vertices.add(1, 0, 0)
    vertices.add(0, 1, 0)
    vertices.add(-1, 0, 0)
    vertices.add(0, -1, 0)
    vertices.add(0, 0, 1)
    vertices.add(0, 0, -1)
    const faces = hold(mesh.faces())
    for (let i = 0; i < 4; i++) {
      faces.addTriFace(i, (i + 1) % 4, 4)
      faces.addTriFace((i + 1) % 4, i, 5)
    }
    const face = hold(hold(brep.faces()).get(0))
    const setMesh = face.setMesh as unknown as (mesh: Mesh, type: MeshType) => boolean
    expect(setMesh.call(face, mesh, rhino.MeshType.Render)).toBe(true)
    const definitions = hold(doc.instanceDefinitions())
    const index = definitions.add('Seat module', '', '', '', [0, 0, 0], [brep], [member])
    const definition = hold(definitions.get(index))
    const Ref = rhino.InstanceReference as unknown as new (
      id: string,
      transform: Transform,
    ) => InstanceReference
    const objects = hold(doc.objects())
    const first = hold(new rhino.ObjectAttributes())
    first.name = 'First'
    first.setUserString('paveSourceStullerMaterial', JSON.stringify({ metal: 'TEST-14K' }))
    first.layerIndex = firstLayer
    first.materialSource = rhino.ObjectMaterialSource.MaterialFromObject
    first.materialIndex = bronze
    first.addToGroup(sharedWithCurve)
    const firstTransform = hold(rhino.Transform.translationXYZ(5, 0, 0))
    if (affine) {
      firstTransform.m00 = -2
      firstTransform.m01 = 0.25
    }
    const second = hold(new rhino.ObjectAttributes())
    second.name = 'Second'
    second.layerIndex = secondLayer
    second.addToGroup(otherGroup)
    const secondTransform = hold(rhino.Transform.translationXYZ(10, 0, 0))
    objects.addInstanceObject(hold(new Ref(definition.id, firstTransform)), first)
    objects.addInstanceObject(hold(new Ref(definition.id, secondTransform)), second)

    const curve = hold(new rhino.ObjectAttributes())
    curve.name = 'Guide'
    curve.layerIndex = memberLayer
    curve.materialSource = rhino.ObjectMaterialSource.MaterialFromObject
    curve.materialIndex = black
    curve.addToGroup(sharedWithCurve)
    curve.addToGroup(otherGroup)
    objects.addLine([0, 0, 0], [1, 0, 0], curve)
    const unlabeled = hold(new rhino.ObjectAttributes())
    unlabeled.name = 'Independent guide'
    unlabeled.layerIndex = memberLayer
    unlabeled.materialSource = rhino.ObjectMaterialSource.MaterialFromObject
    unlabeled.materialIndex = 1000 // A stale material index must not create a hint.
    objects.addLine([0, 0, 0], [0, 1, 0], unlabeled)
    return doc.toByteArray()
  })
}

function designFixture(previews: Awaited<ReturnType<typeof readRhino3dm>>[]) {
  const data = new Map<string, Uint8Array>()
  const nodes = previews.flatMap(({ objects, curves }, file) => [
    ...objects.map((part, i): NodeInput => {
      const assetId = `mesh-${file}-${i}`
      data.set(assetId, part.bytes)
      const nativeAssetId = `native-${file}`
      if (part.native) data.set(nativeAssetId, part.native.bytes)
      return {
        id: `part-${file}-${i}`,
        kind: 'meshBody',
        name: `${part.name} ${file}`,
        keepSourcePlacement: true,
        source: {
          type: 'asset',
          assetId,
          rhinoLayer: part.layer ?? undefined,
          rhinoContext: part.rhinoContext,
          ...(part.native && {
            nativeAssetId,
            nativeMeshAssetId: assetId,
            nativeTransform: part.native.transform && [...part.native.transform],
            rhinoObjectId: part.native.objectId,
            rhinoInstancePath: [...part.native.instancePath],
          }),
        },
      }
    }),
    ...curves.map(
      (
        { degree, controlPoints, knots, layer, name, rhinoContext, sourceObjectId },
        i,
      ): NodeInput => ({
        id: `curve-${file}-${i}`,
        kind: 'nurbsCurve',
        name: `${name} ${file}`,
        degree,
        controlPoints,
        knots,
        rhinoLayer: layer ?? undefined,
        rhinoContext,
        sourceObjectId,
      }),
    ),
  ])
  const assets = async (id: string) => data.get(id)!
  return { design: designFrom('other', nodes), assets }
}

describe('Rhino source context', () => {
  it('keeps real mixed group memberships and separates member and occurrence attributes', async () => {
    const bytes = contextArchive()
    const read = () => readRhino3dm(bytes, { includeCurves: true })
    const preview = await read()
    expect(preview.skipped).toEqual([])
    const [first, second] = preview.objects
    const [guide, independent] = preview.curves
    expect(first).toMatchObject({
      layer: 'Block members',
      rhinoContext: {
        stullerMaterial: { metal: 'TEST-14K' },
        groups: [{ name: 'Workshop group' }],
        placements: [{ layer: 'First placement', material: 'Display bronze' }],
      },
    })
    expect(second).toMatchObject({
      layer: 'Block members',
      rhinoContext: {
        groups: [{ name: 'Second group' }],
        placements: [{ layer: 'Second placement', material: 'Display blue' }],
      },
    })
    expect(first?.rhinoContext?.topology).toMatch(/^Brep:\d+:\d+:\d+$/)
    expect(second?.rhinoContext?.topology).toBe(first?.rhinoContext?.topology)
    expect(first?.rhinoContext?.material).toBeUndefined()
    expect(second?.rhinoContext?.material).toBeUndefined()
    expect(first?.rhinoContext?.placements[0]?.definitionId).toBe(
      second?.rhinoContext?.placements[0]?.definitionId,
    )
    expect(first?.rhinoContext?.placements[0]?.id).not.toBe(second?.rhinoContext?.placements[0]?.id)
    expect(guide?.rhinoContext?.material).toBe('Display black')
    expect(guide?.rhinoContext?.groups).toEqual([
      first?.rhinoContext?.groups[0],
      second?.rhinoContext?.groups[0],
    ])
    expect(independent?.rhinoContext).toBeUndefined()

    const duplicate = (await read()).objects[0]?.rhinoContext
    expect(duplicate?.groups[0]?.id).not.toBe(first?.rhinoContext?.groups[0]?.id)
    expect(duplicate?.placements[0]?.id).not.toBe(first?.rhinoContext?.placements[0]?.id)
    expect(duplicate?.placements[0]?.definitionId).not.toBe(
      first?.rhinoContext?.placements[0]?.definitionId,
    )
  })

  it('round-trips named source context and writes distinct Rhino groups for duplicate imports', async () => {
    const bytes = contextArchive()
    const read = () => readRhino3dm(bytes, { includeCurves: true })
    const { design, assets } = designFixture([await read(), await read()])
    const exported = await kernel.export(design, '3dm', { assets, stones: false })

    handles((hold) => {
      const doc = hold(rhino.File3dm.fromByteArray(exported.bytes))
      const groups = hold(doc.groups())
      expect(groups.count).toBe(4)
      const objects = hold(doc.objects())
      const materials = hold(doc.materials())
      const first = hold(hold(objects.get(0)).attributes())
      expect(hold(materials.findIndex(first.materialIndex)).name).toBe('Display bronze')
      expect(first.getGroupList()).toHaveLength(1)
      const names = Array.from({ length: groups.count }, (_, i) => {
        const group = hold(groups.get(i))
        const members = groups.groupMembers(group.index).map((o) => hold(hold(o).attributes()))
        expect(members).toHaveLength(2)
        const ownerSuffix = members[0]!.name.slice(-1)
        expect(members.map((attrs) => attrs.name)).toContain(`Guide ${ownerSuffix}`)
        return group.name
      })
      expect(new Set(names).size).toBe(4)
    })

    const result = await readRhino3dm(exported.bytes, { includeCurves: true })
    expect(result.skipped).toEqual([])
    expect(result.objects.every((part) => part.native)).toBe(true)
    const [first, second, repeat] = result.objects
    expect(first).toMatchObject({
      layer: 'Block members',
      rhinoContext: {
        stullerMaterial: { metal: 'TEST-14K' },
        groups: [{ name: 'Workshop group' }],
        placements: [{ layer: 'First placement', material: 'Display bronze' }],
      },
    })
    expect(second).toMatchObject({
      layer: 'Block members',
      rhinoContext: {
        groups: [{ name: 'Second group' }],
        placements: [{ layer: 'Second placement', material: 'Display blue' }],
      },
    })
    expect(first?.rhinoContext?.material).toBeUndefined()
    expect(first?.rhinoContext?.placements[0]?.definitionId).toBe(
      second?.rhinoContext?.placements[0]?.definitionId,
    )
    expect(first?.rhinoContext?.placements[0]?.definitionId).not.toBe(
      repeat?.rhinoContext?.placements[0]?.definitionId,
    )
    expect(repeat?.rhinoContext?.groups[0]?.name).toBe('Workshop group')
    expect(repeat?.rhinoContext?.groups[0]?.id).not.toBe(first?.rhinoContext?.groups[0]?.id)
    const guide = result.curves.find((curve) => curve.name === 'Guide 0')
    expect(guide?.rhinoContext?.groups).toEqual([
      first?.rhinoContext?.groups[0],
      second?.rhinoContext?.groups[0],
    ])
    expect(guide?.rhinoContext?.material).toBe('Display black')
  })

  it('keeps real placement attributes on an exact affine export', async () => {
    const source = await readRhino3dm(contextArchive(true), { includeCurves: true })
    const { design, assets } = designFixture([source])
    const { bytes } = await kernel.export(design, '3dm', { assets, stones: false })
    handles((hold) => {
      const doc = hold(rhino.File3dm.fromByteArray(bytes))
      const objects = hold(doc.objects())
      const layers = hold(doc.layers())
      const materials = hold(doc.materials())
      const records = Array.from({ length: objects.count }, (_, index) => {
        const object = hold(objects.get(index))
        return { geometry: hold(object.geometry()), attrs: hold(object.attributes()) }
      })
      const instance = records.find(({ geometry }) => geometry instanceof rhino.InstanceReference)
      expect(instance?.attrs.getGroupList()).toHaveLength(1)
      expect(hold(layers.findIndex(instance!.attrs.layerIndex)).name).toBe('First placement')
      expect(hold(materials.findIndex(instance!.attrs.materialIndex)).name).toBe('Display bronze')
      const leaf = records.find(({ attrs }) => attrs.isInstanceDefinitionObject)
      expect(hold(layers.findIndex(leaf!.attrs.layerIndex)).name).toBe('Block members')
      expect(leaf?.attrs.materialSource).toBe(rhino.ObjectMaterialSource.MaterialFromParent)
    })
    const result = await readRhino3dm(bytes, { includeCurves: true })
    expect(result.skipped).toEqual([])
    const [first, second] = result.objects
    expect(first).toMatchObject({
      layer: 'Block members',
      bounds: source.objects[0]?.bounds,
      rhinoContext: {
        stullerMaterial: { metal: 'TEST-14K' },
        groups: [{ name: 'Workshop group' }],
        placements: [{ layer: 'First placement', material: 'Display bronze' }],
        materialFromParent: true,
      },
    })
    expect(first?.rhinoContext?.placements[0]?.definitionId).toBe(
      second?.rhinoContext?.placements[0]?.definitionId,
    )
  })

  it('retains source context when a native archive is missing and the export writes a mesh', async () => {
    const source = await readRhino3dm(contextArchive(), { includeCurves: true })
    const { design, assets } = designFixture([source])
    const { bytes } = await kernel.export(design, '3dm', {
      assets: async (id) => {
        if (id.startsWith('native-')) throw new Error('Source archive unavailable')
        return assets(id)
      },
      stones: false,
    })
    const result = await readRhino3dm(bytes, { includeCurves: true })
    expect(result.skipped).toEqual([])
    const first = result.objects[0]
    expect(first?.native).toBeUndefined()
    expect(first).toMatchObject({
      layer: 'Block members',
      rhinoContext: {
        stullerMaterial: { metal: 'TEST-14K' },
        groups: [{ name: 'Workshop group' }],
        placements: [{ layer: 'First placement', material: 'Display bronze' }],
        materialFromParent: true,
      },
    })
    expect(first?.rhinoContext?.groups[0]).toEqual(result.curves[0]?.rhinoContext?.groups[0])
  })
})
