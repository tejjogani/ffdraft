/** Real production packages: the zip, its manifest, its PDF, progress and restart recovery. */
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerEvent } from '@pave/schema'
import { unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assetBytes, engineServer, until } from '../test/engines'
import { BOOT_TIMEOUT, type Client, client, type TestServer } from '../test/harness'

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

interface ManifestFile {
  path: string
  sha256: string
  bytes: number
}

describe('production engine', () => {
  let server: TestServer
  let api: Client
  beforeAll(async () => {
    server = await engineServer()
    api = client(server)
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('builds a package whose manifest matches its files and whose PDF opens', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const ctx = await server.runtime.context(server.runtime.local!)
    const events: ServerEvent[] = []
    const off = server.runtime.events.subscribe(ctx.orgId, (e) => events.push(e))
    const queued = await api.call('production.create', {
      pieceId: piece.id,
      quantity: 3,
      notes: 'Polish the gallery.',
      rates: { metalPricePerGramUsd: 40 },
    })
    expect([queued.status, queued.revision]).toEqual(['queued', 1])
    const pkg = await until(
      async () => (await api.call('production.list', { pieceId: piece.id }))[0]!,
      (p) => p.status !== 'queued' && p.status !== 'running',
    )
    off()
    expect(pkg.status).toBe('done')
    const progress = events.flatMap((e) =>
      e.type === 'job.updated' && e.id === pkg.id ? [e.progress] : [],
    )
    expect(progress.some((p) => p > 0 && p < 1)).toBe(true)
    expect(progress.at(-1)).toBe(1)

    const zip = unzipSync(await assetBytes(api, { url: `/api/assets/${pkg.assetId}` }))
    const paths = Object.keys(zip)
    const root = paths[0]!.split('/')[0]!
    const inZip = (path: string) => zip[`${root}/${path}`]!
    const manifest = JSON.parse(new TextDecoder().decode(inZip('manifest.json'))) as {
      quantity: number
      revision: number
      sourceDesignVersion: number
      files: ManifestFile[]
      stones: { count: number }
    }
    expect(pkg.manifest).toEqual(manifest)
    expect(manifest).toMatchObject({ quantity: 3, revision: 1, sourceDesignVersion: piece.version })
    expect(manifest.stones.count).toBe(1)
    expect(manifest.files.length).toBeGreaterThan(5)
    for (const file of manifest.files) {
      const bytes = inZip(file.path)
      expect(bytes, file.path).toBeDefined()
      expect([file.path, bytes.byteLength, sha256(bytes)]).toEqual([
        file.path,
        file.bytes,
        file.sha256,
      ])
    }
    expect(manifest.files.map((f) => f.path)).toEqual(
      expect.arrayContaining([expect.stringMatching(/\.stl$/), expect.stringMatching(/\.step$/)]),
    )
    const pdfs = manifest.files.filter((f) => f.path.endsWith('.pdf'))
    expect(pdfs.length).toBeGreaterThan(0)
    for (const pdf of pdfs)
      expect((await PDFDocument.load(inZip(pdf.path))).getPageCount()).toBeGreaterThan(0)

    // A second package is the next revision.
    const next = await api.call('production.create', { pieceId: piece.id })
    expect(next.revision).toBe(2)
    await until(
      async () => (await api.call('production.list', { pieceId: piece.id }))[0]!,
      (p) => p.status === 'done',
    )
  })
})

describe('production engine across a restart', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pave-restart-'))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  const boot = () =>
    engineServer({ config: { dataDir: join(dir, 'data'), blobDir: join(dir, 'blobs') } })

  it('resumes a build the server was stopped in the middle of', async () => {
    const first = await boot()
    const api1 = client(first)
    const piece = await api1.call('pieces.create', { templateId: 'wedding-band' })
    const pkg = await api1.call('production.create', { pieceId: piece.id, quantity: 2 })
    const [live] = await api1.call('production.list', { pieceId: piece.id })
    expect(['queued', 'running']).toContain(live!.status)
    await first.dispose()

    const second = await boot()
    try {
      const api2 = client(second)
      const [cutOff] = await api2.call('production.list', { pieceId: piece.id })
      expect(cutOff!.id).toBe(pkg.id)
      const done = await until(
        async () => (await api2.call('production.list', { pieceId: piece.id }))[0]!,
        (p) => p.status === 'done' || p.status === 'failed',
      )
      expect(done).toMatchObject({ status: 'done', revision: 1 })
      expect(done.manifest).toMatchObject({ quantity: 2 })
    } finally {
      await second.dispose()
    }
  }, 180_000)
})
