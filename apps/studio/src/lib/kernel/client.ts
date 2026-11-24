/**
 * The geometry kernel for the whole studio: one draft worker for interaction, and a second,
 * lazily started worker for production detail and exports (so a slow production check or STEP
 * export never delays the viewport). It is terminated after a minute without use.
 *
 * Every evaluation goes through a scheduler (./scheduler), never straight to a client. A worker
 * that stops answering is replaced once; after a second failure the engine reports `crashed`
 * and waits for `restartKernel()` (offered as a command).
 */
import { createKernelClient, type Detail, type KernelClient } from '@pave/kernel'
import { useSyncExternalStore } from 'react'
import { assetUrl } from '../assets'
import { createScheduler, type EvaluationScheduler, type Evaluator } from './scheduler'

export type KernelStatus = 'booting' | 'ready' | 'crashed' | 'unavailable'

export interface KernelInfo {
  status: KernelStatus
  /** Node kinds this build evaluates (empty until ready). */
  kinds: readonly string[]
  /** Export formats this build writes (empty until ready). */
  formats: readonly string[]
  /** Why the engine is unavailable or crashed. */
  error?: string
}

/** Loads binary assets (imported meshes, height maps) for the kernel. */
export async function resolveAsset(assetId: string): Promise<Uint8Array> {
  const res = await fetch(assetUrl(assetId), { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`Asset ${assetId} could not be loaded (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

/** A draft evaluation that has not answered in this long is treated as a hung worker. */
const WATCHDOG_MS = { draft: 45_000, production: 180_000 }
const EXPORT_IDLE_MS = 60_000

let info: KernelInfo = { status: 'booting', kinds: [], formats: [] }
const listeners = new Set<() => void>()
const setInfo = (next: Partial<KernelInfo>) => {
  info = { ...info, ...next }
  for (const l of listeners) l()
}

const createClient = (): KernelClient =>
  import.meta.env.DEV && new URLSearchParams(location.search).get('kernel') === 'none'
    ? failingClient()
    : createKernelClient()

/** Development aid (`?kernel=none`): a kernel that never loads, to see the edit-by-numbers fallback. */
function failingClient(): KernelClient {
  const fail = () => Promise.reject(new Error('The geometry engine is disabled (?kernel=none)'))
  return { kinds: [], formats: [], ready: fail, evaluate: fail, export: fail, terminate() {} }
}

interface Slot {
  client: KernelClient | null
  respawned: boolean
}

const draft: Slot = { client: null, respawned: false }
const production: Slot = { client: null, respawned: false }
let idleTimer: ReturnType<typeof setTimeout> | undefined

function boot(w: Slot, primary: boolean): KernelClient {
  if (w.client) return w.client
  const client = createClient()
  w.client = client
  if (primary) {
    setInfo({ status: 'booting' })
    client.ready().then(
      () => setInfo({ status: 'ready', kinds: client.kinds, formats: client.formats }),
      (e: unknown) => {
        if (w.client !== client) return
        setInfo({ status: 'unavailable', error: e instanceof Error ? e.message : String(e) })
      },
    )
  }
  return client
}

function crash(w: Slot, primary: boolean, reason: string) {
  w.client?.terminate()
  w.client = null
  if (w.respawned) {
    if (primary) setInfo({ status: 'crashed', error: reason })
    return
  }
  w.respawned = true
  boot(w, primary)
}

/** Wraps a worker so a request that never answers terminates and replaces it. */
function guarded(w: Slot, detail: Detail): Evaluator {
  const primary = w === draft
  return {
    async evaluate(design, options) {
      if (primary && info.status === 'crashed') throw new Error('The geometry engine stopped')
      const client = boot(w, primary)
      let timer: ReturnType<typeof setTimeout> | undefined
      const hung = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          crash(w, primary, 'The geometry engine stopped responding')
          reject(new Error('The geometry engine stopped responding'))
        }, WATCHDOG_MS[detail])
      })
      try {
        return await Promise.race([client.evaluate(design, { ...options, detail }), hung])
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

const touchProduction = () => {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    production.client?.terminate()
    production.client = null
  }, EXPORT_IDLE_MS)
}

const productionEvaluator = guarded(production, 'production')

const schedulers: Record<Detail, EvaluationScheduler> = {
  draft: createScheduler(() => guarded(draft, 'draft'), { assets: resolveAsset }),
  production: createScheduler(
    () => ({
      evaluate: (design, options) => {
        touchProduction()
        return productionEvaluator.evaluate(design, options)
      },
    }),
    { assets: resolveAsset },
  ),
}

/** The one scheduler per level of detail; the only way the studio evaluates a design. */
export function evaluationScheduler(detail: Detail): EvaluationScheduler {
  return schedulers[detail]
}

/** The export worker (production detail), started on demand. */
export function exportKernel(): KernelClient {
  touchProduction()
  return boot(production, false)
}

/** Starts the draft worker early (e.g. when a Design tab opens) so WASM loads while the page renders. */
export function warmKernel(): void {
  boot(draft, true)
}

/** Replaces both workers after a crash. */
export function restartKernel(): void {
  for (const w of [draft, production]) {
    w.client?.terminate()
    w.client = null
    w.respawned = false
  }
  boot(draft, true)
}

export function useKernelInfo(): KernelInfo {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => info,
  )
}

export const kernelInfo = (): KernelInfo => info
