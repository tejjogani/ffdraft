/**
 * The render queue without Blender: crash leftovers swept at boot, resumed jobs shown as queued,
 * empty pieces refused, and what a failed take tells a tenant. Blender itself is in render.test.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson } from '@pave/render'
import { RenderSceneSchema } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { GeometryService, RenderJobPatch, RenderSubject, ServiceContext } from '../../services'
import { until } from '../../test/engines'
import type { BlenderSetup } from './blender'
import { cacheKeyOf, createRenderQueue } from './queue'

const PART = {
  id: 'p',
  nodeId: 'shank',
  material: 'pt950',
  finish: 'polished',
  plating: 'none',
  bounds: { min: [-10, -10, 0], max: [10, 10, 20] },
} as RenderSubject['parts'][number]

const geometry = (parts: RenderSubject['parts']) =>
  ({
    renderInput: async () => ({
      glb: { bytes: new Uint8Array(8), name: 'piece.glb', mime: 'model/gltf-binary' },
      subject: { bounds: PART.bounds, parts, stones: [] },
    }),
  }) as unknown as GeometryService

/** A Blender that is "available" and is in fact Node, which refuses Blender's arguments. */
const probedStatus = () => ({
  available: true,
  version: '0',
  device: null,
  path: null,
  reason: null,
})
const notBlender = {
  ready: Promise.resolve(),
  probed: Promise.resolve(),
  available: true,
  status: probedStatus,
  prepareRender: async () => ({ engine: probedStatus() }),
  runtime: () => ({ blenderPath: process.execPath }),
  noteDevice: () => {},
} as unknown as BlenderSetup

const sctx = {
  orgId: 'org_a',
  cachedRender: async () => null,
  recordUsage: async () => {},
  putAsset: async () => ({ id: 'ast' }),
} as unknown as ServiceContext

const job = (id: string) =>
  ({
    id,
    pieceId: 'pce',
    sourceVersion: 1,
    retryOf: null,
    title: 'Test',
    autoTune: false,
    requestedScene: RenderSceneSchema.parse({
      output: { quality: 'preview', width: 256, height: 256 },
    }),
  }) as Parameters<ReturnType<typeof createRenderQueue>['submit']>[0]

it('renders new studio lighting instead of reusing an image cached by the earlier worker', () => {
  const take = job('take')
  const old = canonicalJson([
    take.pieceId,
    take.sourceVersion,
    take.requestedScene,
    'blender',
    take.autoTune,
    2,
    'jewelry-lighting-v2',
    '5.3.0',
  ])
  const priorKey = 'sha256:' + createHash('sha256').update(old).digest('hex')
  expect(cacheKeyOf(take, '5.3.0')).not.toBe(priorKey)
})

it('does not reuse an ordinary take for a neutral imported CAD preview', () => {
  const take = job('take')
  const key = cacheKeyOf(take, '5.3.0')
  expect(
    cacheKeyOf(
      { ...take, requestedScene: { ...take.requestedScene, includeUnassignedRhino: false } },
      '5.3.0',
    ),
  ).toBe(key)
  const withPreview = {
    ...take,
    requestedScene: RenderSceneSchema.parse({
      ...take.requestedScene,
      includeUnassignedRhino: true,
    }),
  }
  expect(cacheKeyOf(withPreview, '5.3.0')).not.toBe(key)
  expect(cacheKeyOf({ ...withPreview, sourceVersion: take.sourceVersion + 1 }, '5.3.0')).not.toBe(
    cacheKeyOf(withPreview, '5.3.0'),
  )
})

it('shares the automatic device cache and gives forced CPU renders their own key', () => {
  const take = job('take')
  const key = cacheKeyOf(take, '5.3.0')
  const withDevice = (device: 'auto' | 'cpu') => ({
    ...take,
    requestedScene: RenderSceneSchema.parse({
      ...take.requestedScene,
      output: { ...take.requestedScene.output, device },
    }),
  })
  expect(cacheKeyOf(withDevice('auto'), '5.3.0')).toBe(key)
  expect(cacheKeyOf(withDevice('cpu'), '5.3.0')).not.toBe(key)
})

const piece = { id: 'pce', version: 1, design: {} } as Parameters<
  ReturnType<typeof createRenderQueue>['submit']
>[1]

/** Runs one job to a terminal state; returns every update it made. */
async function settle(
  queue: ReturnType<typeof createRenderQueue>,
  id: string,
  how: 'submit' | 'resume' = 'submit',
): Promise<RenderJobPatch[]> {
  const updates: RenderJobPatch[] = []
  const handle = { id, update: async (patch: RenderJobPatch) => void updates.push(patch) }
  await queue[how](job(id), piece, handle, sctx)
  await until(
    async () => updates,
    (u) => u.some((p) => p.status === 'failed' || p.status === 'done'),
    { timeoutMs: 30_000, everyMs: 20 },
  )
  return updates
}

describe('render queue', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pave-queue-test-'))
  })
  afterAll(() => rm(root, { recursive: true, force: true }))

  it.skipIf(process.platform === 'win32')(
    'kills and deletes what a crashed run left in its work folder, at boot',
    async () => {
      const workRoot = join(root, 'work')
      const jobJson = join(workRoot, 'rnd_left', 'pass-0', 'job.json')
      await mkdir(join(workRoot, 'rnd_left', 'pass-0'), { recursive: true })
      // Stands in for an orphaned Blender: same script name and job path on its command line.
      const orphan = spawn(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)', 'pave_render.py', jobJson],
        {
          stdio: 'ignore',
        },
      )
      const exited = new Promise((resolve) =>
        orphan.once('exit', (_code, signal) => resolve(signal)),
      )
      const queue = createRenderQueue({
        blender: notBlender,
        geometry: () => geometry([PART]),
        workRoot,
      })
      await queue.ready()
      expect(await exited).toBe('SIGKILL')
      expect(existsSync(join(workRoot, 'rnd_left'))).toBe(false)
      await queue.dispose()
    },
  )

  it('puts a resumed job back to queued until it really starts', async () => {
    const queue = createRenderQueue({ blender: notBlender, geometry: () => geometry([PART]) })
    const updates = await settle(queue, 'rnd_resumed', 'resume')
    expect(updates[0]).toEqual({ status: 'queued', progress: 0 })
    expect(updates[1]).toMatchObject({ status: 'running' })
    await queue.dispose()
  })

  it('refuses a piece with nothing to render before starting Blender', async () => {
    const queue = createRenderQueue({ blender: notBlender, geometry: () => geometry([]) })
    const updates = await settle(queue, 'rnd_empty')
    expect(updates.at(-1)).toEqual({
      status: 'failed',
      error: 'Nothing to render: the piece has no metal or stones.',
    })
    await queue.dispose()
  })

  it('shows Blender’s own output only on a local server', async () => {
    const shared = createRenderQueue({ blender: notBlender, geometry: () => geometry([PART]) })
    expect((await settle(shared, 'rnd_shared')).at(-1)).toEqual({
      status: 'failed',
      error: 'The render failed; try again.',
    })
    await shared.dispose()
    const local = createRenderQueue({
      blender: notBlender,
      geometry: () => geometry([PART]),
      engineOutput: true,
    })
    expect((await settle(local, 'rnd_local')).at(-1)?.error).toMatch(
      /^Blender render failed \(exit/,
    )
    await local.dispose()
  })
})
