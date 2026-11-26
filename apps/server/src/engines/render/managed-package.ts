import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, rename, rm, rmdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

export const MANAGED_BLENDER_VERSION = '5.3.0'
// Both Blender mirrors publish the same blender-5.3.0.sha256 manifest.
const MIRRORS = [
  'https://ftp.halifax.rwth-aachen.de/blender/release/Blender5.3',
  'https://mirror.clarkson.edu/blender/release/Blender5.3',
]
const DOWNLOAD_IDLE_MS = 45_000
const EXTRACT_TIMEOUT_MS = 10 * 60_000
const MOUNT_TIMEOUT_MS = 2 * 60_000
const DETACH_TIMEOUT_MS = 30_000

export interface ManagedBlenderPackage {
  readonly version: string
  readonly bytes: number
  readonly sha256: string
  readonly filename: string
  readonly format: 'dmg' | 'tar'
  readonly executable: string
  readonly mirrors: readonly string[]
}

export interface ManagedBlenderProgress {
  phase: 'downloading' | 'verifying' | 'extracting'
  downloadedBytes?: number
  totalBytes?: number
}

type Progress = (progress: ManagedBlenderProgress) => void

export function managedBlenderPackage(
  platform = process.platform,
  arch = process.arch,
): ManagedBlenderPackage | null {
  const release = { version: MANAGED_BLENDER_VERSION, mirrors: MIRRORS }
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      ...release,
      bytes: 359893873,
      sha256: '2d802b54766741e612cead50b03ebbc8eb64dadc71eda932573d256b8a784720',
      filename: 'blender-5.3.0-macos-arm64.dmg',
      format: 'dmg',
      executable: 'Blender.app/Contents/MacOS/Blender',
    }
  }
  if (platform === 'linux' && arch === 'x64') {
    return {
      ...release,
      bytes: 406944100,
      sha256: 'dacb8264197a3f7fda6001285a5a506fc97ee943881261c2c3bd63c882f22e05',
      filename: 'blender-5.3.0-linux-x64.tar.xz',
      format: 'tar',
      executable: 'blender',
    }
  }
  if (platform === 'win32' && (arch === 'x64' || arch === 'arm64')) {
    return {
      ...release,
      bytes: arch === 'x64' ? 425299259 : 302503373,
      sha256:
        arch === 'x64'
          ? '3ac567a63d59d9934f7b9213bfb27ba05760e1fb366f8f55c381573ec3eabfa8'
          : 'c2e2ec602356fe2a33325538dc58c5a0c0ae068dfd0b3874d65de933df918452',
      filename: `blender-5.3.0-windows-${arch}.zip`,
      format: 'tar',
      executable: 'blender.exe',
    }
  }
  return null
}

function managedRoot(dataDir: string): string {
  return resolve(dataDir, 'managed', 'blender')
}

export function managedBlenderPath(dataDir: string): string | null {
  const pkg = managedBlenderPackage()
  return pkg ? join(managedRoot(dataDir), pkg.version, pkg.executable) : null
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function download(
  url: string,
  archive: string,
  totalBytes: number,
  progress: Progress,
  signal: AbortSignal,
): Promise<void> {
  const idle = new AbortController()
  const timeout = setTimeout(
    () => idle.abort(new Error('The Blender download stalled.')),
    DOWNLOAD_IDLE_MS,
  )
  timeout.unref()
  const transferSignal = AbortSignal.any([signal, idle.signal])
  let downloadedBytes = 0
  let lastReport = 0
  try {
    progress({ phase: 'downloading', downloadedBytes, totalBytes })
    const response = await fetch(url, { signal: transferSignal, redirect: 'error' })
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel()
      throw new Error(`Download returned HTTP ${response.status}.`)
    }
    await pipeline(
      response.body,
      async function* (source) {
        for await (const chunk of source) {
          timeout.refresh()
          downloadedBytes += chunk.byteLength
          if (downloadedBytes > totalBytes) {
            throw new Error('The Blender archive exceeds its expected size.')
          }
          const now = Date.now()
          if (now - lastReport >= 250) {
            lastReport = now
            progress({ phase: 'downloading', downloadedBytes, totalBytes })
          }
          yield chunk
        }
      },
      createWriteStream(archive, { flags: 'wx' }),
      { signal: transferSignal },
    )
    if (downloadedBytes !== totalBytes) {
      throw new Error('The Blender archive is incomplete.')
    }
    progress({ phase: 'downloading', downloadedBytes, totalBytes })
  } catch (err) {
    transferSignal.throwIfAborted()
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchVerifiedArchive(
  pkg: ManagedBlenderPackage,
  archive: string,
  progress: Progress,
  signal: AbortSignal,
): Promise<void> {
  const errors: string[] = []
  for (const mirror of pkg.mirrors) {
    signal.throwIfAborted()
    const url = new URL(`${mirror}/${pkg.filename}`)
    try {
      await download(url.href, archive, pkg.bytes, progress, signal)
      progress({ phase: 'verifying' })
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(archive, { signal })) hash.update(chunk)
      if (hash.digest('hex') !== pkg.sha256) {
        throw new Error('The Blender archive failed its SHA-256 integrity check.')
      }
      return
    } catch (err) {
      signal.throwIfAborted()
      errors.push(`${url.hostname} (${err instanceof Error ? err.message : 'Download failed.'})`)
      await rm(archive, { force: true })
    }
  }
  throw new Error(`Could not download a verified Blender archive. ${errors.join(' ')}`)
}

function run(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = AbortSignal.timeout(timeoutMs)
  const stop = signal ? AbortSignal.any([signal, deadline]) : deadline
  stop.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    const kill = () => child.kill('SIGKILL')
    stop.addEventListener('abort', kill, { once: true })
    let stderr = ''
    let spawnError: Error | undefined
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096)
    })
    child.once('error', (err) => {
      spawnError = err
    })
    // Wait until the tool has stopped accessing the staging files before cleanup.
    child.once('close', (code) => {
      stop.removeEventListener('abort', kill)
      if (stop.aborted) reject(stop.reason)
      else if (spawnError) reject(spawnError)
      else if (code !== 0)
        reject(new Error(stderr.trim() || `Archive tool exited with code ${code}.`))
      else resolve()
    })
  })
}

async function extractDmg(
  archive: string,
  destination: string,
  mount: string,
  signal: AbortSignal,
): Promise<void> {
  const hdiutil = '/usr/bin/hdiutil'
  await mkdir(mount)
  const device = (await stat(mount)).dev
  let attached = false
  try {
    signal.throwIfAborted()
    // Let attach finish so cancellation still pairs each mount with a detach.
    await run(
      hdiutil,
      ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, archive],
      MOUNT_TIMEOUT_MS,
    )
    attached = true
    await run(
      '/usr/bin/ditto',
      [join(mount, 'Blender.app'), join(destination, 'Blender.app')],
      EXTRACT_TIMEOUT_MS,
      signal,
    )
  } finally {
    // A failed attach may still have mounted the image.
    if (attached || (await stat(mount)).dev !== device) {
      await run(hdiutil, ['detach', mount], DETACH_TIMEOUT_MS).catch(() =>
        run(hdiutil, ['detach', '-force', mount], DETACH_TIMEOUT_MS),
      )
    }
    // hdiutil may have already removed the mount point when detaching.
    await rmdir(mount).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    })
  }
}

async function extractArchive(
  pkg: ManagedBlenderPackage,
  archive: string,
  destination: string,
  mount: string,
  signal: AbortSignal,
): Promise<void> {
  await mkdir(destination)
  if (pkg.format === 'dmg') {
    await extractDmg(archive, destination, mount, signal)
    return
  }
  const tar =
    process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      : '/usr/bin/tar'
  await run(
    tar,
    ['-xf', archive, '-C', destination, '--strip-components', '1'],
    EXTRACT_TIMEOUT_MS,
    signal,
  )
}

export async function installManagedBlender(
  dataDir: string,
  progress: Progress,
  signal: AbortSignal,
  pkg = managedBlenderPackage(),
): Promise<string> {
  signal.throwIfAborted()
  if (!pkg) throw new Error('A managed Blender package is unavailable for this platform.')
  const root = managedRoot(dataDir)
  const finalDirectory = join(root, pkg.version)
  const executable = join(finalDirectory, pkg.executable)
  if (await isExecutable(executable)) return executable

  await mkdir(root, { recursive: true })
  const staging = await mkdtemp(join(root, '.install-'))
  const archive = join(staging, pkg.filename)
  const extracted = join(staging, 'contents')
  try {
    await fetchVerifiedArchive(pkg, archive, progress, signal)
    progress({ phase: 'extracting' })
    // The mount point is outside staging so cleanup cannot recurse into a mounted image.
    await extractArchive(pkg, archive, extracted, `${staging}-mount`, signal)
    if (!(await isExecutable(join(extracted, pkg.executable)))) {
      throw new Error('The Blender archive did not contain the expected executable.')
    }
    signal.throwIfAborted()
    try {
      await rename(extracted, finalDirectory)
    } catch (err) {
      // Another process may have finished publishing the same pinned package.
      if (!(await isExecutable(executable))) throw err
    }
    return executable
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 3 })
  }
}
