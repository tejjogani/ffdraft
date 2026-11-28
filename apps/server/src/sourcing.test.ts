import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { writeStl } from '@pave/kernel/mesh-stl'
import type { RhinoContext } from '@pave/schema'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { putAsset } from './assets/assets'
import { BOOT_TIMEOUT, type Client, signUp, type TestServer, testServer } from './test/harness'

const access = {
  level: 'signed_out',
  prices: false,
  markup: false,
  prices_hidden_reason: 'signed_out',
}
const diaexBrowse = 'https://thediaex.com/browse'
const bestId = 'T-RD.01/1'
const inventoryStone = (id = bestId) => ({
  id,
  url: `${diaexBrowse}?stone=${encodeURIComponent(id)}`,
  shape: 'round brilliant',
  shape_group: 'round',
  carat: 1.01,
  origin: 'natural',
  growth: null,
  color: 'G',
  fancy_color: null,
  fancy_hue: null,
  fancy_intensity: null,
  clarity: 'VS1',
  cut: 'EX',
  polish: 'EX',
  symmetry: 'EX',
  fluorescence: 'NONE',
  treatment: 'UNKNOWN',
  measurements: { length_mm: 6.51, width_mm: 6.5, height_mm: 4.02, ratio: 1 },
  profile: {
    table_pct: 58,
    depth_pct: 62,
    crown_angle: 34.5,
    crown_height_pct: 14,
    pavilion_angle: 40.8,
    pavilion_depth_pct: 43,
    girdle_thin: null,
    girdle_thick: null,
    culet: null,
  },
  certificate: {
    lab: 'GIA',
    report_no: '2141438171',
    report_url: 'https://www.gia.edu/report-check?reportno=2141438171',
  },
  media: { image_url: null, video_url: null },
  location: { country: 'US', city: 'New York' },
  availability: 'available',
  price: null,
  price_per_carat: null,
  has_pair: false,
  stock_id: id,
  supplier: null,
  etag: 'W/"b41c09e2"',
  updated_at: '2026-11-23T18:02:11Z',
})

interface PartnerRequest {
  method: string | undefined
  path: string | undefined
  authorization: string | undefined
  cookie: string | undefined
  cacheControl: string | undefined
  body: { requirement?: { ref?: string } }
}

const requests: PartnerRequest[] = []
let answer: (req: PartnerRequest) => { status?: number; body: unknown }
let partner: Server
let server: TestServer
let owner: Client
let outsider: Client
let pieceId: string

beforeAll(async () => {
  partner = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    const request = {
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
      cacheControl: req.headers['cache-control'],
      body: raw ? JSON.parse(raw) : {},
    }
    requests.push(request)
    const { status = 200, body } = answer(request)
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => {
    partner.listen(0, '127.0.0.1', resolve)
  })
  const { port } = partner.address() as AddressInfo
  server = await testServer({
    auth: 'accounts',
    config: { diaexPartnerApiUrl: `http://127.0.0.1:${port}/partner/v1` },
  })
  owner = await signUp(server, 'Designer', 'designer@example.test')
  outsider = await signUp(server, 'Other designer', 'other@example.test')
  pieceId = (
    await owner.call('pieces.create', { templateId: 'solitaire', title: 'Private client title' })
  ).id
}, BOOT_TIMEOUT)

beforeEach(() => {
  requests.length = 0
  answer = () => ({ body: { stone: inventoryStone(), access } })
})

afterAll(async () => {
  await server?.dispose()
  if (partner)
    await new Promise<void>((resolve) => {
      partner.close(() => resolve())
    })
})

const gem = () => ({ pieceId, nodeId: 'center' })
const candidate = {
  sku: bestId,
  url: `${diaexBrowse}?stone=T-RD.01%2F1`,
  measured: { length: 6.51, width: 6.5, depth: 4.02 },
  color: 'G',
  clarity: 'VS1',
  origin: 'natural',
  carat: 1.01,
  certificate: '2141438171',
}

const signedOutSearch = (req: PartnerRequest, stones: unknown[]) => ({
  ref: req.body.requirement?.ref,
  candidates: stones.map((stone) => ({
    stone,
    fit: { d_length_mm: 0.01, d_width_mm: 0, d_height_mm: null, in_window: true, score: 0.96 },
  })),
  total: stones.length,
  next_cursor: null,
  dropped: [],
  search_url: `${diaexBrowse}?f=%7B%22shapes%22%3A%5B%22round%22%5D%7D`,
  access,
})

describe('Diaex inventory RPCs', () => {
  it('asks for a wider best-fit window and returns only compatible, pickable stones in provider order', async () => {
    answer = (req) => ({
      body: signedOutSearch(req, [
        { ...inventoryStone('private'), availability: 'future_status' },
        {
          ...inventoryStone('far'),
          measurements: { length_mm: 17, width_mm: 17, height_mm: 10, ratio: 1 },
        },
        {
          ...inventoryStone(),
          supplier: { name: 'Private Supplier' },
          stock_id: 'private-reference',
        },
        {
          ...inventoryStone('T-RD-02'),
          certificate: { lab: null, report_no: null, report_url: null },
        },
        { ...inventoryStone('T-RD-03'), color: 'H' },
      ]),
    })

    const result = await owner.call('sourcing.search', { ...gem(), color: 'g' })
    expect(result.candidates).toEqual([
      candidate,
      { ...candidate, sku: 'T-RD-02', url: `${diaexBrowse}?stone=T-RD-02`, certificate: undefined },
    ])
    expect(new URL(result.searchUrl).origin).toBe('https://thediaex.com')
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/partner/v1/stones/search',
        authorization: undefined,
        cookie: undefined,
        cacheControl: 'no-cache, no-store',
        body: {
          requirement: {
            ref: expect.stringMatching(/^[A-Za-z0-9_-]{1,64}$/),
            kind: 'single',
            quantity: 1,
            gem: 'diamond',
            shape: 'round',
            origin: 'any',
            seat: { length_mm: 6.44, width_mm: 6.44, tol_minus_mm: 0.3, tol_plus_mm: 0.3 },
            colors: ['G'],
          },
          sort: 'fit',
          limit: 24,
        },
      },
    ])
  })

  it('uses saved grades and a certificate requirement unless a new color is requested', async () => {
    const piece = await owner.call('pieces.create', { templateId: 'solitaire' })
    const target = { pieceId: piece.id, nodeId: 'center' }
    await owner.call('design.replaceStone', {
      pieceId: piece.id,
      target: { nodeId: 'center' },
      change: {
        quality: { origin: 'natural', colors: ['F', 'G'], clarities: ['VS1'], certified: true },
      },
    })
    answer = (req) => ({
      body: signedOutSearch(req, [
        inventoryStone(),
        { ...inventoryStone('T-RD-02'), clarity: 'VS2' },
        { ...inventoryStone('T-RD-03'), color: 'H' },
        {
          ...inventoryStone('T-RD-04'),
          certificate: { lab: null, report_no: null, report_url: null },
        },
      ]),
    })
    const defaults = await owner.call('sourcing.search', target)
    expect(defaults.candidates.map(({ sku }) => sku)).toEqual([bestId])
    expect(requests[0]?.body.requirement).toMatchObject({
      origin: 'natural',
      colors: ['F', 'G'],
      clarities: ['VS1'],
      certificate: { required: true },
    })
    const linkFilters = JSON.parse(new URL(defaults.searchUrl).searchParams.get('f')!)
    expect(linkFilters).toMatchObject({
      colors: ['F', 'G'],
      clarities: ['VS1'],
      labs: expect.arrayContaining(['GIA']),
    })

    const overridden = await owner.call('sourcing.search', { ...target, color: 'H' })
    expect(overridden.candidates.map(({ sku }) => sku)).toEqual(['T-RD-03'])
    expect(requests[1]?.body.requirement).toMatchObject({
      colors: ['H'],
      clarities: ['VS1'],
      certificate: { required: true },
    })
  })

  it('finds a selected fancy stone by exact public ID and rechecks current availability', async () => {
    const fancy = {
      ...inventoryStone(),
      color: null,
      fancy_color: 'Fancy Yellow',
      fancy_hue: 'Yellow',
    }
    answer = () => ({ body: { stone: fancy, access } })
    const initial = await owner.call('sourcing.search', { ...gem(), sku: bestId })
    expect(initial.candidates).toEqual([
      { ...candidate, color: 'Fancy Yellow', fancyHue: 'Yellow' },
    ])
    expect(await owner.call('sourcing.stone', { ...gem(), sku: bestId })).toEqual(
      initial.candidates[0],
    )
    answer = () => ({ body: { stone: { ...fancy, availability: 'on_hold' }, access } })
    expect(await owner.fail('sourcing.stone', { ...gem(), sku: bestId })).toMatchObject({
      status: 409,
    })
    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      ['GET', '/partner/v1/stones/T-RD%2E01%2F1'],
      ['GET', '/partner/v1/stones/T-RD%2E01%2F1'],
      ['GET', '/partner/v1/stones/T-RD%2E01%2F1'],
    ])
  })

  it.each([
    ['different public ID', inventoryStone('T-RD-99')],
    ['different shape', { ...inventoryStone(), shape_group: 'oval' }],
    [
      'missing depth',
      { ...inventoryStone(), measurements: { length_mm: 6.51, width_mm: 6.5, height_mm: null } },
    ],
    [
      'oversize depth',
      { ...inventoryStone(), measurements: { length_mm: 6.51, width_mm: 6.5, height_mm: 41 } },
    ],
    [
      'unsafe link',
      {
        ...inventoryStone(),
        url: 'https://thediaex.com.example.test/browse?stone=T-RD.01%2F1',
      },
    ],
  ])('rejects exact lookups with %s', async (_reason, stone) => {
    answer = () => ({ body: { stone, access } })
    const failure = await owner.fail('sourcing.stone', { ...gem(), sku: bestId })
    expect(failure.error).toMatchObject({ message: expect.stringMatching(/Diaex|stone/) })
    expect(failure.status).toBe(409)
  })

  it('reports a sold or delisted stone when the detail route returns the contract error', async () => {
    answer = () => ({
      status: 404,
      body: {
        error: { code: 'stone_unavailable', message: 'Private provider detail', retryable: false },
      },
    })
    expect(await owner.fail('sourcing.stone', { ...gem(), sku: bestId })).toMatchObject({
      status: 404,
      error: { code: 'not_found', message: expect.not.stringContaining('Private provider detail') },
    })
  })

  it('keeps provider failures private and includes a filtered Diaex link if search is unavailable', async () => {
    answer = () => ({ status: 404, body: { detail: 'Not Found: internal path' } })
    const result = await owner.fail('sourcing.search', { ...gem(), color: 'Yellow' })
    expect(result).toMatchObject({
      status: 503,
      error: { code: 'provider_unavailable', message: expect.stringMatching(/Diaex.*unavailable/) },
    })
    expect(JSON.stringify(result)).not.toContain('internal path')
    const link = new URL(result.error.searchUrl as string)
    expect(link.origin + link.pathname).toBe(diaexBrowse)
    expect(JSON.parse(link.searchParams.get('f')!)).toMatchObject({
      shapes: ['round'],
      fancy_hues: ['Yellow'],
      availability: ['available'],
    })
  })

  it('rejects an incorrectly scoped inventory reply and drops private fields from errors', async () => {
    answer = () => ({
      body: {
        stone: { ...inventoryStone(), supplier: { name: 'Private Supplier' } },
        access: { ...access, level: 'approved', prices: true, prices_hidden_reason: null },
      },
    })
    const failure = await owner.fail('sourcing.stone', { ...gem(), sku: bestId })
    expect(failure).toMatchObject({ status: 503, error: { code: 'provider_unavailable' } })
    expect(JSON.stringify(failure)).not.toContain('Private Supplier')
  })

  it('checks piece and node access before asking Diaex about inventory', async () => {
    expect(await outsider.fail('sourcing.search', gem())).toMatchObject({ status: 404 })
    expect(await outsider.fail('sourcing.stone', { ...gem(), sku: bestId })).toMatchObject({
      status: 404,
    })
    expect(await owner.fail('sourcing.search', { ...gem(), nodeId: 'band' })).toMatchObject({
      status: 400,
    })
    expect(await owner.fail('sourcing.stone', { ...gem(), sku: 'x'.repeat(65) })).toMatchObject({
      status: 400,
    })
    expect(requests).toEqual([])
  })
})

const facetedBody = (tilt: number) => {
  const ring = [
    [-1, -2, 0],
    [1, -2, 0],
    [1, 2, 0],
    [-1, 2, 0],
    [-0.95, -1.95, 0.4],
    [0.95, -1.95, 0.4],
    [0.95, 1.95, 0.4],
    [-0.95, 1.95, 0.4],
    [0, 0, -1],
  ]
  const faces = [4, 5, 6, 4, 6, 7]
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    faces.push(i, j, 4 + i, j, 4 + j, 4 + i, j, i, 8)
  }
  const c = Math.cos(tilt)
  const s = Math.sin(tilt)
  const positions = Float32Array.from(
    ring.flatMap(([x, y, z]) => [x! + 16, c * y! - s * z! + 5, s * y! + c * z! - 3]),
  )
  return writeStl([{ positions, indices: Uint32Array.from(faces) }], 'Imported Rhino facet')
}

async function importedTarget({
  name = 'HBR Diamond_Emerald',
  rhinoObjectName = name,
  tilt = 0.6,
  assetOwner = owner,
  stullerMaterial,
  legacy = false,
}: {
  name?: string
  rhinoObjectName?: string | null
  tilt?: number
  assetOwner?: Client
  stullerMaterial?: RhinoContext['stullerMaterial']
  legacy?: boolean
} = {}) {
  const session = await assetOwner.call('session.get', {})
  const ctx = await server.runtime.context({ userId: session.user.id, orgId: session.activeOrgId })
  const asset = await putAsset(ctx, {
    bytes: facetedBody(tilt),
    name: 'Retained source.stl',
  })
  const piece = await owner.call('pieces.create', { title: 'Imported jewelry' })
  const nodeId = 'rhino-diamond'
  await owner.call('design.apply', {
    pieceId: piece.id,
    label: 'Import from Rhino',
    ops: [
      {
        t: 'add',
        node: {
          id: nodeId,
          name,
          kind: 'meshBody',
          keepSourcePlacement: true,
          ...(!legacy && { importRole: 'unassigned' }),
          source: {
            type: 'asset',
            assetId: asset.id,
            rhinoLayer: 'CAD',
            ...(!legacy && { rhinoObjectName }),
            rhinoContext: { groups: [], placements: [], material: 'Diamond', stullerMaterial },
          },
        },
      },
    ],
  })
  return { pieceId: piece.id, nodeId }
}

describe('read-only Diaex browsing for imported CAD', () => {
  it('uses the table-aligned retained mesh and source cut without modifying the design', async () => {
    const target = await importedTarget({
      name: 'Renamed by designer',
      rhinoObjectName: 'HBR Diamond_Emerald',
    })
    const before = await owner.call('pieces.get', { id: target.pieceId })
    answer = (req) => ({
      body: signedOutSearch(req, [
        {
          ...inventoryStone(),
          shape_group: 'emerald',
          measurements: { length_mm: 4.01, width_mm: 2, height_mm: 1.4 },
        },
        {
          ...inventoryStone('wrong-shape'),
          measurements: { length_mm: 4.01, width_mm: 2, height_mm: 1.4 },
        },
      ]),
    })
    const result = await owner.call('sourcing.search', target)
    expect(result.cadTarget).toEqual({ cut: 'emerald', length: 4, width: 2, depth: 1.4 })
    expect(result.candidates.map(({ sku }) => sku)).toEqual([bestId])
    expect(requests[0]?.body.requirement).toMatchObject({
      shape: 'emerald',
      origin: 'any',
      seat: { length_mm: 4, width_mm: 2, tol_minus_mm: 0.3, tol_plus_mm: 0.3 },
    })
    expect(await owner.call('pieces.get', { id: target.pieceId })).toEqual(before)
  })

  it('uses the legacy leaf name and never guesses a cut from a block or layer label', async () => {
    const target = await importedTarget({ name: 'Oval assembly / HBR Diamond_Round', legacy: true })
    answer = (req) => ({ body: signedOutSearch(req, []) })
    expect((await owner.call('sourcing.search', target)).cadTarget?.cut).toBe('round')

    const unnamed = await importedTarget({ name: 'Part 1 (Round)', rhinoObjectName: null })
    const legacyUnnamed = await importedTarget({ name: 'Part 1 (Oval)', legacy: true })
    for (const source of [unnamed, legacyUnnamed])
      expect(await owner.fail('sourcing.search', source)).toMatchObject({ status: 400 })
    expect(requests).toHaveLength(1)
  })

  it('supports public IDs for browsing while preventing native fit verification on a source mesh', async () => {
    const target = await importedTarget()
    answer = () => ({
      body: { access, stone: { ...inventoryStone(), shape_group: 'emerald' } },
    })
    const browsed = await owner.call('sourcing.search', { ...target, sku: bestId, color: 'G' })
    expect(browsed.candidates).toHaveLength(1)
    expect(browsed.cadTarget).toEqual({ cut: 'emerald', length: 4, width: 2, depth: 1.4 })
    expect(await owner.fail('sourcing.stone', { ...target, sku: bestId })).toMatchObject({
      status: 400,
    })
    expect(requests.map(({ method }) => method)).toEqual(['GET'])
  })

  it('requires an explicit cut for ambiguous names and preserves CAD measurements in fallback errors', async () => {
    const target = await importedTarget({ name: 'Round or Oval' })
    expect(await owner.fail('sourcing.search', target)).toMatchObject({ status: 400 })
    expect(requests).toHaveLength(0)
    answer = () => ({ status: 503, body: { detail: 'private provider error' } })
    const failure = await owner.fail('sourcing.search', {
      ...target,
      searchCut: 'oval',
      color: 'Pink',
    })
    expect(failure).toMatchObject({
      status: 503,
      error: { cadTarget: { cut: 'oval', length: 4, width: 2, depth: 1.4 } },
    })
    const link = new URL(failure.error.searchUrl as string)
    expect(JSON.parse(link.searchParams.get('f')!)).toMatchObject({
      shapes: ['oval'],
      fancy_hues: ['Pink'],
      min_length_mm: 3.7,
      max_length_mm: 4.3,
      min_width_mm: 1.7,
      max_width_mm: 2.3,
    })
  })

  it('includes measured filters when the partner API is unconfigured', async () => {
    const target = await importedTarget()
    const { config } = server.runtime
    const apiUrl = config.diaexPartnerApiUrl
    config.diaexPartnerApiUrl = null
    try {
      const failure = await owner.fail('sourcing.search', target)
      expect(failure).toMatchObject({
        status: 501,
        error: {
          code: 'not_configured',
          cadTarget: { cut: 'emerald', length: 4, width: 2, depth: 1.4 },
        },
      })
      const link = new URL(failure.error.searchUrl as string)
      expect(link.origin + link.pathname).toBe(diaexBrowse)
      expect(JSON.parse(link.searchParams.get('f')!)).toMatchObject({
        shapes: ['emerald'],
        min_length_mm: 3.7,
        max_length_mm: 4.3,
      })
    } finally {
      config.diaexPartnerApiUrl = apiUrl
    }
    expect(requests).toEqual([])
  })

  it('uses current vertex edits and uniform scale without changing dimensions under a rigid placement', async () => {
    const target = await importedTarget({ tilt: 0 })
    const { assetId, vertices } = await owner.call('design.meshComponents', { ...target, limit: 9 })
    const tip = vertices.find(({ xyz }) => xyz[2] === -4)!
    await owner.call('design.apply', {
      pieceId: target.pieceId,
      label: 'Reshape and place the imported stone',
      ops: [
        {
          t: 'update',
          id: target.nodeId,
          patch: {
            meshEdits: { assetId, vertices: { [tip.id]: [16, 5, -4.6] } },
            transform: { position: [100, 10, 25], rotation: [120, 40, 72], scale: 1.5 },
          },
        },
      ],
    })
    answer = (req) => ({ body: signedOutSearch(req, []) })
    const result = await owner.call('sourcing.search', target)
    expect(result.cadTarget).toEqual({ cut: 'emerald', length: 6, width: 3, depth: 3 })
  })

  it('rejects hidden, unsupported deformations and cross-organization data before asking Diaex', async () => {
    const target = await importedTarget()
    expect(await outsider.fail('sourcing.search', target)).toMatchObject({ status: 404 })
    const foreignAssetTarget = await importedTarget({ assetOwner: outsider })
    expect(await owner.fail('sourcing.search', foreignAssetTarget)).toMatchObject({ status: 404 })
    for (const patch of [{ visible: false }, { visible: true, smooth: 1 }]) {
      await owner.call('design.apply', {
        pieceId: target.pieceId,
        label: 'Edit source',
        ops: [{ t: 'update', id: target.nodeId, patch }],
      })
      expect(await owner.fail('sourcing.search', target)).toMatchObject({ status: 400 })
    }
    expect(requests).toEqual([])
  })

  it('uses the supplier family before the display material and skips unsuitable stones', async () => {
    for (const stullerMaterial of [
      { stoneFamily: 'Tourmaline' },
      { metal: '18K Yellow Gold' },
      { stoneFamily: 'Diamond', stoneColor: 'Black' },
    ]) {
      const target = await importedTarget({ stullerMaterial })
      expect(await owner.fail('sourcing.search', target)).toMatchObject({ status: 400 })
    }
    expect(requests).toEqual([])

    const fancy = await importedTarget({
      stullerMaterial: { stoneFamily: 'Diamond', stoneColor: 'Pink' },
    })
    answer = (req) => ({ body: signedOutSearch(req, []) })
    await owner.call('sourcing.search', fancy)
    expect(requests[0]?.body.requirement).toMatchObject({ fancy_hues: ['Pink'] })
  })

  it('refuses a search cut override on a measured native gem', async () => {
    expect(await owner.fail('sourcing.search', { ...gem(), searchCut: 'oval' })).toMatchObject({
      status: 400,
    })
    expect(requests).toEqual([])
  })
})
