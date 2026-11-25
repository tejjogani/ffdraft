/**
 * Which Blender this server renders with, and whether it works. The choice (a Blender
 * executable, or null for discovery: `PAVE_PYTHON`, `PAVE_BLENDER`, then the worker's bpy venv)
 * is saved to `<dataDir>/engine.json` together with the last probe, so a restart reports Blender
 * as available at once and confirms it in the background.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { detectBlender, type RuntimeOptions } from '@pave/render/node'
import type { RenderEngineStatus } from '@pave/schema'

interface Saved {
  blenderPath: string | null
  status?: RenderEngineStatus
}

const UNPROBED: RenderEngineStatus = {
  available: false,
  version: null,
  device: null,
  path: null,
  reason: 'Looking for Blender…',
}

/** How long boot waits for a first probe when there is no saved one to trust. */
const BOOT_WAIT_MS = 20_000

export class BlenderSetup {
  readonly #file: string | null
  /** Where `PAVE_PYTHON` and `PAVE_BLENDER` are read when no Blender was chosen. */
  readonly #env: NodeJS.ProcessEnv | undefined
  /** Saves run one after another, each writing the state current when it starts. */
  #saving: Promise<void> = Promise.resolve()
  #blenderPath: string | null = null
  #status: RenderEngineStatus = UNPROBED
  /** Settles once the status is known well enough to boot on: a trusted saved probe, or a fresh one. */
  readonly ready: Promise<void>
  /** Settles once this run's own probe has finished. */
  readonly probed: Promise<void>

  constructor(opts: { file: string | null; env?: NodeJS.ProcessEnv }) {
    this.#file = opts.file
    this.#env = opts.env
    const loaded = this.#load().then((saved) => {
      this.#blenderPath = saved?.blenderPath ?? null
      const last = saved?.status
      // Trust the last good probe while re-probing, if what it ran is still there.
      if (last?.available && last.path && existsSync(last.path)) this.#status = last
      return this.#status.available
    })
    this.probed = loaded
      .then(async () => {
        this.#status = await probe(this.#blenderPath, this.#status.device, this.#env)
        await this.#save()
      })
      .catch((err: unknown) => {
        console.error('Looking for Blender failed:', err)
        this.#status = { ...UNPROBED, reason: 'Blender could not be checked on this machine.' }
      })
    this.ready = loaded.then(async (trusted) => {
      if (trusted) return
      let timer: NodeJS.Timeout | undefined
      await Promise.race([
        this.probed,
        new Promise((resolve) => {
          timer = setTimeout(resolve, BOOT_WAIT_MS)
        }),
      ])
      clearTimeout(timer)
    })
  }

  get available(): boolean {
    return this.#status.available
  }

  status(): RenderEngineStatus {
    return this.#status
  }

  /** What `renderWithBlender` needs to run the chosen Blender. */
  runtime(): Pick<RuntimeOptions, 'blenderPath' | 'env'> {
    if (this.#blenderPath !== null) return { blenderPath: this.#blenderPath }
    return this.#env ? { env: this.#env } : {}
  }

  /** Probes `blenderPath` (null = discover again) and switches to it only if it works. */
  async configure(blenderPath: string | null): Promise<RenderEngineStatus> {
    await this.probed
    const probed = await probe(blenderPath, null, this.#env)
    if (!probed.available) return probed
    this.#blenderPath = blenderPath
    this.#status = probed
    await this.#save()
    return probed
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
      const saved: Saved = { blenderPath: this.#blenderPath, status: this.#status }
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
  blenderPath: string | null,
  device: string | null,
  env: NodeJS.ProcessEnv | undefined,
): Promise<RenderEngineStatus> {
  const found = await detectBlender(blenderPath !== null ? { blenderPath } : env ? { env } : {})
  return {
    available: found.available,
    version: found.version ?? null,
    device: found.available ? device : null,
    path: found.command,
    reason: found.available ? null : found.reason?.slice(0, 1000) || 'Blender did not start.',
  }
}
