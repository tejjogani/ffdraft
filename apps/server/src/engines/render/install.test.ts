import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isToolCommand, RenderInstallStatusSchema } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
  name: (typeof names)[number],
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
