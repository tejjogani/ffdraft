/** Which Blender this server renders with and whether it has passed a fresh launch probe. */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { detectBlender, type RuntimeOptions, resolveRuntime } from '@pave/render/node'
import type { RenderEngineStatus, RenderInstallStatus } from '@pave/schema'
import { conflict } from '../../errors'
import { installedBlenderCandidates } from './installed-blender'
import {
  installManagedBlender,
  MANAGED_BLENDER_VERSION,
  type ManagedBlenderProgress,
  managedBlenderPackage,
  managedBlenderPath,
} from './managed-package'

interface Saved {
  blenderPath: string | null
  status?: RenderEngineStatus
}

type RuntimeSelection = Pick<RuntimeOptions, 'blenderPath' | 'pythonPath'>

const UNPROBED: RenderEngineStatus = {
  available: false,
  version: null,
  device: null,
  path: null,
  reason: 'Looking for Blender…',
}

export const BLENDER_INSTALL_UNAVAILABLE: RenderInstallStatus = {
  supported: false,
  phase: 'idle',
  version: MANAGED_BLENDER_VERSION,
  downloadedBytes: 0,
  totalBytes: 0,
  reason: 'Automatic Blender setup is unavailable here.',
}

const BOOT_WAIT_MS = 20_000
const DISCOVERY_PROBE_MS = 8_000
const compatible = (version: string | null): boolean => /^5\.3\.\d+$/.test(version ?? '')

export class BlenderSetup {
  readonly #file: string | null
  readonly #dataDir: string | null
  readonly #env: NodeJS.ProcessEnv
  readonly #lifetime = new AbortController()
  #configuredPath: string | null = null
  #runtime: RuntimeSelection = {}
  #status: RenderEngineStatus = UNPROBED
  #saving: Promise<void> = Promise.resolve()
  #configuring: Promise<RenderEngineStatus> | null = null
  #checked = false
  #installStatus: RenderInstallStatus
  #installation: { controller: AbortController; done: Promise<void> } | null = null
  /** Boot waits for a probe with a ceiling so a broken engine cannot hold the studio shut. */
  readonly ready: Promise<void>
  /** Settles once this run's own probe has finished, for jobs resumed at boot. */
  readonly probed: Promise<void>

  constructor(opts: { file: string | null; env?: NodeJS.ProcessEnv; dataDir?: string | null }) {
    this.#file = opts.file
    this.#dataDir = opts.dataDir ?? null
    this.#env = opts.env ?? process.env
    const archive = this.#dataDir && managedBlenderPackage()
    this.#installStatus = archive
      ? {
          supported: true,
          phase: 'checking',
          version: archive.version,
          downloadedBytes: 0,
          totalBytes: archive.bytes,
          reason: null,
        }
      : BLENDER_INSTALL_UNAVAILABLE

    this.probed = this.#start()
      .catch((err: unknown) => {
        if (!this.#lifetime.signal.aborted) console.error('Looking for Blender failed:', err)
        this.#status = { ...UNPROBED, reason: 'Blender could not be checked on this machine.' }
      })
      .finally(() => {
        this.#checked = true
        if (this.#installStatus.supported)
          this.#installStatus = { ...this.#installStatus, phase: 'idle' }
      })

    let timer: NodeJS.Timeout | undefined
    this.ready = Promise.race([
      this.probed,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, BOOT_WAIT_MS)
      }),
    ]).finally(() => clearTimeout(timer))
  }

  async #start(): Promise<void> {
    const saved = await this.#load()
    this.#configuredPath = saved?.blenderPath ?? null
    const found = await this.#discover(this.#configuredPath)
    this.#lifetime.signal.throwIfAborted()
    this.#runtime = found.runtime
    const device = saved?.status?.path === found.status.path ? saved.status.device : null
    this.#status = { ...found.status, device: found.status.available ? device : null }
  }

  async #discover(configuredPath: string | null): Promise<{
    runtime: RuntimeSelection
    status: RenderEngineStatus
  }> {
    const signal = this.#lifetime.signal
    const installed = resolveRuntime({ env: this.#env })
    const fallback: RuntimeSelection =
      installed.kind === 'bpy'
        ? { pythonPath: installed.command }
        : { blenderPath: installed.command }
    if (configuredPath) {
      const runtime = { blenderPath: configuredPath }
      const status = await probe(runtime, signal)
      if (status.available) return { runtime, status }
    }
    const explicit = !!(this.#env.PAVE_PYTHON || this.#env.PAVE_BLENDER)
    const status = await probe(fallback, signal, !explicit)
    if (status.available || !this.#dataDir) return { runtime: fallback, status }

    const managed = managedBlenderPath(this.#dataDir)
    const candidates = await installedBlenderCandidates(this.#env)
    for (const path of new Set([managed, ...candidates])) {
      signal.throwIfAborted()
      if (!path || !existsSync(path) || path === status.path || path === configuredPath) continue
      const runtime = { blenderPath: path }
      const candidate = await probe(runtime, signal, true, DISCOVERY_PROBE_MS)
      if (candidate.available) return { runtime, status: candidate }
    }
    return { runtime: fallback, status }
  }

  get available(): boolean {
    return this.#status.available
  }

  status(): RenderEngineStatus {
    return this.#status
  }

  /** The same executable and runtime kind that passed the probe. */
  runtime(): RuntimeSelection {
    return this.#runtime
  }

  /** Probes `blenderPath` (null = discover again) and switches to it only if it works. */
  async configure(blenderPath: string | null): Promise<RenderEngineStatus> {
    await this.probed
    this.#lifetime.signal.throwIfAborted()
    if (this.#installation || this.#configuring)
      throw conflict('Wait for the current Blender setup to finish.')
    this.#configuring = this.#configure(blenderPath)
    try {
      return await this.#configuring
    } finally {
      this.#configuring = null
    }
  }

  async #configure(blenderPath: string | null): Promise<RenderEngineStatus> {
    const found = blenderPath
      ? { runtime: { blenderPath }, status: await probe({ blenderPath }, this.#lifetime.signal) }
      : await this.#discover(null)
    this.#lifetime.signal.throwIfAborted()
    if (found.status.available) {
      this.#configuredPath = blenderPath
      this.#runtime = found.runtime
      this.#status = found.status
      await this.#save()
    }
    return found.status
  }

  installStatus(): RenderInstallStatus {
    return this.#status.available
      ? { ...this.#installStatus, phase: 'ready', reason: null }
      : this.#installStatus
  }

  install(): RenderInstallStatus {
    const dataDir = this.#dataDir
    if (
      !dataDir ||
      !this.#installStatus.supported ||
      !this.#checked ||
      this.#configuring ||
      this.#installation ||
      this.#status.available ||
      this.#lifetime.signal.aborted
    )
      return this.installStatus()
    const controller = new AbortController()
    this.#installStatus = {
      ...this.#installStatus,
      phase: 'downloading',
      downloadedBytes: 0,
      reason: null,
    }
    this.#installation = {
      controller,
      done: Promise.resolve().then(() => this.#finishInstall(dataDir, controller.signal)),
    }
    return this.installStatus()
  }

  /** Join the current managed install, or start one after discovery has finished. */
  async prepareRender(): Promise<{ engine: RenderEngineStatus; setupCanceled?: boolean }> {
    await this.probed
    await this.#configuring?.catch(() => undefined)
    this.install()
    await this.#installation?.done
    const install = this.installStatus()
    if (install.phase === 'cancelled') return { engine: this.#status, setupCanceled: true }
    if (install.phase === 'failed')
      return { engine: { ...this.#status, reason: install.reason ?? 'Blender setup failed.' } }
    return { engine: this.#status }
  }

  async cancelInstall(): Promise<RenderInstallStatus> {
    const installation = this.#installation
    installation?.controller.abort()
    await installation?.done
    return this.installStatus()
  }

  async #finishInstall(dataDir: string, signal: AbortSignal): Promise<void> {
    const update = (progress: ManagedBlenderProgress) => {
      if (signal.aborted) return
      const { phase, downloadedBytes, totalBytes } = progress
      this.#installStatus = {
        ...this.#installStatus,
        phase,
        downloadedBytes: downloadedBytes ?? this.#installStatus.downloadedBytes,
        totalBytes: totalBytes ?? this.#installStatus.totalBytes,
      }
    }
    try {
      const executable = await installManagedBlender(dataDir, update, signal)
      signal.throwIfAborted()
      this.#installStatus = { ...this.#installStatus, phase: 'checkingEngine' }
      const runtime = { blenderPath: executable }
      const status = await probe(runtime, signal, true)
      signal.throwIfAborted()
      if (!status.available)
        throw new Error(`Blender was installed but could not start. ${status.reason ?? ''}`.trim())
      this.#configuredPath = null
      this.#runtime = runtime
      this.#status = status
      this.#installStatus = { ...this.#installStatus, phase: 'ready' }
      await this.#save().catch((err: unknown) => console.error('Saving engine.json failed:', err))
    } catch (err) {
      this.#installStatus = {
        ...this.#installStatus,
        phase: signal.aborted ? 'cancelled' : 'failed',
        reason: signal.aborted
          ? null
          : (err instanceof Error ? err.message : 'Blender setup failed.').slice(0, 400),
      }
    } finally {
      this.#installation = null
    }
  }

  async dispose(): Promise<void> {
    this.#lifetime.abort()
    await Promise.allSettled([this.cancelInstall(), this.probed, this.#configuring, this.#saving])
  }

  /** Remembers the device Cycles reported, for `renders.engine`. */
  noteDevice(device: string): void {
    if (this.#status.device === device) return
    this.#status = { ...this.#status, device }
    void this.#save().catch((err: unknown) => console.error('Saving engine.json failed:', err))
  }

  async #load(): Promise<Saved | null> {
    if (!this.#file) return null
    try {
      return JSON.parse(await readFile(this.#file, 'utf8')) as Saved
    } catch {
      return null
    }
  }

  #save(): Promise<void> {
    const file = this.#file
    if (!file) return Promise.resolve()
    const write = async () => {
      const saved: Saved = { blenderPath: this.#configuredPath, status: this.#status }
      await mkdir(dirname(file), { recursive: true })
      // Write then rename, so a crash never leaves half a file behind.
      const temp = `${file}.${process.pid}.tmp`
      await writeFile(temp, JSON.stringify(saved, null, 2))
      await rename(temp, file)
    }
    const next = this.#saving.then(write)
    this.#saving = next.catch(() => {})
    return next
  }
}

async function probe(
  runtime: RuntimeSelection,
  signal: AbortSignal,
  requireCompatible = false,
  timeoutMs?: number,
): Promise<RenderEngineStatus> {
  const found = await detectBlender(runtime, {
    signal,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
  const version = found.version ?? null
  const available = found.available && (!requireCompatible || compatible(version))
  return {
    available,
    version,
    device: null,
    path: found.command,
    reason: available
      ? null
      : found.available
        ? `This Blender is version ${version}. Pavé needs Blender 5.3.`
        : found.reason?.slice(0, 1000) || 'Blender did not start.',
  }
}
