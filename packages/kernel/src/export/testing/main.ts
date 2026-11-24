/** Browser fixture for browser.test.ts: every export format through the Worker client. */
import { buildDesign, TEMPLATES } from '@pave/schema'
import { createKernelClient } from '../../client'

declare global {
  interface Window {
    exportCheck?: Record<string, unknown>
  }
}

async function run(): Promise<Record<string, unknown>> {
  const kernel = createKernelClient()
  await kernel.ready()
  const design = buildDesign(TEMPLATES[0]!.spec)
  const sizes: Record<string, number | string> = {}
  for (const format of ['glb', 'stl', '3mf', 'obj', 'step', '3dm'] as const) {
    try {
      sizes[format] = (await kernel.export(design, format)).bytes.byteLength
    } catch (error) {
      sizes[format] = String(error)
    }
  }
  kernel.terminate()
  return sizes
}

run().then(
  (result) => {
    window.exportCheck = result
  },
  (error) => {
    window.exportCheck = { error: String(error) }
  },
)
