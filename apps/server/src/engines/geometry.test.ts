/** The kernel through the server: evaluation, cached facts, exports and tenancy. */
import { readRhino3dm } from '@pave/kernel/rhino-import'
import { resolveScene, sceneHash } from '@pave/render'
import { type CommandInput, type EvaluationSummary, RenderSceneSchema } from '@pave/schema'
import rhino3dm from 'rhino3dm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freeRhino } from '../../../../packages/kernel/src/runtime/rhino'
import { framingRefusal } from '../cinema'
import { serviceContext } from '../service-context'
import { assetBytes, engineServer, until } from '../test/engines'
import { BOOT_TIMEOUT, type Client, client, signUp, type TestServer } from '../test/harness'

const metal = (s: EvaluationSummary) => s.metals.map((m) => m.material)

describe('geometry engine', () => {
  let server: TestServer
  let api: Client
  beforeAll(async () => {
    server = await engineServer()
    api = client(server)
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('evaluates template pieces to plausible facts, at draft and production detail', async () => {
    const solitaire = await api.call('pieces.create', { templateId: 'solitaire' })
    const draft = await api.call('design.evaluate', { pieceId: solitaire.id })
    // A US 6 platinum band with a 1 ct round in four claws.
    expect(draft.stoneCount).toBe(1)
    expect(draft.caratTotal).toBeCloseTo(1, 1)
    expect(draft.lots).toEqual([expect.objectContaining({ cut: 'round', count: 1 })])
    expect(metal(draft)).toEqual(['pt950'])
    expect(draft.metalMassG).toBeGreaterThan(2)
    expect(draft.metalMassG).toBeLessThan(8)
    // Outer width of a US 6 shank (16.5 mm inside) plus the walls.
    expect(draft.boundsMm.x).toBeGreaterThan(17)
    expect(draft.boundsMm.x).toBeLessThan(23)
    expect(draft.diagnostics.filter((d) => d.level === 'error')).toEqual([])

    const production = await api.call('design.evaluate', {
      pieceId: solitaire.id,
      detail: 'production',
    })
    expect(production.stoneCount).toBe(1)
    // Seats are cut at production detail: a little less metal, never more than a gram.
    expect(production.metalMassG).toBeLessThanOrEqual(draft.metalMassG + 0.01)
    expect(draft.metalMassG - production.metalMassG).toBeLessThan(1)

    const band = await api.call('design.evaluate', {
      pieceId: (await api.call('pieces.create', { templateId: 'wedding-band' })).id,
    })
    expect([band.stoneCount, band.caratTotal]).toEqual([0, 0])
    expect(band.metalMassG).toBeGreaterThan(2)

    const halo = await api.call('design.evaluate', {
      pieceId: (await api.call('pieces.create', { templateId: 'halo' })).id,
    })
    expect(halo.stoneCount).toBeGreaterThan(12)
    expect(halo.lots.map((l) => l.role)).toEqual(expect.arrayContaining(['center']))
    expect(halo.caratTotal).toBeGreaterThan(1)
  })

  it('caches facts on the piece after each change, in the background', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const first = await until(
      () => api.call('pieces.get', { id: piece.id }),
      (p) => p.facts !== null,
    )
    expect(first.facts).toMatchObject({ stoneCount: 1, metal: 'pt950' })
    const shank = Object.values(first.design.nodes).find((n) => n.kind === 'ringShank')!
    const { version } = await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Widen the band',
      ops: [{ t: 'update', id: shank.id, patch: { widthTop: 4, widthBottom: 4 } }],
    })
    const widened = await until(
      () => api.call('pieces.get', { id: piece.id }),
      (p) => p.version === version && p.facts!.metalMassG > first.facts!.metalMassG + 0.5,
    )
    expect(widened.facts!.caratTotal).toBeCloseTo(first.facts!.caratTotal, 6)
  })

  it('caches facts from production detail only, so they never flip with who asked last', async () => {
    // Seats are cut at production detail: a draft overstates an eternity's metal by a third.
    const piece = await api.call('pieces.create', { templateId: 'eternity' })
    const cached = await until(
      () => api.call('pieces.get', { id: piece.id }),
      (p) => p.facts !== null,
    )
    const production = await api.call('design.evaluate', {
      pieceId: piece.id,
      detail: 'production',
    })
    expect(cached.facts!.metalMassG).toBeCloseTo(production.metalMassG, 6)
    const draft = await api.call('design.evaluate', { pieceId: piece.id, detail: 'draft' })
    expect(draft.metalMassG).toBeGreaterThan(production.metalMassG + 0.1)
    expect((await api.call('pieces.get', { id: piece.id })).facts).toEqual(cached.facts)
  })

  // A pendant's chain is left out of its pictures; a chain that is the whole piece is not.
  it.each(['halo', 'cuban'])(
    'draws a clay cover of a built %s, in its metal, when it has none',
    async (templateId) => {
      const piece = await api.call('pieces.create', { templateId })
      const covered = await until(
        () => api.call('pieces.get', { id: piece.id }),
        (p) => p.coverAssetId !== null,
      )
      const bytes = await assetBytes(api, { url: `/api/assets/${covered.coverAssetId}` })
      const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
      expect([info.width, info.height]).toEqual([768, 768])
      // The piece fills the middle: its pixels differ from the plain ground in the corner.
      const at = (x: number, y: number) => {
        const i = (y * info.width + x) * info.channels
        return [data[i]!, data[i + 1]!, data[i + 2]!]
      }
      const ground = at(4, 4)
      let drawn = 0
      for (let y = 0; y < info.height; y += 8)
        for (let x = 0; x < info.width; x += 8)
          if (at(x, y).some((c, k) => Math.abs(c - ground[k]!) > 24)) drawn++
      const samples = (info.width / 8) * (info.height / 8)
      expect(drawn / samples).toBeGreaterThan(0.015)
      expect(drawn / samples).toBeLessThan(0.7)
    },
  )

  it('refuses to export or produce a piece with nothing in it, as a conflict', async () => {
    const empty = await api.call('pieces.create', { title: 'Nothing yet' })
    const exported = await api.fail('design.export', { pieceId: empty.id, format: 'stl' })
    expect([exported.status, exported.error.message]).toEqual([
      409,
      expect.stringMatching(/^Nothing to export/),
    ])
    expect((await api.fail('production.create', { pieceId: empty.id })).status).toBe(409)
    expect(await api.call('production.list', { pieceId: empty.id })).toEqual([])
  })

  it.each([false, true])(
    'frames a preview of unassigned Rhino bodies with cast metal present: %s',
    async (mixed) => {
      const rhino = await rhino3dm()
      const doc = new rhino.File3dm()
      const mesh = new rhino.Mesh()
      const settings = doc.settings()
      const objects = doc.objects()
      const vertices = mesh.vertices()
      const faces = mesh.faces()
      const attrs = new rhino.ObjectAttributes()
      settings.modelUnitSystem = rhino.UnitSystem.Millimeters
      for (const [x, y, z] of [
        [8, 0, 0],
        [12, 0, 0],
        [8, 4, 0],
        [8, 0, 4],
      ] as const)
        vertices.add(x, y, z)
      for (const [a, b, c] of [
        [0, 2, 1],
        [0, 1, 3],
        [0, 3, 2],
        [1, 2, 3],
      ] as const)
        faces.addTriFace(a, b, c)
      objects.addMesh(mesh, attrs)
      const bytes = doc.toByteArray().slice()
      for (const handle of [attrs, faces, vertices, objects, settings, mesh, doc]) freeRhino(handle)
      const {
        objects: [source],
      } = await readRhino3dm(bytes)
      const form = new FormData()
      form.set('file', new File([new Uint8Array(source!.bytes)], 'rhino-solid.stl'))
      const uploaded = await api.request('/api/assets', { method: 'POST', body: form })
      expect(uploaded.status).toBe(201)
      const { id: assetId } = (await uploaded.json()) as { id: string }
      const piece = await api.call('pieces.create', {
        title: 'Imported Rhino render',
        kind: 'ring',
      })
      const legacy = !mixed ? await api.call('scenes.ensureDefaults', { pieceId: piece.id }) : null
      const prior = legacy
        ? await api.call('renders.create', { pieceId: piece.id, sceneId: legacy.shots[0]!.id })
        : null
      if (prior) await api.call('renders.complete', { id: prior.id, assetIds: [assetId] })
      const input = {
        kind: 'meshBody' as const,
        source: {
          type: 'asset' as const,
          assetId,
          rhinoLayer: 'Fixture',
          rhinoContext: { groups: [], placements: [], material: 'Emerald' },
        },
        keepSourcePlacement: true,
      }
      const ops = [
        { t: 'add', node: { ...input, id: 'unassigned' } },
        {
          t: 'add',
          node: { ...input, id: 'hidden', visible: false, transform: { position: [40, 0, 0] } },
        },
        {
          t: 'add',
          node: {
            ...input,
            id: 'reference',
            importRole: 'reference',
            transform: { position: [80, 0, 0] },
          },
        },
        ...(mixed
          ? [
              {
                t: 'add',
                node: {
                  ...input,
                  id: 'cast-metal',
                  importRole: 'metal',
                  material: 'au18k-yellow',
                  transform: { position: [-8, 0, 0] },
                },
              } as const,
            ]
          : []),
      ] satisfies CommandInput<'design.apply'>['ops']
      await api.call('design.apply', {
        pieceId: piece.id,
        label: 'Import fixture bodies',
        ops,
      })
      const opened = await api.call('scenes.ensureDefaults', { pieceId: piece.id })
      expect(opened.shots.map(({ title }) => title)).toEqual(['Hero', 'Front', 'Top', 'Macro'])
      if (legacy) expect(opened.shots.map(({ id }) => id)).toEqual(legacy.shots.map(({ id }) => id))
      for (const shot of opened.shots) {
        expect(shot.scene.includeUnassignedRhino).toBe(mixed ? undefined : true)
        expect(shot.scene.importedBodyLook).toBe(mixed ? undefined : 'source')
      }
      expect(await api.call('scenes.list', { pieceId: piece.id })).toEqual(opened.shots)
      if (prior) {
        const done = await api.call('renders.get', { id: prior.id })
        expect(done.status).toBe('done')
        expect(done.scene).toEqual(prior.scene)
        expect(done.requestedScene).toEqual(prior.requestedScene)
        const fresh = await api.call('pieces.create', { kind: 'ring' })
        await api.call('design.apply', { pieceId: fresh.id, label: 'Import', ops })
        const defaults = await api.call('scenes.ensureDefaults', { pieceId: fresh.id })
        for (const shot of defaults.shots) {
          expect(shot.scene).toMatchObject({
            includeUnassignedRhino: true,
            importedBodyLook: 'source',
          })
          const take = await api.call('renders.create', { pieceId: fresh.id, sceneId: shot.id })
          expect(take.requestedScene).toEqual(shot.scene)
        }
        const hero = opened.shots[0]!
        const request = { pieceId: piece.id, sceneId: hero.id, engine: 'browser' as const }
        const agent = await server.runtime.context({
          ...server.runtime.local!,
          actor: { type: 'agent', runId: 'render-import-only' },
        })
        expect(await framingRefusal(agent, request)).toBeNull()
        const authored = await server.runtime.invoke('renders.create', request, agent)
        expect(authored?.requestedScene).toEqual(hero.scene)
        const estimate = (takes: CommandInput<'renders.estimate'>['takes']) =>
          api.call('renders.estimate', { pieceId: piece.id, takes, engine: 'blender' })
        expect(await estimate([{ sceneId: hero.id }])).toEqual(
          await estimate([{ scene: hero.scene }]),
        )
        await api.call('design.apply', {
          pieceId: fresh.id,
          label: 'Hide the only visible unassigned body',
          ops: [{ t: 'update', id: 'unassigned', patch: { visible: false } }],
        })
        const [noVisible] = await api.call('scenes.list', { pieceId: fresh.id })
        expect(noVisible?.scene.includeUnassignedRhino).toBeUndefined()
        expect(
          (
            await api.fail('renders.create', {
              ...request,
              pieceId: fresh.id,
              sceneId: noVisible!.id,
            })
          ).status,
        ).toBe(409)
        const clay = await api.call('scenes.update', {
          id: hero.id,
          patch: { includeUnassignedRhino: true, importedBodyLook: 'clay' },
        })
        expect(clay.scene.importedBodyLook).toBe('clay')
        expect(
          (await api.call('renders.create', { pieceId: piece.id, sceneId: hero.id }))
            .requestedScene,
        ).toEqual(clay.scene)
        const hidden = await api.call('scenes.update', {
          id: hero.id,
          patch: { includeUnassignedRhino: false },
        })
        expect(hidden.scene.includeUnassignedRhino).toBe(false)
        expect(
          (await api.fail('renders.create', { pieceId: piece.id, sceneId: hero.id })).status,
        ).toBe(409)
        const restored = await api.call('scenes.revert', { id: hero.id })
        expect(restored.scene.scene).toEqual(clay.scene)
      }
      const savedPiece = await api.call('pieces.get', { id: piece.id })
      const evaluate = () =>
        api.call('design.evaluate', { pieceId: piece.id, detail: 'production' })
      const before = await evaluate()
      const ctx = await server.runtime.context(server.runtime.local!)
      const geometry = ctx.services.get('geometry')
      const casting = () =>
        geometry.export(savedPiece.design, { format: 'stl', stones: false }, serviceContext(ctx))
      const originalCasting = mixed ? (await casting()).file.bytes : null
      const saved = await api.call('scenes.create', {
        pieceId: piece.id,
        title: 'Catalog',
        scene: { look: 'catalog-white' },
      })
      const scene = (
        await api.call('scenes.update', { id: saved.id, patch: { includeUnassignedRhino: true } })
      ).scene
      expect(scene.importedBodyLook).toBe(mixed ? undefined : 'source')
      const reopened = await api.call('scenes.list', { pieceId: piece.id })
      expect(reopened.find(({ id }) => id === saved.id)?.scene).toEqual(scene)

      const { glb, subject } = await geometry.renderInput(savedPiece.design, serviceContext(ctx), {
        pieceId: piece.id,
        includeUnassignedRhino: true,
      })
      expect(subject.parts.map((part) => part.nodeId).sort()).toEqual(
        mixed ? ['cast-metal', 'unassigned'] : ['unassigned'],
      )
      expect(subject.bounds).toEqual({ min: [mixed ? 0 : 8, 0, 0], max: [12, 4, 4] })
      const data = glb.bytes
      const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(12, true)
      const exported = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + length))) as {
        nodes: { name: string; mesh?: number }[]
      }
      expect(
        exported.nodes
          .filter((node) => node.mesh !== undefined)
          .map((node) => node.name)
          .sort(),
      ).toEqual(subject.parts.map((part) => part.id).sort())
      const resolved = resolveScene({ ...scene, importedBodyLook: 'clay' }, subject)
      expect(resolved.materials[resolved.assignments.unassigned!]).toMatchObject({
        kind: 'surface',
      })
      const sourceScene = RenderSceneSchema.parse({ ...scene, importedBodyLook: 'source' })
      const color = resolveScene(sourceScene, subject)
      expect(
        subject.parts.find((part) => part.nodeId === 'unassigned')?.sourceAppearance,
      ).toMatchObject({
        kind: 'gem',
        stone: 'emerald',
      })
      expect(color.materials[color.assignments.unassigned!]).toMatchObject({
        kind: 'gem',
        ior: expect.any(Number),
        attenuationColor: [0.05, 0.6, 0.25],
      })
      expect(Object.keys(color.assignments).sort()).toEqual(
        Object.keys(resolved.assignments).sort(),
      )
      const assigned = subject.parts.find(({ nodeId }) => nodeId === 'cast-metal')
      if (assigned) {
        expect(resolved.assignments[assigned.id]).toContain('au18k-yellow')
        expect(color.assignments[assigned.id]).toBe(resolved.assignments[assigned.id])
      }

      const capture = await api.call('scenes.capture', { ids: [saved.id], size: 192 })
      expect(capture.version).toBe(savedPiece.version)
      expect(capture.shots[0]).toMatchObject({ ok: true, assetId: expect.any(String) })
      const pixels = await assetBytes(api, { url: `/api/assets/${capture.shots[0]!.assetId}` })
      const stats = await sharp(pixels).stats()
      expect(stats.channels[0]!.stdev).toBeGreaterThan(12)
      const take = await api.call('renders.create', {
        pieceId: piece.id,
        sceneId: saved.id,
        engine: 'browser',
      })
      expect(take.sourceVersion).toBe(savedPiece.version)
      expect(take.scene).toEqual(scene)
      expect(take.requestedScene).toEqual(scene)
      const cameraDesign = { pieceId: piece.id, version: savedPiece.version }
      const off = RenderSceneSchema.parse({ ...scene, includeUnassignedRhino: false })
      const original = await geometry.subject!(savedPiece.design, serviceContext(ctx))
      expect(original.parts.map(({ nodeId }) => nodeId)).toEqual(mixed ? ['cast-metal'] : [])
      expect(sceneHash(resolved, cameraDesign)).not.toBe(
        sceneHash(resolveScene(off, original), cameraDesign),
      )
      expect(await evaluate()).toEqual(before)
      expect(before.metalMassG > 0).toBe(mixed)
      expect(before.stoneCount).toBe(0)
      expect((await api.call('pieces.get', { id: piece.id })).version).toBe(savedPiece.version)
      if (mixed) expect((await casting()).file.bytes).toEqual(originalCasting)
      else
        expect((await api.fail('design.export', { pieceId: piece.id, format: 'stl' })).status).toBe(
          409,
        )
    },
  )

  it('exports STL, STEP, 3DM and GLB files that parse', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const files: Record<string, Uint8Array> = {}
    for (const format of ['stl', 'step', '3dm', 'glb'] as const) {
      const { asset } = await api.call('design.export', { pieceId: piece.id, format })
      expect(asset.kind).toBe('mesh')
      expect(asset.name).toBe(`piece.${format}`)
      files[format] = await assetBytes(api, asset)
    }
    const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

    const stl = files.stl!
    const triangles = view(stl).getUint32(80, true)
    expect(triangles).toBeGreaterThan(500)
    expect(stl.byteLength).toBe(84 + 50 * triangles)

    const step = new TextDecoder().decode(files.step!)
    expect(step.startsWith('ISO-10303-21;')).toBe(true)
    expect(step).toMatch(/MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS|ADVANCED_FACE/)
    expect(step.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true)

    const rhino = await rhino3dm()
    const doc = rhino.File3dm.fromByteArray(files['3dm']!)
    expect(doc).toBeTruthy()
    expect(doc.objects().count).toBeGreaterThan(0)

    const glb = files.glb!
    expect(new TextDecoder().decode(glb.subarray(0, 4))).toBe('glTF')
    expect(view(glb).getUint32(4, true)).toBe(2)
    expect(view(glb).getUint32(8, true)).toBe(glb.byteLength)
    const jsonLength = view(glb).getUint32(12, true)
    const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as {
      nodes: { extras?: { role?: string } }[]
    }
    expect(gltf.nodes.map((n) => n.extras?.role)).toEqual(expect.arrayContaining(['metal', 'gem']))
  })

  it('keeps serving other requests while a heavy piece evaluates', async () => {
    const trophy = await api.call('pieces.create', { templateId: 'iced-trophy' })
    const heavy = api.call('design.evaluate', { pieceId: trophy.id, detail: 'production' })
    const started = performance.now()
    await api.call('pieces.list', {})
    expect(performance.now() - started).toBeLessThan(1_000)
    expect((await heavy).stoneCount).toBeGreaterThan(100)
  })
})

describe('geometry engine tenancy', () => {
  let server: TestServer
  beforeAll(async () => {
    server = await engineServer({ auth: 'accounts' })
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('never evaluates or exports another organisation’s piece', async () => {
    const ada = await signUp(server, 'Ada Lovelace', 'ada@example.com')
    const ben = await signUp(server, 'Ben Franklin', 'ben@example.com')
    const piece = await ada.call('pieces.create', { templateId: 'solitaire' })
    expect((await ada.call('design.evaluate', { pieceId: piece.id })).stoneCount).toBe(1)
    for (const [name, input] of [
      ['design.evaluate', { pieceId: piece.id }],
      ['design.export', { pieceId: piece.id, format: 'stl' }],
      ['production.create', { pieceId: piece.id }],
      ['renders.create', { pieceId: piece.id, scene: {}, engine: 'blender' }],
    ] as const)
      expect((await ben.fail(name, input)).status).toBe(404)
  })
})
