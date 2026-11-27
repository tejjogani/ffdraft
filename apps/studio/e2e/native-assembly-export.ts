import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
import type { Piece } from '@pave/schema'
import type { Page } from 'playwright'
import { archive, handles, readCurve } from '../../../packages/kernel/src/qa/rhino-archive'
import { loadRhino3dm } from '../../../packages/kernel/src/runtime/rhino'
import { makeCappedPrismFixture } from '../../../packages/kernel/test-fixtures/capped-prism'

const controlPoints = [
  [8, 0, 1, 1],
  [9, 3, 3, 0.5],
  [12, 4, 1, 1],
]
const knots = [2, 2, 7, 7]

async function assemblyFixture() {
  const rhino = await loadRhino3dm()
  const sleeve = await makeCappedPrismFixture()
  return archive(rhino, sleeve, (doc, hold) => {
    const objects = hold(doc.objects())
    const geometry = hold(hold(objects.get(0)).geometry())
    const second = hold(geometry.duplicate())
    // These exterior boxes overlap, so an alloy-wide casting union merges their shells.
    assert.ok(second.translate([4, 0, 0]))
    const attrs = hold(new rhino.ObjectAttributes())
    attrs.name = 'Second sleeve'
    assert.ok(second instanceof rhino.Brep && second.isSolid)
    objects.addBrep(second, attrs)

    const rail = hold(new rhino.NurbsCurve(3, true, 3, controlPoints.length))
    const points = hold(rail.points())
    for (const [i, [x, y, z, weight]] of controlPoints.entries())
      points.set(i, [x! * weight!, y! * weight!, z! * weight!, weight!])
    const knotList = hold(rail.knots())
    for (const [i, knot] of knots.entries()) knotList.set(i, knot)
    attrs.name = 'Reference profile'
    objects.addCurve(rail, attrs)
    assert.equal(objects.count, 3)
    return Buffer.from(doc.toByteArray())
  })
}

async function checkRhinoFile(bytes: Uint8Array, imported: Piece) {
  const rhino = await loadRhino3dm()
  archive(rhino, bytes, (doc, hold) => {
    assert.equal(hold(doc.settings()).modelUnitSystem, rhino.UnitSystem.Millimeters)
    const objects = hold(doc.objects())
    const native: {
      rims: { center: number[]; radius: number }[]
      twoLoopFaces: number
      nodeId: string
      alloy: string
    }[] = []
    const curves: ReturnType<typeof readCurve>[] = []
    let meshes = 0
    for (let i = 0; i < objects.count; i++) {
      handles((take) => {
        const object = take(objects.get(i))
        const geometry = take(object.geometry())
        const attrs = take(object.attributes())
        if (geometry instanceof rhino.Brep) {
          assert.ok(geometry.isValid && geometry.isSolid && geometry.isManifold)
          const edges = take(geometry.edges())
          const rims = Array.from({ length: edges.count }, (_, edge) =>
            handles((local) => {
              const circle = local(
                local(edges.get(edge)).tryGetCircle() as {
                  center: number[]
                  radius: number
                } | null,
              )
              return circle ? [{ center: circle.center, radius: circle.radius }] : []
            }),
          ).flat()
          assert.equal(
            rims.length,
            4,
            'Expected an exact circular inner and outer rim on each end.',
          )
          const faces = take(geometry.faces())
          let twoLoopFaces = 0
          for (let face = 0; face < faces.count; face++)
            twoLoopFaces += handles((local) => {
              const loops = local(local(faces.get(face)).loops)
              return Number(loops.count === 2)
            })
          native.push({
            rims,
            twoLoopFaces,
            nodeId: attrs.getUserString('nodeIds'),
            alloy: attrs.getUserString('alloy'),
          })
        }
        if (geometry instanceof rhino.Mesh) meshes++
        if (geometry instanceof rhino.NurbsCurve) {
          assert.ok(geometry.isValid)
          curves.push(readCurve(geometry))
        }
      })
    }
    assert.equal(
      native.length,
      2,
      `Full assembly export must preserve both native Rhino solids. The downloaded file contains ${meshes} ${meshes === 1 ? 'mesh' : 'meshes'}.`,
    )
    assert.equal(curves.length, 1, 'The reference must remain one exact NURBS curve.')
    assert.equal(
      objects.count,
      3,
      'Only the two independent solids and reference belong in the file.',
    )
    native.sort((a, b) => a.rims[0]!.center[0]! - b.rims[0]!.center[0]!)
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-8
    for (const [i, body] of native.entries()) {
      assert.equal(body.twoLoopFaces, 2, 'The native solid must keep its two through-hole faces.')
      for (const z of [0, 2])
        for (const radius of [1, 3])
          assert.ok(
            body.rims.some(
              ({ center, radius: r }) =>
                near(center[0]!, i * 4) &&
                near(center[1]!, 0) &&
                near(center[2]!, z) &&
                near(r, radius),
            ),
            'An exact rim moved or changed size.',
          )
    }
    const bodyIds = imported.design.order.filter(
      (id) => imported.design.nodes[id]?.kind === 'meshBody',
    )
    assert.deepEqual(native.map(({ nodeId }) => nodeId).sort(), bodyIds.sort())
    assert.ok(native[0]!.alloy && native[0]!.alloy === native[1]!.alloy)
    const curve = curves[0]!
    assert.equal(curve.degree, 2)
    assert.deepEqual(curve.domain, [2, 7])
    assert.deepEqual(curve.knots, knots)
    assert.deepEqual(curve.points, controlPoints)
  })
}

export async function checkNativeAssemblyExport(
  page: Page,
  base: URL,
  rpc: (name: string, data: object) => Promise<unknown>,
  choose: (buffer: Buffer) => Promise<void>,
) {
  const title = 'Native Rhino assembly export'
  const { id } = (await rpc('pieces.create', { title, kind: 'other' })) as Piece
  // Exercise the browser download branch without launching the operating system save picker.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.goto(new URL(`/pieces/${id}/design`, base).href)
  await choose(await assemblyFixture())
  await page.getByRole('button', { name: 'Import 2 parts and 1 curve', exact: true }).click()
  const deadline = Date.now() + 15_000
  let imported = (await rpc('pieces.get', { id })) as Piece
  while (imported.version === 0 && Date.now() < deadline) {
    await setTimeout(80)
    imported = (await rpc('pieces.get', { id })) as Piece
  }
  assert.equal(imported.version, 1)
  const parts = Object.values(imported.design.nodes).filter((node) => node.kind === 'meshBody')
  assert.equal(parts.length, 2)
  assert.ok(parts.every(({ source }) => source.type === 'asset' && source.nativeAssetId))
  assert.equal(parts[0]!.material, parts[1]!.material)
  assert.equal(imported.design.order.length, 3)

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 35_000 }),
    page.getByText('For Rhino', { exact: true }).click(),
  ])
  assert.match(download.suggestedFilename(), /\.3dm$/)
  const path = await download.path()
  assert.ok(path, 'The Rhino file was not downloaded.')
  await checkRhinoFile(await readFile(path), imported)
  await download.delete()
  console.log(
    'Native Rhino assembly export preserved both overlapping same-alloy BReps, their through-holes and placements, and the weighted reference curve.',
  )
}
