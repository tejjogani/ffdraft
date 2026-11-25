import type { EvaluationSummary, Piece } from '@pave/schema'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { seedWelcome } from './seed'
import type { Services } from './services'
import { BOOT_TIMEOUT, type Client, client, type TestServer, testServer } from './test/harness'

const summary: EvaluationSummary = {
  metalMassG: 3.2,
  metals: [{ material: 'au18k-yellow', volumeMm3: 200, massG: 3.2 }],
  stoneCount: 1,
  caratTotal: 1,
  lots: [],
  boundsMm: { x: 20, y: 22, z: 8 },
  diagnostics: [],
}

/** A stand-in for the kernel's rasteriser: a mid-grey square with a darker centre. */
const picture = vi.fn<NonNullable<Services['geometry']['picture']>>(async (_design, { size }) => {
  const rgba = new Uint8Array(size * size * 4).fill(200)
  for (let y = size / 4; y < (3 * size) / 4; y++)
    for (let x = size / 4; x < (3 * size) / 4; x++)
      rgba.fill(90, (y * size + x) * 4, (y * size + x) * 4 + 3)
  return { images: [rgba], summary }
})

let server: TestServer
let api: Client
const submitRender = vi.fn<Services['renderQueue']['submit']>(async () => {})

beforeAll(async () => {
  server = await testServer({
    services: {
      geometry: {
        capabilities: { mesh3d: ['kernel'] },
        evaluate: async () => summary,
        export: async () => {
          throw new Error('not used')
        },
        renderInput: async () => {
          throw new Error('not used')
        },
        picture,
      },
    },
  })
  server.runtime.services.register('renderQueue', {
    capabilities: { blender: true },
    submit: submitRender,
    cancel: async () => {},
  })
  api = client(server)
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

const get = (id: string) => api.call('pieces.get', { id })
const withCover = (id: string) =>
  vi.waitFor(
    async () => {
      const p = await get(id)
      expect(p.coverAssetId).not.toBeNull()
      return p
    },
    { timeout: 10_000 },
  )
const withFacts = (id: string, version: number) =>
  vi.waitFor(
    async () => {
      const p = await get(id)
      expect(p.facts).not.toBeNull()
      expect(p.version).toBe(version)
      return p
    },
    { timeout: 10_000 },
  )
/** Facts are stored before the cover is drawn; give a cover that should not come time to. */
const settle = () => new Promise((r) => setTimeout(r, 400))

async function upload(): Promise<string> {
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123' } })
    .png()
    .toBuffer()
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes)], 'mine.png', { type: 'image/png' }))
  const res = await api.request('/api/assets', { method: 'POST', body: form })
  return ((await res.json()) as { id: string }).id
}

// Each test waits on background work (facts, then the cover) on a shared machine.
describe('clay covers drawn on the server', { timeout: 40_000 }, () => {
  it('give a piece built from a template a picture of its own geometry', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const covered = await withCover(piece.id)
    // Still automatic: a studio capture or a finished render may replace it.
    expect(covered.coverAuto).toBe(true)
    const [design, opts] = picture.mock.calls.at(-1)!
    expect(design.order).toEqual(covered.design.order)
    expect(opts).toMatchObject({ views: ['hero'], pieceId: piece.id, background: true })
    // Tinted with the piece's main metal (18k yellow gold, #E6BE6A), darkened a little.
    expect(opts.metal![0]).toBeGreaterThan(opts.metal![2]!)
    const asset = await api.request(`/api/assets/${covered.coverAssetId}`)
    expect(asset.headers.get('content-type')).toBe('image/png')
    // Drawn larger and scaled down, so its edges are smooth.
    expect(opts.size).toBeGreaterThan(768)
    const meta = await sharp(new Uint8Array(await asset.arrayBuffer())).metadata()
    expect([meta.width, meta.height]).toEqual([768, 768])
  })

  it('wait for an empty piece to be built', async () => {
    const piece = await api.call('pieces.create', { kind: 'ring' })
    await withFacts(piece.id, piece.version)
    await settle()
    expect((await get(piece.id)).coverAssetId).toBeNull()
    const { spec } = await api.call('pieces.create', { templateId: 'halo' })
    await api.call('pieces.setSpec', { id: piece.id, spec: spec! })
    await api.call('pieces.buildFromSpec', { id: piece.id })
    expect((await withCover(piece.id)).coverAuto).toBe(true)
  })

  it('are drawn once, not again on every edit', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    const first = (await withCover(piece.id)).coverAssetId
    const calls = picture.mock.calls.length
    const { version } = await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Wider',
      ops: [{ t: 'update', id: 'band', patch: { widthTop: 5, widthBottom: 5 } }],
    })
    await withFacts(piece.id, version)
    await settle()
    expect((await get(piece.id)).coverAssetId).toBe(first)
    expect(picture.mock.calls.length).toBe(calls)
  })

  it('never replace a cover a person chose', async () => {
    const piece = await api.call('pieces.create', { kind: 'ring' })
    const mine = await upload()
    await api.call('pieces.update', { id: piece.id, coverAssetId: mine })
    const { spec } = await api.call('pieces.create', { templateId: 'solitaire' })
    await api.call('pieces.setSpec', { id: piece.id, spec: spec! })
    const { version } = await api.call('pieces.buildFromSpec', { id: piece.id })
    await withFacts(piece.id, version)
    await settle()
    expect(await get(piece.id)).toMatchObject({ coverAssetId: mine, coverAuto: false })
  })

  it('give way to the first finished render', async () => {
    const piece = await api.call('pieces.create', { templateId: 'halo' })
    const clay = (await withCover(piece.id)).coverAssetId
    const still = await upload()
    const job = await api.call('renders.create', { pieceId: piece.id, scene: {} })
    const handle = submitRender.mock.calls.find(([j]) => j.id === job.id)![2]
    await handle.update({ status: 'done', progress: 1, assetIds: [still] })
    const after = await get(piece.id)
    expect(after.coverAssetId).not.toBe(clay)
    expect(after).toMatchObject({ coverAssetId: still, coverAuto: true })
  })

  it('give every example of the welcome workspace a picture', async () => {
    const local = server.runtime.local!
    const ctx = await server.runtime.context({ ...local, actor: { type: 'system' } })
    const before = new Set((await api.call('pieces.list', {})).map((p) => p.id))
    await seedWelcome(server.runtime, ctx)
    const seeded = (await api.call('pieces.list', {})).filter((p) => !before.has(p.id))
    expect(seeded.length).toBeGreaterThanOrEqual(10)
    await vi.waitFor(
      async () => {
        const pieces: Piece[] = await Promise.all(seeded.map((p) => get(p.id)))
        expect(pieces.filter((p) => !p.coverAssetId).map((p) => p.title)).toEqual([])
      },
      { timeout: 30_000, interval: 250 },
    )
  })
})
