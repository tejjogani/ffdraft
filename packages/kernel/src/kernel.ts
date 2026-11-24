/** The in-process kernel: the evaluator plus the exporter registry, behind the public contract. */
import type { Design } from '@pave/schema'
import type { Scene } from './core'
import { Evaluator } from './evaluate/evaluate'
import { EXPORTERS } from './export/index'
import { FEATURES } from './features/index'
import { loadRuntime } from './runtime/index'
import type { EvaluateOptions, ExportFormat, ExportOptions, ExportResult, Kernel } from './types'

/** The in-process kernel also exposes internals that cannot cross a Worker boundary. */
export interface LocalKernel extends Kernel {
  /** Evaluates and returns the scene: the evaluation plus every node's solids and frames. */
  scene(design: Design, options?: EvaluateOptions): Promise<Scene>
  /** Frees all cached geometry (WASM memory). The kernel stays usable. */
  dispose(): void
}

/**
 * A note for every visible node whose geometry is not in the file because it could not be
 * built: an incomplete piece must not leave the building looking complete.
 */
function missingNotes(scene: Scene, options: ExportOptions): string[] {
  const only = options.only && new Set(options.only)
  const notes: string[] = []
  for (const result of scene.nodes.values()) {
    if (result.status === 'ok' || !result.node.visible || (only && !only.has(result.id))) continue
    const why = result.diagnostics.find((d) => d.code.startsWith('feature.'))?.message
    notes.push(
      `Not in this file: “${result.node.name ?? result.id}” (${result.node.kind}) — ${why ?? `it is ${result.status}`}`,
    )
  }
  return notes
}

/**
 * Creates a kernel that runs in the calling thread — for Node, the server and tests. In a
 * browser use `createKernelClient()` so evaluation never blocks the UI.
 */
export function createKernel(): LocalKernel {
  const evaluator = new Evaluator(FEATURES)
  const exporters = new Map(EXPORTERS.map((e) => [e.format, e]))

  const scene = async (design: Design, options?: EvaluateOptions): Promise<Scene> => {
    await loadRuntime()
    return evaluator.scene(design, options)
  }

  return {
    kinds: evaluator.kinds,
    formats: [...exporters.keys()],
    ready: async () => {
      await loadRuntime()
    },
    scene,
    evaluate: async (design, options) => (await scene(design, options)).evaluation,
    async export(
      design: Design,
      format: ExportFormat,
      options: ExportOptions = {},
    ): Promise<ExportResult> {
      const exporter = exporters.get(format)
      if (!exporter)
        throw new Error(
          `Export to ${format} is not available in this build (available: ${[...exporters.keys()].join(', ') || 'none'})`,
        )
      const evaluated = await scene(design, { detail: exporter.detail, assets: options.assets })
      // An exporter works on the cached solids, so a WASM fault there must reset them too.
      const result = await evaluator.guarded(async () => exporter.run(evaluated, options))
      return { ...result, notes: [...result.notes, ...missingNotes(evaluated, options)] }
    },
    dispose: () => evaluator.dispose(),
  }
}
