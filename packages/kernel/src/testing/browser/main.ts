/** Browser fixture for hosts.test.ts: evaluates through the Worker client and publishes facts. */
import { TEMPLATES, applyOps, buildDesign } from '@pave/schema'
import { createKernelClient } from '../../client'

declare global {
  interface Window {
    kernelCheck?: Record<string, unknown>
  }
}

async function run(): Promise<Record<string, unknown>> {
  const kernel = createKernelClient()
  await kernel.ready()
  const design = buildDesign(TEMPLATES[0]!.spec)
  const first = await kernel.evaluate(design)
  const edited = applyOps(design, [{ t: 'update', id: 'head', patch: { prongCount: 6 } }]).design
  const second = await kernel.evaluate(edited, { detail: 'draft' })
  const production = await kernel.evaluate(edited, { detail: 'production' })
  kernel.terminate()
  return {
    kinds: kernel.kinds,
    parts: first.parts.map((p) => p.id),
    typedArrays: first.parts.every((p) => p.mesh.positions instanceof Float32Array && p.mesh.positions.length > 0),
    stones: first.stones.length,
    carat: first.report.caratTotal,
    bandReused: second.parts.find((p) => p.id === 'band')?.mesh === first.parts.find((p) => p.id === 'band')?.mesh,
    productionParts: production.parts.length,
    failed: [...first.diagnostics, ...production.diagnostics].filter((d) => d.code === 'feature.failed').length,
  }
}

run().then(
  (result) => {
    window.kernelCheck = result
  },
  (error) => {
    window.kernelCheck = { error: String(error) }
  },
)
