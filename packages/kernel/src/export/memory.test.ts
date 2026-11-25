/**
 * WASM memory an export leaves behind. A WASM heap never shrinks, and the kernel on the server
 * lives for hours, so whatever one export keeps is multiplied by every export after it.
 */
import { buildDesign, TEMPLATES } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createKernel, type LocalKernel } from '../kernel'
import { loadRhino3dm } from './rhino3dm'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

/** The memory of every WASM module instantiated while `load` runs (rhino3dm exposes none). */
async function memoriesOf(load: () => Promise<unknown>): Promise<WebAssembly.Memory[]> {
  const memories: WebAssembly.Memory[] = []
  const original = WebAssembly.instantiate
  const patched = async (...args: unknown[]) => {
    const result = await (original as (...a: unknown[]) => Promise<unknown>).apply(
      WebAssembly,
      args,
    )
    const instance = ((result as { instance?: WebAssembly.Instance }).instance ??
      result) as WebAssembly.Instance
    for (const value of Object.values(instance.exports ?? {}))
      if (value instanceof WebAssembly.Memory) memories.push(value)
    return result
  }
  ;(WebAssembly as { instantiate: unknown }).instantiate = patched
  try {
    await load()
  } finally {
    ;(WebAssembly as { instantiate: unknown }).instantiate = original
  }
  return memories
}

describe('3DM memory', () => {
  it('frees each export’s document: the rhino3dm heap does not grow with every file', async () => {
    await kernel.ready()
    const memories = await memoriesOf(loadRhino3dm)
    expect(memories).toHaveLength(1)
    const heap = () => memories[0]!.buffer.byteLength
    const design = buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)
    await kernel.export(design, '3dm')
    const before = heap()
    for (let i = 0; i < 30; i++) await kernel.export(design, '3dm')
    // The document's tables kept every export's model alive (4 MB each: 138 MB over these
    // thirty), and one list object per vertex and per face was never freed.
    expect(heap() - before).toBeLessThan(10e6)
  }, 120_000)
})
