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

export class BlenderSetup {
  readonly #file: string | null
  #blenderPath: string | null = null
  #status: RenderEngineStatus = UNPROBED
  /** Settles once the saved choice is loaded and probed. */
  readonly ready: Promise<void>

  constructor(opts: { file: string | null }) {
    this.#file = opts.file
    this.ready = this.#init().catch((err: unknown) => {
      console.error('Looking for Blender failed:', err)
      this.#status = { ...UNPROBED, reason: 'Blender could not be checked on this machine.' }
    })
  }

  get available(): boolean {
    return this.#status.available
  }

  status(): RenderEngineStatus {
    return this.#status
  }

  /** What `renderWithBlender` needs to run the chosen Blender. */
  runtime(): Pick<RuntimeOptions, 'blenderPath'> {
    return this.#blenderPath === null ? {} : { blenderPath: this.#blenderPath }
  }

  /** Probes `blenderPath` (null = discover again) and switches to it only if it works. */
  async configure(blenderPath: string | null): Promise<RenderEngineStatus> {
    await this.ready
    const probed = await probe(blenderPath, null)
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

  async #init(): Promise<void> {
    const saved = await this.#load()
    this.#blenderPath = saved?.blenderPath ?? null
    // Trust the last good probe while re-probing, if what it ran is still there.
    if (saved?.status?.available && saved.status.path && existsSync(saved.status.path))
      this.#status = saved.status
    this.#status = await probe(this.#blenderPath, this.#status.device)
    await this.#save()
  }

  async #load(): Promise<Saved | null> {
    if (!this.#file) return null
    try {
      return JSON.parse(await readFile(this.#file, 'utf8')) as Saved
    } catch {
      return null
    }
  }

  async #save(): Promise<void> {
    if (!this.#file) return
    const saved: Saved = { blenderPath: this.#blenderPath, status: this.#status }
    await mkdir(dirname(this.#file), { recursive: true })
    // Write then rename, so a crash never leaves half a file behind.
    const temp = `${this.#file}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(saved, null, 2))
    await rename(temp, this.#file)
  }
}

async function probe(blenderPath: string | null, device: string | null): Promise<RenderEngineStatus> {
  const found = await detectBlender(blenderPath === null ? {} : { blenderPath })
  return {
    available: found.available,
    version: found.version ?? null,
    device: found.available ? device : null,
    path: found.command,
    reason: found.available ? null : found.reason?.slice(0, 1000) || 'Blender did not start.',
  }
}
