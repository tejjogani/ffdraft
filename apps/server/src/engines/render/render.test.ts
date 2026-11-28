/**
 * Blender takes through the server, for real: a preview of the solitaire, the numeric critique,
 * metering, the render cache, cancellation and restart recovery. Skipped where bpy is not set up
 * (`pnpm --filter @pave/render setup:blender`).
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { detectBlender } from '@pave/render/node'
import type { RenderJob } from '@pave/schema'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assetBytes, engineServer, until } from '../../test/engines'
import { BOOT_TIMEOUT, type Client, client, type TestServer } from '../../test/harness'

const blender = await detectBlender()

/** Where a passing run leaves its preview, to be looked at. Unset: nowhere. */
const SHOTS = process.env.PAVE_SHOTS_DIR

const small = (quality: 'preview' | 'standard', size: number) => ({
  look: 'catalog-white' as const,
  output: { quality, width: size, height: size },
})

const settled = (job: RenderJob) => !['queued', 'running'].includes(job.status)

/** Blender processes rendering `jobId` (Linux; elsewhere an empty list, and the check is skipped). */
async function blenderProcesses(jobId: string): Promise<string[]> {
  if (!existsSync('/proc/self/cmdline')) return []
  const found: string[] = []
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue
    const cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')
    if (cmdline.includes('pave_render.py') && cmdline.includes(`${sep}${jobId}${sep}`))
      found.push(pid)
  }
  return found
}

const waitForBlender = (jobId: string) =>
  until(
    () => blenderProcesses(jobId),
    (pids) => pids.length > 0 || process.platform !== 'linux',
    { timeoutMs: 120_000, everyMs: 100 },
  )

describe.skipIf(!blender.available)('Blender render queue', () => {
  let server: TestServer
  let api: Client
  beforeAll(async () => {
    server = await engineServer()
    api = client(server)
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('reports Blender and renders a preview of the solitaire to a PNG, measured and metered', async () => {
    const engine = await api.call('renders.engine', {})
    expect(engine).toMatchObject({ available: true, reason: null })
    expect(engine.version).toMatch(/^\d+\.\d+/)
    expect((await api.call('session.get', {})).capabilities.blender).toBe(true)

    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const queued = await api.call('renders.create', {
      pieceId: piece.id,
      scene: small('preview', 256),
    })
    expect(queued.engine).toBe('blender')
    const job = await until(() => api.call('renders.get', { id: queued.id }), settled)
    expect(job).toMatchObject({ status: 'done', progress: 1, error: null })
    expect(job.assetIds).toHaveLength(1)
    expect(job.seconds).toBeGreaterThan(0)
    expect(job.device).toBeTruthy()

    const png = await assetBytes(api, { url: `/api/assets/${job.assetIds[0]}` })
    if (SHOTS) {
      await mkdir(SHOTS, { recursive: true })
      await writeFile(join(SHOTS, 'test-solitaire-preview.png'), png)
    }
    const meta = await sharp(png).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 256, 256])
    // A ring on a white studio background: bright corners, and a subject darker than them.
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => data[y * info.width + x]!
    expect(Math.min(at(2, 2), at(253, 2), at(2, 253), at(253, 253))).toBeGreaterThan(200)
    const subject = data.filter((v) => v < 220).length / data.length
    expect(subject).toBeGreaterThan(0.02)
    expect(subject).toBeLessThan(0.6)

    // The numeric critique is stored on the job; the take itself has no draft asset.
    expect(job.critique!.passes.length).toBeGreaterThanOrEqual(1)
    expect(job.critique!.passes.at(-1)).toMatchObject({ adjustments: [], draftAssetId: null })
    expect(job.critique!.passes.flatMap((p) => p.issues).every((i) => i.code)).toBe(true)

    const usage = await api.call('usage.summary', {})
    const render = usage.byMeter.find((m) => m.meter === 'render')
    expect(render).toMatchObject({ unit: 'second', costUsd: 0 })
    expect(render!.quantity).toBeGreaterThan(0)

    // The same request for the same version is answered from the cache, without Blender.
    const again = await api.call('renders.create', {
      pieceId: piece.id,
      scene: {
        ...small('preview', 256),
        output: { ...small('preview', 256).output, device: 'auto' },
      },
    })
    const cached = await until(() => api.call('renders.get', { id: again.id }), settled)
    expect(cached).toMatchObject({ status: 'done', assetIds: job.assetIds, seconds: 0 })
    expect(cached.scene.output.device).toBe('auto')
    expect(cached.requestedScene.output.device).toBe('auto')
    expect(job.scene.output.device).toBeUndefined()
  })

  it('renders the queued CPU preference after the saved shot switches back to Auto', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const settings = small('preview', 256)
    const shot = await api.call('scenes.create', {
      pieceId: piece.id,
      title: 'CPU recovery',
      scene: { ...settings, output: { ...settings.output, device: 'cpu' } },
    })
    const queued = await api.call('renders.create', { pieceId: piece.id, sceneId: shot.id })
    expect(queued.requestedScene.output.device).toBe('cpu')
    const updated = await api.call('scenes.update', {
      id: shot.id,
      patch: { output: { device: 'auto' } },
    })
    expect(updated.scene.output.device).toBe('auto')
    const job = await until(() => api.call('renders.get', { id: queued.id }), settled)
    expect(job).toMatchObject({
      status: 'done',
      device: 'CPU',
      scene: { output: { device: 'cpu' } },
      requestedScene: { output: { device: 'cpu' } },
    })
    expect(job.assetIds).toHaveLength(1)
    expect(job.seconds).toBeGreaterThan(0)
    expect((await api.call('pieces.get', { id: piece.id })).version).toBe(piece.version)
  })

  it('kills Blender when a render is canceled', async () => {
    const piece = await api.call('pieces.create', { templateId: 'halo' })
    const job = await api.call('renders.create', {
      pieceId: piece.id,
      scene: small('standard', 768),
      autoTune: false,
    })
    await waitForBlender(job.id)
    const canceled = await api.call('renders.cancel', { id: job.id })
    expect(canceled.status).toBe('canceled')
    expect(await blenderProcesses(job.id)).toEqual([])
    // Nothing the aborted process might still have sent reopens the job.
    await new Promise((r) => setTimeout(r, 500))
    expect(await api.call('renders.get', { id: job.id })).toMatchObject({
      status: 'canceled',
      assetIds: [],
    })
  })

  it.skipIf(process.platform !== 'linux')(
    'kills a Blender that ignores the cancel, and moves on to the next job',
    async () => {
      const piece = await api.call('pieces.create', { templateId: 'solitaire' })
      const hung = await api.call('renders.create', {
        pieceId: piece.id,
        scene: small('standard', 768),
        autoTune: false,
      })
      const next = await api.call('renders.create', {
        pieceId: piece.id,
        scene: small('preview', 256),
        autoTune: false,
      })
      const [pid] = await waitForBlender(hung.id)
      // A stopped process cannot act on SIGTERM: the queue must not wait on it for ever.
      process.kill(Number(pid), 'SIGSTOP')
      const started = performance.now()
      expect((await api.call('renders.cancel', { id: hung.id })).status).toBe('canceled')
      expect(performance.now() - started).toBeLessThan(10_000)
      expect(await blenderProcesses(hung.id)).toEqual([])
      const done = await until(() => api.call('renders.get', { id: next.id }), settled)
      expect(done.status).toBe('done')
    },
    180_000,
  )
})

describe.skipIf(!blender.available)('Blender render queue across a restart', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pave-render-restart-'))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  const boot = () =>
    engineServer({ config: { dataDir: join(dir, 'data'), blobDir: join(dir, 'blobs') } })

  it('resumes a take cut off by a restart, and fails one whose piece changed meanwhile', async () => {
    const first = await boot()
    const api1 = client(first)
    const ring = await api1.call('pieces.create', { templateId: 'solitaire' })
    const band = await api1.call('pieces.create', { templateId: 'wedding-band' })
    const cutOff = await api1.call('renders.create', {
      pieceId: ring.id,
      scene: small('preview', 256),
      autoTune: false,
    })
    const outdated = await api1.call('renders.create', {
      pieceId: band.id,
      scene: small('preview', 256),
      autoTune: false,
    })
    await waitForBlender(cutOff.id)
    const shank = Object.values((await api1.call('pieces.get', { id: band.id })).design.nodes)[0]!
    await api1.call('design.apply', {
      pieceId: band.id,
      label: 'Rename',
      ops: [{ t: 'update', id: shank.id, patch: { name: 'Renamed band' } }],
    })
    await first.dispose()
    expect(await blenderProcesses(cutOff.id)).toEqual([])

    const second = await boot()
    try {
      const api2 = client(second)
      const resumed = await until(() => api2.call('renders.get', { id: cutOff.id }), settled)
      expect(resumed).toMatchObject({ status: 'done', error: null })
      expect(resumed.assetIds).toHaveLength(1)
      const failed = await until(() => api2.call('renders.get', { id: outdated.id }), settled)
      expect(failed).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('piece changed'),
      })
    } finally {
      await second.dispose()
    }
  }, 300_000)
})
