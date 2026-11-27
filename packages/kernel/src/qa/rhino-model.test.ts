import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Brep, InstanceReference, Mesh, MeshType, Transform } from 'rhino3dm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeCappedPrismFixture } from '../../test-fixtures/capped-prism'
import { freeRhino, loadRhino3dm } from '../runtime/rhino'
import { archive, handles } from './rhino-archive'

let directory: string
const cli = fileURLToPath(new URL('./rhino-model-cli.ts', import.meta.url))
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pave-rhino-check-'))
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

function check(...files: string[]) {
  const run = spawnSync(process.execPath, ['--import', 'tsx', cli, ...files], {
    encoding: 'utf8',
    timeout: 45_000,
  })
  if (run.error) throw run.error
  if (!run.stdout.trim()) throw new Error(run.stderr)
  return {
    status: run.status,
    reports: run.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  }
}

async function writeModel(name: string, contents: 'mixed' | 'point' | 'curve' | 'mesh') {
  const rhino = await loadRhino3dm()
  const doc = new rhino.File3dm()
  const settings = doc.settings()
  settings.modelUnitSystem = rhino.UnitSystem.Centimeters
  const objects = doc.objects()
  const attributes = new rhino.ObjectAttributes()
  const handles: object[] = [doc, settings, objects, attributes]
  const hold = <T extends object>(handle: T): T => {
    handles.push(handle)
    return handle
  }
  try {
    objects.addPoint([0, 0, 0], attributes)
    if (contents === 'curve') {
      objects.addCurve(hold(new rhino.LineCurve([0, 0, 0], [1, 2, 3])), attributes)
    }
    if (contents === 'mesh') {
      const mesh = hold(new rhino.Mesh())
      const vertices = hold(mesh.vertices())
      vertices.add(0, 0, 0)
      vertices.add(1, 0, 0)
      vertices.add(0, 1, 0)
      vertices.add(0, 0, 1)
      const faces = hold(mesh.faces())
      faces.addTriFace(0, 2, 1)
      faces.addTriFace(0, 1, 3)
      faces.addTriFace(1, 2, 3)
      faces.addTriFace(2, 0, 3)
      objects.addMesh(mesh, attributes)
    }
    if (contents === 'mixed') {
      const layers = hold(doc.layers())
      const layer = hold(new rhino.Layer())
      layer.name = 'Test profiles'
      attributes.layerIndex = layers.add(layer)

      const rail = hold(new rhino.NurbsCurve(3, true, 3, 3))
      const points = hold(rail.points())
      points.set(0, [1, 0, 0, 1])
      points.set(1, [0.5, 0.5, 0.25, 0.5])
      points.set(2, [0, 1, 1, 1])
      const knots = hold(rail.knots())
      for (const [index, knot] of [2, 2, 7, 7].entries()) knots.set(index, knot)
      objects.addCurve(rail, attributes)

      const sphere = hold(new rhino.Sphere([0, 0, 0], 1))
      const solid = hold(rhino.Brep.createFromSphere(sphere))
      // setMesh takes ownership of the cache. The BRep frees it with its faces.
      const mesh = new rhino.Mesh()
      const vertices = hold(mesh.vertices())
      for (const [x, y, z] of [
        [1, 0, 0],
        [0, 1, 0],
        [-1, 0, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ] as const)
        vertices.add(x, y, z)
      const faces = hold(mesh.faces())
      for (let i = 0; i < 4; i++) {
        faces.addTriFace(i, (i + 1) % 4, 4)
        faces.addTriFace((i + 1) % 4, i, 5)
      }
      const shell = hold(solid.faces())
      const face = hold(shell.get(0))
      const setCache = face.setMesh as unknown as (mesh: Mesh, type: MeshType) => boolean
      expect(setCache.call(face, mesh, rhino.MeshType.Render)).toBe(true)

      const definitions = hold(doc.instanceDefinitions())
      const index = definitions.add(
        'Repeated test solid',
        '',
        '',
        '',
        [0, 0, 0],
        [solid],
        [attributes],
      )
      const definition = hold(definitions.get(index))
      const Reference = rhino.InstanceReference as unknown as new (
        id: string,
        transform: Transform,
      ) => InstanceReference
      for (const x of [5, 10]) {
        const transform = hold(rhino.Transform.translationXYZ(x, 0, 0))
        objects.addInstanceObject(hold(new Reference(definition.id, transform)), attributes)
      }
    }
    const file = join(directory, name)
    await writeFile(file, doc.toByteArray())
    return file
  } finally {
    for (const handle of handles.reverse()) freeRhino(handle)
  }
}

describe('local Rhino model check', () => {
  it('checks archived edges and trimmed cap motion on a placed sleeve in centimetres', async () => {
    const rhino = await loadRhino3dm()
    const fixture = await makeCappedPrismFixture()
    const bytes = archive(rhino, fixture, (source, keep) => {
      const solid = keep(keep(keep(source.objects()).get(0)).geometry()) as Brep
      return handles((hold) => {
        const doc = hold(new rhino.File3dm())
        hold(doc.settings()).modelUnitSystem = rhino.UnitSystem.Centimeters
        const attributes = hold(new rhino.ObjectAttributes())
        const definitions = hold(doc.instanceDefinitions())
        const index = definitions.add('Test block', '', '', '', [0, 0, 0], [solid], [attributes])
        const block = hold(definitions.get(index))
        const transform = hold(rhino.Transform.translationXYZ(5, -3, 2))
        transform.m00 = 0
        transform.m02 = 1
        transform.m20 = -1
        transform.m22 = 0
        const Reference = rhino.InstanceReference as unknown as new (
          id: string,
          transform: Transform,
        ) => InstanceReference
        hold(doc.objects()).addInstanceObject(hold(new Reference(block.id, transform)), attributes)
        return doc.toByteArray()
      })
    })
    const file = join(directory, 'placed test sleeve.3dm')
    await writeFile(file, bytes)
    const digest = sha256(bytes)
    const { status, reports } = check(file)
    expect(reports).toMatchObject([
      {
        result: 'passed',
        sha256: { before: digest, after: digest },
        nativeEdges: {
          status: 'passed',
          partsChecked: 1,
          placedPartsChecked: 1,
          linearEdges: 1,
          nonlinearEdges: 1,
          rationalEdges: 1,
          samples: expect.any(Number),
          maxErrorMm: expect.any(Number),
        },
        nativeCaps: {
          status: 'passed',
          candidatesChecked: 1,
          beforeSpanMm: 20,
          afterSpanMm: 20.25,
          innerLoops: 1,
        },
      },
    ])
    expect(reports[0].nativeEdges.samples).toBeGreaterThan(4)
    expect(reports[0].nativeEdges.maxErrorMm).toBeLessThan(1e-6)
    expect(reports[0].nativeCaps.fixedEndMaxErrorMm).toBeLessThan(1e-6)
    expect(reports[0].nativeCaps.movedEndMaxErrorMm).toBeLessThan(1e-6)
    expect(status).toBe(0)
    expect(sha256(await readFile(file))).toBe(digest)
  })

  it('checks exact curves, skips, placements and a native-to-mesh edit followed by undo', async () => {
    const file = await writeModel('public test fixture.3dm', 'mixed')
    const digest = sha256(await readFile(file))
    const { status, reports } = check(file)
    expect(reports).toMatchObject([
      {
        result: 'passed',
        sha256: { before: digest, after: digest },
        source: {
          objects: { Point: 1, NurbsCurve: 1, Brep: 1, InstanceReference: 2 },
          definitionMembers: 1,
          placedBlockInstances: 2,
          instanceDefinitions: 1,
          repeatedDefinitions: 1,
        },
        imported: {
          units: 'centimetres',
          meshParts: 2,
          nativeParts: 2,
          editableCurves: 1,
          rationalCurves: 1,
          skipped: 1,
        },
        curves: { roundTripped: 1, sourceCompared: 1, editedAndUndone: true },
        bodies: { baseline: 'BRep', edited: 'mesh', undone: 'BRep', untouched: 'BRep' },
        nativeCaps: { status: 'not run: no eligible end caps', candidatesChecked: 1 },
      },
    ])
    expect(status).toBe(0)
    expect(sha256(await readFile(file))).toBe(digest)
  })

  it('reports unsupported-only and malformed archives without dropping the remaining files', async () => {
    const malformed = join(directory, 'malformed.3dm')
    await writeFile(malformed, 'invalid archive')
    const file = await writeModel('point.3dm', 'point')
    const { status, reports } = check(malformed, file)
    expect(status).toBe(1)
    expect(reports).toMatchObject([
      { result: 'failed', failure: { stage: 'Rhino import' } },
      { result: 'failed', failure: { stage: 'usable geometry' }, imported: { skipped: 1 } },
    ])
    for (const report of reports) expect(report.sha256.before).toBe(report.sha256.after)
  })

  it('reports absent native tools while accepting mesh-only and curve-only geometry', async () => {
    const mesh = await writeModel('mesh.3dm', 'mesh')
    const curve = await writeModel('curve.3dm', 'curve')
    const { status, reports } = check(mesh, curve)
    expect(status).toBe(0)
    expect(reports).toMatchObject([
      { result: 'passed', bodies: { baseline: 'mesh', edited: 'mesh', undone: 'mesh' } },
      { result: 'passed', curves: { roundTripped: 1, editedAndUndone: true } },
    ])
    for (const report of reports) {
      expect(report.nativeEdges.status).toBe('not run: no retained native solid')
      expect(report.nativeCaps.status).toBe('not run: no retained native solid')
      expect(report.sha256.before).toBe(report.sha256.after)
    }
  })
})
