/** The kernel through the server: evaluation, cached facts, exports and tenancy. */
import type { EvaluationSummary } from '@pave/schema'
import rhino3dm from 'rhino3dm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
