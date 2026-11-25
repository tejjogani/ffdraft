/**
 * The .pave file end to end, through the real HTTP routes: a template and a heavily edited piece
 * (history with undo and redo, directions, a cover, pinned references with an image plane, saved
 * shots) save and reopen identically; pictures whose rights do not travel stay behind with their
 * details; the design history still undoes after reopening; older files are migrated and newer
 * ones refused; malformed, tampered, oversized and zip-slip files are refused; a file saved
 * elsewhere keeps its provenance and loses the rights confirmation; and the plan's allowance
 * never counts a .pave save or open, even when the month's free exports are used up.
 */
import { createHash } from 'node:crypto'
import {
  type Design,
  originNeedsAttestation,
  PAVE_ENTRIES,
  type PaveManifest,
  type Piece,
} from '@pave/schema'
import { strToU8, unzipSync, zipSync } from 'fflate'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Services } from '../services'
import { assetBytes } from '../test/engines'
import { BOOT_TIMEOUT, type Client, client, type TestServer, testServer } from '../test/harness'
import { migrateFile } from './open'
import { savePieceFile } from './save'

/** A geometry engine that writes recognisable bytes, so the test sees what went in the file. */
const fakeGeometry = (calls: string[]): Partial<Services> => ({
  geometry: {
    evaluate: async () => {
      throw new Error('not used here')
    },
    export: async (_design, { format }) => {
      calls.push(format)
      const text = format === 'step' ? 'ISO-10303-21;\nHEADER;' : 'glTF-binary'
      return { file: { bytes: strToU8(text), name: `p.${format}`, mime: 'model/x' }, notes: [] }
    },
    renderInput: async () => {
      throw new Error('not used here')
    },
  },
})

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

async function upload(api: Client, bytes: Uint8Array, name: string, type: string) {
  const form = new FormData()
  form.set('file', new File([bytes as Uint8Array<ArrayBuffer>], name, { type }))
  const res = await api.request('/api/assets', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`upload → ${res.status} ${await res.text()}`)
  return (await res.json()) as { id: string; url: string }
}

const png = (colour: string) =>
  sharp({ create: { width: 48, height: 32, channels: 3, background: colour } })
    .png()
    .toBuffer()
    .then((b) => new Uint8Array(b))

async function save(api: Client, id: string) {
  const { asset, notes } = await api.call('pieces.saveFile', { id })
  return { bytes: await assetBytes(api, asset), asset, notes }
}

async function open(api: Client, bytes: Uint8Array, name = 'piece.pave') {
  const uploaded = await upload(api, bytes, name, 'application/octet-stream')
  return api.call('pieces.openFile', { assetId: uploaded.id })
}

async function openFails(api: Client, bytes: Uint8Array) {
  const uploaded = await upload(api, bytes, 'bad.pave', 'application/octet-stream')
  return api.fail('pieces.openFile', { assetId: uploaded.id })
}

/** Unpacks a file, lets `edit` change its entries, and packs it with a fresh manifest. */
function rewrite(
  bytes: Uint8Array,
  edit: (entries: Record<string, Uint8Array>, manifest: PaveManifest) => void,
): Uint8Array {
  const entries = unzipSync(bytes)
  const manifest = JSON.parse(
    new TextDecoder().decode(entries[PAVE_ENTRIES.manifest]),
  ) as PaveManifest
  edit(entries, manifest)
  manifest.files = Object.fromEntries(
    Object.entries(entries)
      .filter(
        ([n]) =>
          ![PAVE_ENTRIES.mimetype, PAVE_ENTRIES.manifest, PAVE_ENTRIES.checksum].includes(
            n as never,
          ),
      )
      .map(([n, b]) => [n, { bytes: b.length, sha256: sha256(b) }]),
  )
  const m = strToU8(JSON.stringify(manifest))
  return zipSync({
    [PAVE_ENTRIES.mimetype]: [entries[PAVE_ENTRIES.mimetype]!, { level: 0 }],
    ...entries,
    [PAVE_ENTRIES.manifest]: m,
    [PAVE_ENTRIES.checksum]: strToU8(`${sha256(m)}  manifest.json\n`),
  })
}

const readJson = (bytes: Uint8Array, name: string) =>
  JSON.parse(new TextDecoder().decode(unzipSync(bytes)[name]))

/** What must survive a round trip: everything but ids, owners and times of the new rows. */
const pieceShape = (p: Piece) => ({
  title: p.title,
  kind: p.kind,
  stage: p.stage,
  brief: p.brief,
  spec: p.spec,
  design: p.design,
  version: p.version,
  coverAuto: p.coverAuto,
  directions: p.directions.map((d) => ({ ...d, previewAssetIds: d.previewAssetIds.length })),
  chosenDirectionId: p.chosenDirectionId,
})

async function usedExports(api: Client) {
  const plan = await api.call('plan.get', {})
  return plan.allowances.find((a) => a.allowance === 'export')!.used
}

let server: TestServer
let api: Client
const geometryCalls: string[] = []

beforeAll(async () => {
  server = await testServer({ services: fakeGeometry(geometryCalls) })
  api = client(server)
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

describe('saving and opening a .pave file', () => {
  it('round-trips a template, with geometry, a manifest and a checksum', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire', title: 'Solitaire' })
    const file = await save(api, piece.id)
    expect(file.asset).toMatchObject({
      name: 'Solitaire.pave',
      mime: 'application/vnd.pave.piece+zip',
      kind: 'archive',
    })
    expect(file.notes).toEqual([])

    const entries = unzipSync(file.bytes)
    expect(Object.keys(entries)[0]).toBe('mimetype')
    expect(new TextDecoder().decode(entries.mimetype)).toBe('application/vnd.pave.piece+zip')
    const manifest = readJson(file.bytes, 'manifest.json') as PaveManifest
    expect(manifest).toMatchObject({
      format: 'pave',
      formatVersion: 1,
      app: { name: 'Pavé' },
      piece: { title: 'Solitaire', kind: 'ring' },
      contents: { changes: 0, geometry: ['glb'] },
    })
    // The exact STEP is a counted export: a free .pave never carries it (opening rebuilds the
    // geometry from the design), so it cannot be unzipped out of the file.
    expect(entries['geometry/exact.step']).toBeUndefined()
    expect(new TextDecoder().decode(entries['geometry/display.glb'])).toBe('glTF-binary')
    expect(new TextDecoder().decode(entries[PAVE_ENTRIES.checksum])).toBe(
      `${sha256(entries['manifest.json']!)}  manifest.json\n`,
    )

    const opened = await open(api, file.bytes, 'Solitaire.pave')
    expect(opened.piece.id).not.toBe(piece.id)
    expect(pieceShape(opened.piece)).toEqual(
      pieceShape(await api.call('pieces.get', { id: piece.id })),
    )
    expect(opened.piece.provenance).toMatchObject({
      fileName: 'Solitaire.pave',
      elsewhere: false,
      createdAt: piece.createdAt,
      files: [{ pieceId: piece.id, formatVersion: 1, app: 'Pavé' }],
    })
    // The geometry inside is never handed out as an export of its own.
    const assets = await api.call('pieces.get', { id: opened.piece.id })
    expect(assets.coverAssetId).toBeNull()
  })

  it('round-trips a heavily edited piece: history, directions, cover, references, planes, shots', async () => {
    const piece = await api.call('pieces.create', { templateId: 'halo', title: 'Edited halo' })
    const shank = Object.values(piece.design.nodes).find((n) => n.kind === 'ringShank')!
    let version = piece.version
    for (const widthTop of [2.1, 2.4, 2.6, 2.8]) {
      const r = await api.call('design.apply', {
        pieceId: piece.id,
        label: `Band ${widthTop} mm`,
        ops: [{ t: 'update', id: shank.id, patch: { widthTop } }],
      })
      version = r.version
    }
    const undo = await api.call('design.revert', { pieceId: piece.id, seq: version })
    await api.call('design.revert', { pieceId: piece.id, seq: undo.version }) // redo
    await api.call('pieces.update', { id: piece.id, brief: 'A halo for **Ana**, 2.8 mm band.' })
    await api.call('pieces.proposeDirections', {
      pieceId: piece.id,
      directions: [{ templateId: 'solitaire' }, { templateId: 'wedding-band' }],
    })

    const cover = await upload(api, await png('#c08040'), 'cover.png', 'image/png')
    await api.call('pieces.update', { id: piece.id, coverAssetId: cover.id })
    const sketch = await upload(api, await png('#336699'), 'sketch.png', 'image/png')
    const licensed = await upload(api, await png('#993333'), 'licensed.png', 'image/png')
    const [mine, link, theirs] = await api.call('references.pin', {
      pieceId: piece.id,
      items: [
        { assetId: sketch.id, title: 'My sketch', note: 'front view' },
        { url: 'https://example.com/inspiration', title: 'A page' },
        { assetId: licensed.id, rights: 'licensed', title: 'Licensed photo' },
      ],
    })
    expect([mine!.rights, link!.rights, theirs!.rights]).toEqual(['own', 'viewOnly', 'licensed'])
    const plane = {
      view: 'front' as const,
      center: [1.5, -2] as [number, number],
      width: 24,
      opacity: 0.6,
      locked: true,
    }
    await api.call('references.place', { id: mine!.id, plane })
    const hero = await api.call('scenes.create', {
      pieceId: piece.id,
      title: 'Hero',
      scene: { look: 'catalog-white' },
    })
    await api.call('scenes.create', {
      pieceId: piece.id,
      title: 'Top',
      scene: { look: 'catalog-white' },
    })
    await api.call('scenes.update', { id: hero.id, patch: { camera: { focalLength: 105 } } })

    const before = await api.call('pieces.get', { id: piece.id })
    const historyBefore = await api.call('design.history', { pieceId: piece.id, limit: 100 })
    const pinsBefore = await api.call('references.pins', { pieceId: piece.id })
    const shotsBefore = await api.call('scenes.list', { pieceId: piece.id })
    expect(historyBefore.length).toBe(6)

    const file = await save(api, piece.id)
    expect(file.notes).toEqual([
      expect.stringMatching(
        /^One pinned picture stays behind: its rights do not allow passing it on/,
      ),
    ])
    const references = readJson(file.bytes, 'references.json')
    expect(references.items.map((r: { withheld: boolean }) => r.withheld)).toEqual([
      false,
      false,
      true,
    ])

    const opened = await open(api, file.bytes)
    expect(opened.notes).toEqual([
      expect.stringMatching(/^One pinned reference arrives without its picture/),
    ])
    const after = await api.call('pieces.get', { id: opened.piece.id })
    expect(pieceShape(after)).toEqual(pieceShape(before))
    expect(after.directions.map((d) => d.letter)).toEqual(['A', 'B'])

    // The history: same changes, same order, same authors; undo records point at the new ids.
    const historyAfter = await api.call('design.history', { pieceId: after.id, limit: 100 })
    const strip = (h: typeof historyBefore) => {
      const seqOf = new Map(h.map((c) => [c.id, c.seq]))
      return h.map(({ id: _id, pieceId: _p, reverts, ...c }) => ({
        ...c,
        reverts: reverts?.map((r) => seqOf.get(r)),
      }))
    }
    expect(strip(historyAfter)).toEqual(strip(historyBefore))

    // The cover and the travelling picture are the same bytes under new ids.
    expect(after.coverAssetId).not.toBe(before.coverAssetId)
    const coverBytes = await assetBytes(api, { url: `/api/assets/${after.coverAssetId}` })
    expect(sha256(coverBytes)).toBe(sha256(await assetBytes(api, cover)))

    const pinsAfter = await api.call('references.pins', { pieceId: after.id })
    const pinShape = (r: (typeof pinsBefore.references)[number]) => {
      const { id: _i, boardId: _b, assetId, ...rest } = r
      return { ...rest, hasPicture: assetId !== null }
    }
    expect(pinsAfter.references.map(pinShape)).toEqual(
      pinsBefore.references.map((r) => ({
        ...pinShape(r),
        // The licensed picture stayed behind, so it has no picture (and no plane) here.
        hasPicture: r.rights !== 'licensed' && r.assetId !== null,
      })),
    )
    expect(pinsAfter.references[0]!.plane).toEqual(plane)
    const mineAfter = pinsAfter.references[0]!
    expect(sha256(await assetBytes(api, { url: `/api/assets/${mineAfter.assetId}` }))).toBe(
      sha256(await assetBytes(api, sketch)),
    )

    const shotsAfter = await api.call('scenes.list', { pieceId: after.id })
    const shotShape = (s: (typeof shotsBefore)[number]) => [s.title, s.position, s.scene]
    expect(shotsAfter.map(shotShape)).toEqual(shotsBefore.map(shotShape))

    // The reopened history is live: undoing the last change works and lands where it should.
    const last = historyAfter[0]!
    const undone = await api.call('design.revert', { pieceId: after.id, seq: last.seq })
    expect(undone.version).toBe(after.version + 1)
    const reverted = await api.call('pieces.get', { id: after.id })
    expect((reverted.design.nodes[shank.id] as { widthTop: number }).widthTop).toBe(2.6)
  })

  it('never counts against the plan, even with the month’s free exports used up', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    expect(await usedExports(api)).toBe(0)
    const { bytes } = await save(api, piece.id)
    await open(api, bytes)
    expect(await usedExports(api)).toBe(0)

    // Use up the five free Rhino/STEP exports; a .pave still saves and opens.
    for (let i = 0; i < 5; i++)
      await api.call('design.export', { pieceId: piece.id, format: 'step' })
    const refused = await api.fail('design.export', { pieceId: piece.id, format: '3dm' })
    expect(refused.status).toBe(402)
    const again = await save(api, piece.id)
    await open(api, again.bytes)
    expect(await usedExports(api)).toBe(5)
  })
})

describe('the evaluated geometry', () => {
  it('saves without it, and says so, when it takes longer than the budget', async () => {
    let aborted = 0
    const slow = await testServer({
      services: {
        geometry: {
          ...fakeGeometry([]).geometry!,
          // Never finishes on its own: only the save's deadline ends it.
          export: (_d, { signal }) =>
            new Promise((_resolve, reject) =>
              signal?.addEventListener('abort', () => {
                aborted++
                reject(signal.reason)
              }),
            ),
        },
      },
    })
    try {
      const slowApi = client(slow)
      const piece = await slowApi.call('pieces.create', { templateId: 'solitaire' })
      const ctx = await slow.runtime.context(slow.runtime.local!)
      const file = await savePieceFile(ctx, piece.id, { geometryBudgetMs: 300 })
      expect(aborted).toBe(1)
      expect(file.notes).toEqual([
        expect.stringMatching(/took longer than 0 s, so the file carries the design without it/),
      ])
      expect(Object.keys(unzipSync(file.bytes)).some((n) => n.startsWith('geometry/'))).toBe(false)
      // A file without geometry opens all the same.
      const opened = await open(slowApi, file.bytes)
      expect(opened.piece.design).toEqual(piece.design)
    } finally {
      await slow.dispose()
    }
  })
})

describe('versions', () => {
  it('opens a file whose design is an older document, migrated to today’s', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const { bytes } = await save(api, piece.id)
    const shankId = Object.values(piece.design.nodes).find((n) => n.kind === 'ringShank')!.id
    const old = rewrite(bytes, (entries) => {
      const record = JSON.parse(new TextDecoder().decode(entries['piece.json']))
      // Written before documents carried a version, and before the band had a `splitGap` field.
      delete record.design.schemaVersion
      delete record.design.nodes[shankId].splitGap
      entries['piece.json'] = strToU8(JSON.stringify(record))
    })
    const opened = await open(api, old)
    expect(opened.piece.design.schemaVersion).toBe(1)
    // The missing field comes back as its default; everything else is as it was.
    const expected = structuredClone(piece.design)
    ;(expected.nodes[shankId] as { splitGap: number }).splitGap = 2
    expect(opened.piece.design).toEqual(expected)
  })

  it('refuses a file from a newer Pavé, saying to update', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const { bytes } = await save(api, piece.id)
    const newer = rewrite(bytes, (_entries, manifest) => {
      manifest.formatVersion = 2
    })
    const res = await openFails(api, newer)
    expect(res.status).toBe(400)
    expect(res.error.reason).toBe('newer_pave_file')
    expect(res.error.message).toMatch(/newer version of Pavé .* Update Pavé to open it/)

    const newerDesign = rewrite(bytes, (entries) => {
      const record = JSON.parse(new TextDecoder().decode(entries['piece.json']))
      record.design.schemaVersion = 7
      entries['piece.json'] = strToU8(JSON.stringify(record))
    })
    expect((await openFails(api, newerDesign)).error.message).toMatch(
      /newer version of Pavé \(design version 7/,
    )
  })

  it('migrates file entries one version at a time, and refuses a version it has no step for', () => {
    const steps = {
      1: (p: Record<string, unknown>) => ({ ...p, trail: ['1→2'] }),
      2: (p: Record<string, unknown>) => ({ ...p, trail: [...(p.trail as string[]), '2→3'] }),
    }
    expect(migrateFile({ a: 1 }, 1, 3, steps)).toEqual({ a: 1, trail: ['1→2', '2→3'] })
    expect(migrateFile({ a: 1 }, 3, 3, steps)).toEqual({ a: 1 })
    expect(() => migrateFile({}, 0, 3, steps)).toThrow(/format version 0/)
  })
})

describe('refusing files that are not safe or not whole', () => {
  let good: Uint8Array
  beforeAll(async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    good = (await save(api, piece.id)).bytes
  })

  const cases: [string, () => Uint8Array, RegExp][] = [
    ['not a zip', () => strToU8('ISO-10303-21; definitely not a zip'), /not a zip archive/],
    ['a plain zip', () => zipSync({ 'notes.txt': strToU8('hi') }), /never has/],
    [
      'zip-slip: a parent-folder path',
      () =>
        zipSync({
          mimetype: strToU8('application/vnd.pave.piece+zip'),
          '../../evil.json': strToU8('{}'),
        }),
      /“\.\.\/\.\.\/evil\.json”, which a \.pave file never has/,
    ],
    [
      'zip-slip: an absolute path',
      () => zipSync({ ...unzipSync(good), '/etc/cron.d/x': strToU8('x') }),
      /never has/,
    ],
    [
      'zip-slip: a backslash path',
      () => zipSync({ ...unzipSync(good), 'assets\\..\\..\\x.png': strToU8('x') }),
      /never has/,
    ],
    [
      'a tampered entry',
      () => {
        const e = unzipSync(good)
        e['piece.json'] = strToU8(
          new TextDecoder().decode(e['piece.json']).replace('Classic', 'Fake'),
        )
        return zipSync(e)
      },
      /“piece\.json” is damaged/,
    ],
    [
      'a tampered manifest',
      () => {
        const e = unzipSync(good)
        e['manifest.json'] = strToU8(
          new TextDecoder().decode(e['manifest.json']).replace('"Pavé"', '"Pave"'),
        )
        return zipSync(e)
      },
      /does not match its checksum/,
    ],
    [
      'an entry the manifest does not list',
      () => zipSync({ ...unzipSync(good), 'thumbnails/extra.png': strToU8('x') }),
      /does not list/,
    ],
    [
      'a missing entry',
      () => {
        const e = unzipSync(good)
        delete e['history.json']
        return zipSync(e)
      },
      /“history\.json” is missing/,
    ],
    [
      'a record that is not valid',
      () =>
        rewrite(good, (e) => {
          e['piece.json'] = strToU8(JSON.stringify({ title: 3 }))
        }),
      /The piece is not valid/,
    ],
    [
      'a design that is not valid',
      () =>
        rewrite(good, (e) => {
          const record = JSON.parse(new TextDecoder().decode(e['piece.json']))
          record.design.order.push('ghost')
          e['piece.json'] = strToU8(JSON.stringify(record))
        }),
      /missing node "ghost"/,
    ],
    [
      'a reference to a picture it does not carry',
      () =>
        rewrite(good, (e) => {
          const record = JSON.parse(new TextDecoder().decode(e['piece.json']))
          record.coverAssetId = 'as_nowhere'
          e['piece.json'] = strToU8(JSON.stringify(record))
        }),
      /The cover points at a picture it does not carry/,
    ],
    [
      'a history that goes past its version',
      () =>
        rewrite(good, (e) => {
          const change = {
            id: 'chg_x',
            seq: 9,
            ops: [],
            inverse: [],
            actor: { type: 'system' },
            label: 'x',
            at: '2026-01-01T00:00:00.000Z',
            reverts: [],
          }
          e['history.json'] = strToU8(JSON.stringify([change]))
        }),
      /history goes past/,
    ],
    [
      'an oversized entry (a zip bomb)',
      () =>
        zipSync({ ...unzipSync(good), 'geometry/exact.step': new Uint8Array(129 * 1024 * 1024) }),
      /“geometry\/exact\.step” is too large/,
    ],
  ]

  for (const [name, make, message] of cases)
    it(`refuses ${name}`, async () => {
      const piecesBefore = (await api.call('pieces.list', {})).length
      const res = await openFails(api, make())
      expect(res.status).toBe(400)
      expect(res.error.message).toMatch(message)
      expect(res.error.message).toMatch(/^This \.pave file cannot be opened: /)
      // Nothing was written.
      expect((await api.call('pieces.list', {})).length).toBe(piecesBefore)
    })
})

describe('a file saved elsewhere', () => {
  let other: TestServer
  let otherApi: Client
  beforeAll(async () => {
    // Another install: its own auth secret, so its own organisation fingerprint.
    other = await testServer({
      services: fakeGeometry([]),
      config: { authSecret: 'another-install-secret-another-install-01' },
    })
    otherApi = client(other)
  }, BOOT_TIMEOUT)
  afterAll(() => other.dispose())

  it('keeps its provenance and history authors, and asks for the rights confirmation again', async () => {
    const art = await upload(api, await png('#222222'), 'logo.png', 'image/png')
    const piece = await api.call('pieces.create', {
      templateId: 'solitaire',
      title: 'From a logo',
      origin: { kind: 'logo', sourceAssetIds: [art.id] },
    })
    await api.call('pieces.attest', { id: piece.id, rights: 'own', likenessConsent: false })
    const shank = Object.values(piece.design.nodes).find((n) => n.kind === 'ringShank')!
    await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Wider',
      ops: [{ t: 'update', id: shank.id, patch: { widthTop: 3 } }],
    })
    const { bytes } = await save(api, piece.id)

    // Here, the confirmation still stands.
    const home = await open(api, bytes)
    expect(home.piece.provenance?.elsewhere).toBe(false)
    expect(home.piece.origin?.attestation).not.toBeNull()

    const away = await open(otherApi, bytes, 'From a logo.pave')
    expect(away.piece.provenance).toMatchObject({ elsewhere: true, createdAt: piece.createdAt })
    expect(away.piece.origin?.attestation).toBeNull()
    expect(originNeedsAttestation(away.piece.origin)).toBe(true)
    expect(away.notes.join(' ')).toMatch(/must confirm it again/)
    const history = await otherApi.call('design.history', { pieceId: away.piece.id })
    const me = (await api.call('session.get', {})).user.id
    expect(history[0]!.actor).toEqual({ type: 'user', id: me })

    // Without a confirmation there, its save carries the design but not the geometry.
    const again = await save(otherApi, away.piece.id)
    expect(again.notes.join(' ')).toMatch(/without its geometry/)
    expect(Object.keys(unzipSync(again.bytes)).some((n) => n.startsWith('geometry/'))).toBe(false)

    // Back home, the trail has both saves, oldest first.
    const back = await open(api, again.bytes)
    expect(back.piece.provenance?.files.map((f) => f.pieceId)).toEqual([piece.id, away.piece.id])
    expect(back.piece.provenance?.elsewhere).toBe(true)
    expect(back.piece.design as Design).toEqual(
      (await api.call('pieces.get', { id: piece.id })).design,
    )
  })
})
