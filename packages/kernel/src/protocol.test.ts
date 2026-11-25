import { applyOps, buildDesign, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { createKernelClient } from './client'
import { Evaluator } from './evaluate/evaluate'
import type { LocalKernel } from './kernel'
import type { Locks, Port, Request, Response } from './protocol'
import { loadRuntime } from './runtime/index'
import { CORE_FEATURES } from './testing/core'
import { serveKernel } from './workerHost'

/** Two ends of an in-memory channel that clones messages like a real Worker boundary. */
function channel(): {
  client: Port<Request, Response>
  worker: Port<Response, Request>
  sent: Response[]
} {
  const sent: Response[] = []
  const client: Port<Request, Response> = {
    onmessage: null,
    postMessage: (m) => queueMicrotask(() => worker.onmessage?.({ data: structuredClone(m) })),
  }
  const worker: Port<Response, Request> = {
    onmessage: null,
    postMessage: (m, transfer) => {
      const data = structuredClone(m, { transfer: transfer ?? [] })
      sent.push(data)
      queueMicrotask(() => client.onmessage?.({ data }))
    },
  }
  return { client, worker, sent }
}

function coreKernel(): LocalKernel {
  const evaluator = new Evaluator(CORE_FEATURES)
  const scene: LocalKernel['scene'] = async (design, options) => {
    await loadRuntime()
    return evaluator.scene(design, options)
  }
  return {
    kinds: evaluator.kinds,
    formats: [],
    ready: async () => void (await loadRuntime()),
    scene,
    evaluate: async (design, options) => (await scene(design, options)).evaluation,
    export: () => Promise.reject(new Error('no exporters in this test kernel')),
    dispose: () => evaluator.dispose(),
  }
}

const solitaire = buildDesign(TEMPLATES[0]!.spec)

describe('worker protocol', () => {
  it('round-trips an evaluation and sends only what changed', async () => {
    const { client: port, worker, sent } = channel()
    const local = coreKernel()
    serveKernel(local, worker)
    const client = createKernelClient({ port })
    expect(client.kinds).toEqual([])
    await client.ready()
    expect(client.kinds).toEqual(local.kinds)

    const direct = await local.evaluate(solitaire)
    const first = await client.evaluate(solitaire)
    expect(first.parts.map((p) => p.id)).toEqual(direct.parts.map((p) => p.id))
    expect(first.parts[0]!.mesh.positions).toEqual(direct.parts[0]!.mesh.positions)
    expect(first.parts[0]!.mesh.positions).not.toBe(direct.parts[0]!.mesh.positions)
    expect(first.report).toEqual(direct.report)
    expect(Object.keys(first.gemMeshes)).toEqual(Object.keys(direct.gemMeshes))
    // The kernel's own cached buffers were copied, not detached.
    expect((await local.evaluate(solitaire)).parts[0]!.mesh.positions.length).toBeGreaterThan(0)

    // Edit the head: the band's buffers are not sent again, and the client reuses its copy.
    const edited = applyOps(solitaire, [
      { t: 'update', id: 'head', patch: { prongCount: 6 } },
    ]).design
    const second = await client.evaluate(edited)
    const last = sent[sent.length - 1] as Extract<Response, { type: 'evaluated' }>
    const wire = Object.fromEntries(last.evaluation.parts.map((p) => [p.id, p]))
    expect(wire.band!.mesh).toBeUndefined()
    expect(wire.head!.mesh).toBeDefined()
    expect(last.evaluation.gemMeshes).toEqual({})
    expect(second.parts.find((p) => p.id === 'band')!.mesh).toBe(
      first.parts.find((p) => p.id === 'band')!.mesh,
    )
    expect(second.gemMeshes).toEqual(first.gemMeshes)
    expect(second.parts.find((p) => p.id === 'head')!.rev).not.toBe(
      first.parts.find((p) => p.id === 'head')!.rev,
    )

    // Production parts (fused per alloy) cross the boundary too, with nothing but plain data.
    const production = await client.evaluate(edited, { detail: 'production' })
    expect(production.parts).toHaveLength(1)
    expect(Object.keys(production.parts[0]!).sort()).toEqual(
      [
        'areaMm2',
        'bounds',
        'edges',
        'exact',
        'finish',
        'id',
        'material',
        'mesh',
        'name',
        'nodeId',
        'plating',
        'rev',
        'volumeMm3',
      ].sort(),
    )
    local.dispose()
  })

  it('the latest request wins', async () => {
    const { client: port, worker } = channel()
    const local = coreKernel()
    serveKernel(local, worker)
    const client = createKernelClient({ port })
    await client.ready()
    const halo = buildDesign(TEMPLATES.find((t) => t.id === 'halo')!.spec)
    const superseded = client.evaluate(halo, { detail: 'production' })
    const latest = client.evaluate(solitaire)
    await expect(superseded).rejects.toMatchObject({ name: 'AbortError' })
    expect((await latest).parts.length).toBeGreaterThan(0)

    const controller = new AbortController()
    const aborted = client.evaluate(halo, { detail: 'production', signal: controller.signal })
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })

    client.terminate()
    await expect(client.evaluate(solitaire)).rejects.toThrow(/terminated/)
    local.dispose()
  })
})

/** A port that behaves like a Worker which never answers, and can raise Worker events. */
function deadWorker(): Port<Request, Response> & {
  addEventListener(type: string, listener: (event: unknown) => void): void
  raise(type: string, event?: unknown): void
  terminated: boolean
  terminate(): void
} {
  const listeners = new Map<string, ((event: unknown) => void)[]>()
  return {
    onmessage: null,
    postMessage: () => {},
    addEventListener: (type, listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    raise: (type, event = {}) => {
      for (const l of listeners.get(type) ?? []) l(event)
    },
    terminated: false,
    terminate() {
      this.terminated = true
    },
  }
}

describe('a Worker that fails', () => {
  it('rejects what is pending and what comes later, ready included, and says so once', async () => {
    const port = deadWorker()
    const crashes: Error[] = []
    const client = createKernelClient({ port, onCrash: (e) => crashes.push(e) })
    const ready = client.ready()
    const evaluation = client.evaluate(solitaire)
    port.raise('error', { message: 'Uncaught Error: boot failed' })
    await expect(ready).rejects.toMatchObject({ name: 'WorkerCrashedError' })
    await expect(evaluation).rejects.toThrow(/boot failed/)
    await expect(client.ready()).rejects.toMatchObject({ name: 'WorkerCrashedError' })
    await expect(client.export(solitaire, 'stl')).rejects.toMatchObject({
      name: 'WorkerCrashedError',
    })
    port.raise('messageerror')
    expect(crashes).toHaveLength(1)
    expect(port.terminated).toBe(true)
  })

  it('forgets a request whose design cannot be posted', async () => {
    const { client: port, worker } = channel()
    const local = coreKernel()
    serveKernel(local, worker)
    // A real Worker clones synchronously inside postMessage, so a DataCloneError throws there.
    const post = port.postMessage
    port.postMessage = (m) => post(structuredClone(m))
    const client = createKernelClient({ port })
    await client.ready()
    const uncloneable = { ...solitaire, extra: () => {} } as unknown as typeof solitaire
    await expect(client.evaluate(uncloneable)).rejects.toThrow()
    // The failed request left nothing behind: a normal one still resolves.
    expect((await client.evaluate(solitaire)).parts.length).toBeGreaterThan(0)
    client.terminate()
    local.dispose()
  })
})

/**
 * Web Locks as the platform implements them, in memory: one holder per name, the holder keeps
 * it until its callback's promise settles, later requests queue (and can be aborted).
 */
function memoryLocks(): Locks {
  const busy = new Set<string>()
  const queues = new Map<string, (() => void)[]>()
  const release = (name: string) => {
    busy.delete(name)
    queues.get(name)?.shift()?.()
  }
  return {
    request: (name, { signal }, callback) =>
      new Promise((resolve, reject) => {
        const run = () => {
          busy.add(name)
          callback()
            .then(resolve, reject)
            .finally(() => release(name))
        }
        if (!busy.has(name)) return run()
        const queue = queues.get(name) ?? []
        queues.set(name, queue)
        queue.push(run)
        signal?.addEventListener('abort', () => {
          const at = queue.indexOf(run)
          if (at < 0) return
          queue.splice(at, 1)
          reject(new DOMException('Aborted', 'AbortError'))
        })
      }),
  }
}

/** A Worker that starts, holds its lock, then never answers again; `kill()` ends it. */
function mortalWorker(locks: Locks) {
  let kill!: () => void
  const killed = new Promise<void>((resolve) => {
    kill = resolve
  })
  const listeners = new Map<string, ((event: unknown) => void)[]>()
  const port: Port<Request, Response> & {
    addEventListener(type: string, listener: (event: unknown) => void): void
  } = {
    onmessage: null,
    addEventListener: (type, listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    postMessage: (m) => {
      if (m.type !== 'ready' || !m.lock) return
      // What the host does: take the lock (held until the Worker ends), then answer.
      void locks.request(m.lock, {}, () => {
        queueMicrotask(() =>
          port.onmessage?.({
            data: { type: 'ready', id: m.id, kinds: [], formats: [], locked: true },
          }),
        )
        return killed
      })
    },
  }
  const raise = (type: string, event: unknown = {}) => {
    for (const l of listeners.get(type) ?? []) l(event)
  }
  return { port, kill, raise }
}

describe('a Worker that dies after starting', () => {
  it('rejects what is pending once its lock is released, and says so once', async () => {
    const locks = memoryLocks()
    const worker = mortalWorker(locks)
    const crashes: Error[] = []
    const client = createKernelClient({ port: worker.port, locks, onCrash: (e) => crashes.push(e) })
    await client.ready()
    const pending = client.evaluate(solitaire)
    worker.kill()
    await expect(pending).rejects.toMatchObject({ name: 'WorkerCrashedError' })
    await expect(client.ready()).rejects.toMatchObject({ name: 'WorkerCrashedError' })
    await expect(client.evaluate(solitaire)).rejects.toMatchObject({ name: 'WorkerCrashedError' })
    expect(crashes).toHaveLength(1)
  })

  it('is not a crash when this client ends the Worker itself', async () => {
    const locks = memoryLocks()
    const worker = mortalWorker(locks)
    const crashes: Error[] = []
    const client = createKernelClient({ port: worker.port, locks, onCrash: (e) => crashes.push(e) })
    await client.ready()
    client.terminate()
    worker.kill()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(crashes).toEqual([])
  })

  it('answers a second ready after the first one failed (a WASM download cut off)', async () => {
    const { client: port, worker } = channel()
    const locks = memoryLocks()
    const local = coreKernel()
    let tries = 0
    const flaky: LocalKernel = {
      ...local,
      ready: () => (tries++ === 0 ? Promise.reject(new Error('NetworkError')) : local.ready()),
    }
    serveKernel(flaky, worker, locks)
    const client = createKernelClient({ port, locks })
    await expect(client.ready()).rejects.toThrow(/NetworkError/)
    const second = await Promise.race([
      client.ready().then(() => 'ready'),
      new Promise((resolve) => setTimeout(() => resolve('still waiting'), 2000)),
    ])
    expect(second).toBe('ready')
    expect((await client.evaluate(solitaire)).parts.length).toBeGreaterThan(0)
    client.terminate()
    local.dispose()
  })

  it('keeps working after an uncaught error in a Worker that is still running', async () => {
    const { client: port, worker } = channel()
    const listeners: ((event: unknown) => void)[] = []
    const local = coreKernel()
    serveKernel(local, worker)
    const crashes: Error[] = []
    // The same port object: the channel delivers to the `onmessage` the client sets on it.
    const events = Object.assign(port, {
      addEventListener: (type: string, l: (event: unknown) => void) => {
        if (type === 'error') listeners.push(l)
      },
    })
    const client = createKernelClient({ port: events, onCrash: (e) => crashes.push(e) })
    await client.ready()
    // A message the host does not understand: ignored there, and any stray error is not fatal.
    worker.onmessage?.({ data: null as unknown as Request })
    for (const l of listeners) l({ message: 'Uncaught TypeError: something else' })
    expect((await client.evaluate(solitaire)).parts.length).toBeGreaterThan(0)
    expect(crashes).toEqual([])
    client.terminate()
    local.dispose()
  })
})
