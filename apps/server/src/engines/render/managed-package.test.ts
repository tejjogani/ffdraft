import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installManagedBlender,
  type ManagedBlenderPackage,
  type ManagedBlenderProgress,
  managedBlenderPackage,
  managedBlenderPath,
} from './managed-package'

const run = promisify(execFile)
const candidate = 'fixture Blender executable'
const mirrors = ['https://first.example/blender', 'https://second.example/blender']

describe('managed Blender archive installation', { timeout: 5_000 }, () => {
  let root: string
  let dataDir: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pave-blender-package-test-'))
    dataDir = join(root, 'workspace with spaces')
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(root, { recursive: true, force: true })
  })

  async function fixture() {
    const folder = join(root, 'fixture')
    const archive = join(root, 'fixture.tar')
    await mkdir(folder)
    await writeFile(join(folder, 'blender'), candidate, { mode: 0o755 })
    const tar =
      process.platform === 'win32'
        ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
        : '/usr/bin/tar'
    await run(tar, ['-cf', archive, '-C', root, 'fixture'])
    const bytes = await readFile(archive)
    const pkg: ManagedBlenderPackage = {
      version: '99.0.0',
      filename: 'fixture.tar',
      format: 'tar',
      executable: 'blender',
      mirrors,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
    return { bytes, pkg }
  }

  it('publishes the verified package after a mirror fails and reuses it on retry', async () => {
    const { bytes, pkg } = await fixture()
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith(mirrors[0]!) ? new Response(null, { status: 503 }) : new Response(bytes),
      ),
    )
    vi.stubGlobal('fetch', fetch)
    const received: ManagedBlenderProgress[] = []
    const signal = new AbortController().signal

    const path = await installManagedBlender(
      dataDir,
      (progress) => received.push(progress),
      signal,
      pkg,
    )

    expect(path).toBe(join(dataDir, 'managed', 'blender', '99.0.0', 'blender'))
    expect(await readFile(path, 'utf8')).toBe(candidate)
    expect(await readdir(join(dataDir, 'managed', 'blender'))).toEqual(['99.0.0'])
    expect(received).toContainEqual({
      phase: 'downloading',
      downloadedBytes: bytes.length,
      totalBytes: bytes.length,
    })
    expect(received.slice(-2).map(({ phase }) => phase)).toEqual(['verifying', 'extracting'])
    fetch.mockClear()
    expect(await installManagedBlender(dataDir, () => {}, signal, pkg)).toBe(path)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not extract an archive whose SHA-256 differs from the publisher checksum', async () => {
    const { bytes, pkg } = await fixture()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes)),
    )
    const received: ManagedBlenderProgress[] = []
    const signal = new AbortController().signal

    await expect(
      installManagedBlender(dataDir, (progress) => received.push(progress), signal, {
        ...pkg,
        sha256: '0'.repeat(64),
      }),
    ).rejects.toThrow(/SHA-256/)
    expect(received.map(({ phase }) => phase)).not.toContain('extracting')
    expect(await readdir(join(dataDir, 'managed', 'blender'))).toEqual([])
  })

  it('cancels a partial download, removes staging, and permits a new install', async () => {
    const { bytes, pkg } = await fixture()
    const controller = new AbortController()
    let reportPartial!: () => void
    const firstChunk = new Promise<void>((resolve) => {
      reportPartial = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(stream) {
                stream.enqueue(bytes.subarray(0, 128))
              },
            }),
          ),
      ),
    )

    const install = installManagedBlender(
      dataDir,
      ({ downloadedBytes }) => {
        if (downloadedBytes === 128) reportPartial()
      },
      controller.signal,
      pkg,
    )
    await firstChunk
    controller.abort()
    await expect(install).rejects.toMatchObject({ name: 'AbortError' })
    expect(await readdir(join(dataDir, 'managed', 'blender'))).toEqual([])

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes)),
    )
    const path = await installManagedBlender(dataDir, () => {}, new AbortController().signal, pkg)
    expect(await readFile(path, 'utf8')).toBe(candidate)
  })

  it('offers the pinned packages only for supported platforms', () => {
    expect(managedBlenderPackage('darwin', 'arm64')).toMatchObject({
      filename: 'blender-5.3.0-macos-arm64.dmg',
      bytes: 359893873,
    })
    expect(managedBlenderPackage('linux', 'x64')).toMatchObject({
      filename: 'blender-5.3.0-linux-x64.tar.xz',
      bytes: 406944100,
    })
    expect(managedBlenderPackage('win32', 'x64')).toMatchObject({
      filename: 'blender-5.3.0-windows-x64.zip',
      bytes: 425299259,
    })
    expect(managedBlenderPackage('win32', 'arm64')).toMatchObject({
      filename: 'blender-5.3.0-windows-arm64.zip',
      bytes: 302503373,
    })
    expect(managedBlenderPackage('darwin', 'x64')).toBeNull()
    expect(managedBlenderPackage('linux', 'arm64')).toBeNull()
    const pkg = managedBlenderPackage()
    expect(managedBlenderPath(dataDir)).toBe(
      pkg ? join(dataDir, 'managed', 'blender', '5.3.0', pkg.executable) : null,
    )
  })
})
