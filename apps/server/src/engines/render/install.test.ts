import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isToolCommand, RenderInstallStatusSchema, RenderJobSchema } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { assistantServer, text, tool } from '../../assistant/testing'
import { engineServer, until } from '../../test/engines'
import {
  BOOT_TIMEOUT,
  client,
  joinOrg,
  signUp,
  type TestServer,
  testServer,
} from '../../test/harness'
import { BlenderSetup } from './blender'
import { createRenderQueue } from './queue'
import * as takeEngine from './take'

const packageInstall = vi.hoisted(() => ({ run: vi.fn(), candidates: [] as string[] }))
vi.mock('./managed-package', () => ({
  MANAGED_BLENDER_VERSION: '5.3.0',
  managedBlenderPackage: () => ({ version: '5.3.0', bytes: 100 }),
  managedBlenderPath: (dir: string) => join(dir, 'blender'),
  installManagedBlender: packageInstall.run,
}))
vi.mock('./installed-blender', () => ({
  installedBlenderCandidates: () => Promise.resolve([...packageInstall.candidates]),
}))

const origin = 'http://localhost:8787'
const names = ['renders.installStatus', 'renders.installEngine', 'renders.cancelInstall'] as const

function post(
  server: TestServer,
  name:
    | (typeof names)[number]
    | 'renders.create'
    | 'renders.estimate'
    | 'threads.send'
    | 'runs.decide',
  opts: { base?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return server.app.request(`${opts.base ?? origin}/api/rpc/${name}`, {
    method: 'POST',
    headers: {
      origin: opts.base ?? origin,
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      ...opts.headers,
    },
    body: opts.body ?? '{}',
  })
}

async function fakeBlender(path: string, version: string): Promise<void> {
  await writeFile(path, `#!/bin/sh\nprintf 'PAVE_BLENDER_VERSION %s\\n' '${version}'\n`, {
    mode: 0o755,
  })
}

describe.skipIf(process.platform === 'win32')('managed Blender setup', () => {
  let server: TestServer
  let dir: string
  let executable: string
  let installAttempts = 0

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pave-engine-install-'))
    executable = join(dir, 'blender')
    const incompatible = join(dir, 'older-blender')
    await fakeBlender(incompatible, '4.5.0')
    packageInstall.candidates.push(incompatible)
    server = await engineServer({
      config: { dataDir: dir },
      engines: { engineFile: join(dir, 'engine.json'), blenderEnv: {} },
    })
  }, BOOT_TIMEOUT)
  afterAll(async () => {
    await server?.dispose()
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('only accepts an empty JSON object from a same-origin local request', async () => {
    expect((await post(server, 'renders.installEngine', { headers: { origin: '' } })).status).toBe(
      403,
    )
    expect(
      (
        await post(server, 'renders.installEngine', {
          headers: { origin: 'http://localhost:5173' },
        })
      ).status,
    ).toBe(403)
    expect(
      (await post(server, 'renders.installEngine', { headers: { host: 'example.test' } })).status,
    ).toBe(403)
    expect(
      (await post(server, 'renders.installEngine', { headers: { 'sec-fetch-site': 'cross-site' } }))
        .status,
    ).toBe(403)
    expect(
      (await post(server, 'renders.installEngine', { headers: { 'content-type': 'text/plain' } }))
        .status,
    ).toBe(400)
    for (const body of [
      '',
      'null',
      '[]',
      '{"url":"https://example.com/blender","command":"/bin/sh"}',
    ]) {
      expect((await post(server, 'renders.installEngine', { body })).status).toBe(400)
    }
    expect(installAttempts).toBe(0)
  })

  it('keeps local install controls outside the tool registry and in-process callers', async () => {
    const local = server.runtime.local!
    const ctx = await server.runtime.context(local)
    for (const name of names) {
      expect(isToolCommand(name)).toBe(false)
      await expect(server.runtime.execute(name, {}, ctx)).rejects.toMatchObject({ status: 403 })
      await expect(
        server.runtime.execute(name, {}, { ...ctx, actor: { type: 'system' } }),
      ).rejects.toMatchObject({ status: 403 })
    }
  })

  it('recovers from cancellation and failed probes, then enables Blender in this session', async () => {
    expect(await (await post(server, 'renders.installStatus')).json()).toMatchObject({
      supported: true,
      phase: 'idle',
      version: '5.3.0',
      downloadedBytes: 0,
      totalBytes: 100,
    })
    const api = client(server)
    expect((await api.call('session.get', {})).capabilities.blender).toBe(false)

    let finishCancel: (() => void) | undefined
    packageInstall.run.mockImplementationOnce(
      (_dir: string, progress: (status: object) => void, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          ++installAttempts
          progress({ phase: 'downloading', downloadedBytes: 7, totalBytes: 100 })
          signal.addEventListener(
            'abort',
            () => {
              finishCancel = () => reject(new Error('Download cancelled.'))
            },
            { once: true },
          )
        }),
    )

    const results = await Promise.all([
      post(server, 'renders.installEngine'),
      post(server, 'renders.installEngine'),
    ])
    for (const res of results) {
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ phase: 'downloading' })
    }
    expect(installAttempts).toBe(1)
    const status = async () =>
      RenderInstallStatusSchema.parse(await (await post(server, 'renders.installStatus')).json())
    expect(await status()).toMatchObject({ downloadedBytes: 7, totalBytes: 100 })
    const cancelling = post(server, 'renders.cancelInstall')
    await until(async () => finishCancel, Boolean, { everyMs: 10, timeoutMs: 1500 })
    await post(server, 'renders.installEngine')
    expect(installAttempts).toBe(1)
    finishCancel?.()
    expect(await (await cancelling).json()).toMatchObject({ phase: 'cancelled' })

    packageInstall.run.mockImplementationOnce(async () => {
      await fakeBlender(executable, '4.5.0')
      return executable
    })
    await post(server, 'renders.installEngine')
    expect(
      await until(status, (s) => s.phase === 'failed', { everyMs: 10, timeoutMs: 2500 }),
    ).toMatchObject({ phase: 'failed', reason: expect.any(String) })
    expect((await api.call('renders.engine', {})).available).toBe(false)

    packageInstall.run.mockImplementationOnce(async () => {
      await fakeBlender(executable, '5.3.0')
      return executable
    })
    await post(server, 'renders.installEngine')
    expect(
      await until(status, (s) => s.phase === 'ready', { everyMs: 10, timeoutMs: 2500 }),
    ).toMatchObject({ version: '5.3.0' })
    expect(await api.call('renders.engine', {})).toMatchObject({
      available: true,
      path: executable,
      version: '5.3.0',
    })
    expect((await api.call('session.get', {})).capabilities.blender).toBe(true)
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const job = await api.call('renders.create', { pieceId: piece.id, scene: {} })
    expect(job.engine).toBe('blender')
    await api.call('renders.cancel', { id: job.id })
  })

  it('probes the managed engine at restart and gives explicit user settings priority', async () => {
    const file = join(dir, 'engine.json')
    const configured = join(dir, 'user-python')
    await fakeBlender(configured, '5.3.2')
    const chosen = new BlenderSetup({ file, dataDir: dir, env: { PAVE_PYTHON: configured } })
    const restarted = new BlenderSetup({ file, dataDir: dir, env: {} })
    try {
      await Promise.all([chosen.probed, restarted.probed])
      expect(chosen.status()).toMatchObject({ available: true, path: configured, version: '5.3.2' })
      expect(chosen.runtime()).toEqual({ pythonPath: configured })
      expect(restarted.status()).toMatchObject({
        available: true,
        path: executable,
        version: '5.3.0',
      })
      expect(restarted.runtime()).toEqual({ blenderPath: executable })
    } finally {
      await Promise.all([chosen.dispose(), restarted.dispose()])
    }
  })

  it('finds a compatible Blender already installed in a standard location', async () => {
    const compatible = join(dir, 'installed-blender')
    await fakeBlender(compatible, '5.3.1')
    packageInstall.candidates.push(compatible)
    const blender = new BlenderSetup({ file: null, dataDir: join(dir, 'fresh'), env: {} })
    try {
      await blender.probed
      expect(blender.status()).toMatchObject({
        available: true,
        path: compatible,
        version: '5.3.1',
      })
      expect(blender.install()).toMatchObject({ phase: 'ready' })
    } finally {
      await blender.dispose()
      packageInstall.candidates.pop()
    }
  })

  it('ties the installer to server shutdown and waits for cancellation cleanup', async () => {
    const instance = await engineServer({
      config: { dataDir: join(dir, 'shutdown') },
      engines: { blenderEnv: {} },
    })
    let finish: (() => void) | undefined
    try {
      packageInstall.run.mockImplementationOnce(
        (_dir: string, _progress: unknown, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                finish = () => reject(new Error('Download cancelled.'))
              },
              { once: true },
            )
          }),
      )
      expect((await post(instance, 'renders.installEngine')).status).toBe(200)
      const closing = instance.dispose()
      try {
        await until(async () => finish, Boolean, { everyMs: 10, timeoutMs: 1500 })
        await expect(Promise.race([closing, Promise.resolve('waiting')])).resolves.toBe('waiting')
      } finally {
        finish?.()
        await closing
      }
    } finally {
      finish?.()
    }
  })
})

it('does not offer local engine installation on a LAN bind', async () => {
  const server = await testServer({ config: { host: '0.0.0.0', allowedHosts: ['192.168.1.20'] } })
  try {
    expect(await (await post(server, 'renders.installStatus')).json()).toMatchObject({
      supported: false,
    })
    expect((await post(server, 'renders.installEngine')).status).toBe(403)
    expect(
      (await post(server, 'renders.cancelInstall', { base: 'http://192.168.1.20:8787' })).status,
    ).toBe(403)
  } finally {
    await server.dispose()
  }
})

it('refuses installation to an accounts owner or designer', async () => {
  const server = await testServer({ auth: 'accounts' })
  try {
    const owner = await signUp(server, 'Owner', 'owner@example.test')
    const designer = await signUp(server, 'Designer', 'designer@example.test')
    await joinOrg(server, owner, designer, 'designer@example.test', 'designer')
    for (const caller of [owner, designer]) {
      for (const name of ['renders.installEngine', 'renders.cancelInstall'] as const) {
        expect((await post(server, name, { headers: caller.headers() })).status).toBe(403)
      }
    }
  } finally {
    await server.dispose()
  }
})

it.skipIf(process.platform === 'win32')(
  'automatically installs from an owner render, sharing one attempt across waiting takes',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pave-first-render-'))
    const server = await engineServer({
      config: { dataDir: dir, plan: 'free' },
      engines: { blenderEnv: {} },
    })
    let failInstall: (() => void) | undefined
    const install = vi.fn(
      (_dir: string, progress: (status: object) => void) =>
        new Promise<string>((_resolve, reject) => {
          progress({ phase: 'downloading', downloadedBytes: 12, totalBytes: 100 })
          failInstall = () => reject(new Error('Download failed in test.'))
        }),
    )
    try {
      const api = client(server)
      const piece = await api.call('pieces.create', { templateId: 'solitaire' })
      const shot = { pieceId: piece.id, scene: {} }
      const take = (title: string, engine?: 'browser') =>
        post(server, 'renders.create', { body: JSON.stringify({ ...shot, title, engine }) })
      packageInstall.run.mockImplementation(install)
      expect((await api.call('renders.create', shot)).engine).toBe('browser')
      expect(await (await take('Explicit preview', 'browser')).json()).toMatchObject({
        engine: 'browser',
      })
      expect(
        await (
          await post(server, 'renders.create', {
            body: JSON.stringify(shot),
            headers: { authorization: 'Bearer agent-token' },
          })
        ).json(),
      ).toMatchObject({ engine: 'browser' })
      const estimate = await post(server, 'renders.estimate', {
        body: JSON.stringify({ pieceId: piece.id, takes: [{ scene: {} }] }),
      })
      expect(await estimate.json()).toMatchObject({ engine: 'blender' })
      expect(install).not.toHaveBeenCalled()
      const [a, b, c] = await Promise.all([take('Hero'), take('Top'), take('Profile')])
      const jobs = await Promise.all(
        [a, b, c].map(async (res) => RenderJobSchema.parse(await res.json())),
      )
      expect(jobs).toMatchObject(
        Array.from({ length: 3 }, () => ({ engine: 'blender', status: 'queued' })),
      )
      expect(install).toHaveBeenCalledTimes(1)
      expect(await (await post(server, 'renders.installStatus')).json()).toMatchObject({
        phase: 'downloading',
        downloadedBytes: 12,
      })
      await api.call('renders.cancel', { id: jobs[2]!.id })
      failInstall?.()
      for (const job of jobs.slice(0, 2)) {
        expect(
          await until(
            () => api.call('renders.get', { id: job.id }),
            (r) => r.status === 'failed',
          ),
        ).toMatchObject({ error: expect.stringContaining('Download failed in test') })
      }
      expect((await api.call('renders.get', { id: jobs[2]!.id })).status).toBe('canceled')
      expect(install).toHaveBeenCalledTimes(1)
      const allowance = async () =>
        (await api.call('plan.get', {})).allowances.find((a) => a.allowance === 'render')
      expect(await allowance()).toMatchObject({ used: 0, left: 5 })

      const canceledInstall = vi.fn(
        (_dir: string, _progress: unknown, signal: AbortSignal) =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      )
      packageInstall.run.mockImplementationOnce(canceledInstall)
      const waiting = RenderJobSchema.parse(await (await take('Retry')).json())
      expect(await (await post(server, 'renders.cancelInstall')).json()).toMatchObject({
        phase: 'cancelled',
      })
      expect(
        await until(
          () => api.call('renders.get', { id: waiting.id }),
          (r) => r.status === 'canceled',
        ),
      ).toMatchObject({
        error: 'Blender setup was canceled.',
      })
      expect(await allowance()).toMatchObject({ used: 0, left: 5 })

      const render = vi.spyOn(takeEngine, 'renderTake').mockImplementation(async ({ scene }) => ({
        scene,
        assetIds: [],
        critique: { passes: [] },
        seconds: 1,
        device: 'CPU',
        sceneHash: 'test-render',
      }))
      const success = vi.fn(async () => {
        const executable = join(dir, 'blender')
        await fakeBlender(executable, '5.3.0')
        return executable
      })
      packageInstall.run.mockImplementationOnce(success)
      try {
        const retry = RenderJobSchema.parse(await (await take('Retry')).json())
        const done = await until(
          () => api.call('renders.get', { id: retry.id }),
          (r) => ['done', 'failed'].includes(r.status),
        )
        expect(done).toMatchObject({ status: 'done', seconds: 1 })
        expect(success).toHaveBeenCalledTimes(1)
        expect(render).toHaveBeenCalledTimes(1)
        expect(await allowance()).toMatchObject({ used: 1, left: 4 })
      } finally {
        render.mockRestore()
      }
    } finally {
      failInstall?.()
      packageInstall.run.mockReset()
      await server.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  },
  BOOT_TIMEOUT,
)

it.skipIf(process.platform === 'win32')(
  'allows an approved Claude take from Studio to trigger setup and wait for the shared installer',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pave-first-claude-render-'))
    const blender = new BlenderSetup({ file: null, dataDir: dir, env: {} })
    const queue = createRenderQueue({
      blender,
      geometry: () => {
        throw new Error('No geometry should be read before setup finishes')
      },
    })
    const { server, model } = await assistantServer({
      transport: 'direct',
      env: { ANTHROPIC_API_KEY: 'sk-ant-test-local-render' },
      config: { plan: 'pro' },
      services: {
        renderQueue: queue,
        renderEngine: {
          status: async () => blender.status(),
          configure: (path) => blender.configure(path),
          installStatus: () => blender.installStatus(),
          install: () => blender.install(),
          cancelInstall: () => blender.cancelInstall(),
          dispose: () => blender.dispose(),
        },
      },
    })
    const install = vi.fn(
      (_dir: string, _progress: unknown, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    try {
      packageInstall.run.mockImplementation(install)
      const api = client(server)
      const take = { scene: { output: { quality: 'preview', width: 384, height: 384 } } }
      const piece = await api.call('pieces.create', { templateId: 'solitaire' })
      const request = { text: 'Render the piece', context: { pieceId: piece.id }, clientId: 'w1' }
      const send = (clientMessageId: string) => ({
        ...request,
        clientMessageId,
      })
      model.push(
        {
          content: [tool('renders_create', { ...take, pieceId: piece.id }, 'toolu_remote')],
          stop_reason: 'tool_use',
        },
        {
          content: [tool('renders_create', { ...take, pieceId: piece.id }, 'toolu_local')],
          stop_reason: 'tool_use',
        },
        { content: [text('Blender setup was canceled.')], stop_reason: 'end_turn' },
      )
      const status = (id: string) =>
        api.call('traces.run', { id }).then((result) => result.run.status)
      const remote = await api.call('threads.send', send('remote_1'))
      await until(
        () => status(remote.run.id),
        (value) => value === 'awaiting-approval',
      )
      await api.call('runs.decide', {
        runId: remote.run.id,
        toolCallId: 'toolu_remote',
        decision: 'approve',
      })
      await until(
        () => status(remote.run.id),
        (value) => value === 'waiting',
      )
      expect((await api.call('renders.list', { pieceId: piece.id }))[0]).toMatchObject({
        engine: 'browser',
      })
      expect(install).not.toHaveBeenCalled()
      await api.call('runs.cancel', { runId: remote.run.id })

      const sent = await post(server, 'threads.send', { body: JSON.stringify(send('local_1')) })
      expect(sent.status).toBe(200)
      const { run } = (await sent.json()) as { run: { id: string } }
      await until(
        () => status(run.id),
        (value) => value === 'awaiting-approval',
      )
      expect(install).not.toHaveBeenCalled()
      const approval = await post(server, 'runs.decide', {
        body: JSON.stringify({ runId: run.id, toolCallId: 'toolu_local', decision: 'approve' }),
      })
      expect(approval.status).toBe(200)
      await until(
        () => status(run.id),
        (value) => value === 'waiting',
      )
      const takes = await api.call('renders.list', { pieceId: piece.id })
      const queued = takes.find((job) => job.actor.type === 'agent' && job.actor.runId === run.id)
      expect(queued).toMatchObject({ engine: 'blender', status: 'queued' })
      expect(blender.installStatus().phase).toBe('downloading')
      expect(install).toHaveBeenCalledTimes(1)
      await post(server, 'renders.cancelInstall')
      await until(
        () => status(run.id),
        (value) => value === 'done',
      )
      expect(await api.call('renders.get', { id: queued!.id })).toMatchObject({
        status: 'canceled',
      })
    } finally {
      await blender.cancelInstall()
      packageInstall.run.mockReset()
      await server.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  },
  BOOT_TIMEOUT,
)
