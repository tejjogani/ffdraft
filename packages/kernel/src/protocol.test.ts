import { applyOps, buildDesign, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { createKernelClient } from './client'
import { Evaluator } from './evaluate/evaluate'
import type { LocalKernel } from './kernel'
import type { Port, Request, Response } from './protocol'
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
