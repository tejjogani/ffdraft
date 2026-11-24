// The kernel's ambient module types, which its own tsconfig picks up from its src folder.
/// <reference path="../../kernel/src/runtime/opentype.d.ts" />
/// <reference path="../../kernel/src/runtime/vite.d.ts" />
/// <reference path="../../kernel/src/export/rhino3dmModule.d.ts" />
/**
 * A real kernel at draft detail for the tests and the benchmark. @pave/kernel is a dev
 * dependency only: the package itself is handed an `evaluate` function.
 */
import { createKernel } from '@pave/kernel'
import { buildDesign, type Design, TEMPLATES } from '@pave/schema'
import type { Evaluate } from './types'

let kernel: ReturnType<typeof createKernel> | null = null

export function draftKernel(): { evaluate: Evaluate; calls: () => number; ms: () => number } {
  kernel ??= createKernel()
  let n = 0
  let ms = 0
  return {
    evaluate: async (d: Design, signal?: AbortSignal) => {
      const t = performance.now()
      const e = await kernel!.evaluate(d, { detail: 'draft', ...(signal ? { signal } : {}) })
      ms += performance.now() - t
      n++
      return e
    },
    calls: () => n,
    ms: () => ms,
  }
}

export function template(id: string): Design {
  const t = TEMPLATES.find((x) => x.id === id)
  if (!t) throw new Error(`no template ${id}`)
  return buildDesign(t.spec)
}
