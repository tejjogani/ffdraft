/**
 * The evaluator: walks a design in dependency order, memoises every node on a content hash,
 * and assembles the cached results into a {@link Scene} (and from it the public Evaluation).
 */
import { type Design, type Node, evaluationOrder, nodeRefs } from '@pave/schema'
import { type AnyFeature, type NodeResult, QUALITY, type Scene } from '../core'
import type { Detail, Diagnostic, EvaluateOptions, Evaluation } from '../types'
import {
  type Assembly,
  type DraftCache,
  activeResults,
  assembleDraft,
  assembleProduction,
} from './assemble'
import { buildNode, disposeResult } from './build'
import { manufacturabilityDiagnostics } from '../dfm/index'
import { stoneDiagnostics } from './diagnostics'
import { combineHashes, hashNode } from './hash'
import { buildReport } from './report'
import { instanceStones } from './stones'
import { createBreather } from './yield'

/** Everything remembered between evaluations at one detail level. */
interface DetailCache {
  nodes: Map<string, NodeResult>
  draftParts: DraftCache
  assembly: { key: string; value: Assembly } | null
}

const LEVEL_ORDER = { error: 0, warning: 1, info: 2 } as const

export class Evaluator {
  private readonly features: ReadonlyMap<string, AnyFeature>
  private readonly caches: Record<Detail, DetailCache> = {
    draft: { nodes: new Map(), draftParts: new Map(), assembly: null },
    production: { nodes: new Map(), draftParts: new Map(), assembly: null },
  }
  /** Evaluations share the WASM heap and the solid scope, so they run strictly one at a time. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(features: readonly AnyFeature[]) {
    this.features = new Map(features.map((f) => [f.kind, f]))
  }

  get kinds(): string[] {
    return [...this.features.keys()]
  }

  scene(design: Design, options: EvaluateOptions = {}): Promise<Scene> {
    const run = this.queue.then(() => this.evaluate(design, options))
    this.queue = run.catch(() => {})
    return run
  }

  /** Frees every cached solid. The evaluator can be used again afterwards. */
  dispose(): void {
    for (const cache of Object.values(this.caches)) {
      for (const result of cache.nodes.values()) disposeResult(result)
      cache.nodes.clear()
      cache.draftParts.clear()
      cache.assembly?.value.dispose()
      cache.assembly = null
    }
  }

  private async evaluate(design: Design, options: EvaluateOptions): Promise<Scene> {
    const started = performance.now()
    const detail = options.detail ?? 'draft'
    const quality = QUALITY[detail]
    const cache = this.caches[detail]
    const order = evaluationOrder(design)
    if (!order) throw new Error('The design has nodes that reference each other in a cycle')
    options.signal?.throwIfAborted()
    const breathe = createBreather(options.signal)

    const results = new Map<string, NodeResult>()
    const timings: Record<string, number> = {}
    for (const id of order) {
      const node = design.nodes[id] as Node
      const hash = combineHashes([
        hashNode(node),
        ...nodeRefs(node).map((ref) => results.get(ref)?.hash ?? '-'),
      ])
      let result = cache.nodes.get(id)
      if (result?.hash !== hash) {
        await breathe()
        const built = await buildNode(this.features.get(node.kind), node, hash, {
          detail,
          quality,
          signal: options.signal,
          assets: options.assets,
          results,
        })
        // Replace the cache entry only once the new result exists, so an abort mid-build
        // leaves the cache consistent.
        if (result) disposeResult(result)
        cache.nodes.set(id, built)
        result = built
        timings[id] = built.ms
      }
      results.set(id, result)
    }
    for (const [id, stale] of cache.nodes)
      if (!results.has(id)) {
        disposeResult(stale)
        cache.nodes.delete(id)
      }

    await breathe()
    const assembleStarted = performance.now()
    const assembly = this.assemble(design, results, detail, cache)
    timings['@assemble'] = performance.now() - assembleStarted

    const active = activeResults(design, results)
    const { stones, gemMeshes } = instanceStones(design, active)
    const diagnostics: Diagnostic[] = [
      ...[...results.values()].flatMap((r) => r.diagnostics),
      ...stoneDiagnostics(stones),
    ]

    const evaluation: Evaluation = {
      detail,
      parts: assembly.parts.map((p) => p.part),
      stones: stones.map((s) => s.instance),
      gemMeshes,
      report: buildReport(design, assembly.parts, stones),
      diagnostics,
      ms: 0,
      timings,
    }
    const scene: Scene = { design, detail, quality, nodes: results, parts: assembly.parts, stones, evaluation }
    if (detail === 'production') {
      // Whole-piece manufacturability checks need the fused bodies, so they run here only.
      const checkStarted = performance.now()
      try {
        diagnostics.push(...manufacturabilityDiagnostics(scene))
      } catch (error) {
        // A check that cannot run must not cost the designer the geometry it was checking.
        diagnostics.push({
          level: 'warning',
          code: 'dfm.unavailable',
          message: `Manufacturability checks could not be completed: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
      timings['@dfm'] = performance.now() - checkStarted
    }
    diagnostics.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
    evaluation.ms = performance.now() - started
    return scene
  }

  private assemble(
    design: Design,
    results: ReadonlyMap<string, NodeResult>,
    detail: Detail,
    cache: DetailCache,
  ): Assembly {
    if (detail === 'draft') return assembleDraft(design, results, QUALITY.draft, cache.draftParts)
    // Fusing is the expensive step, so the whole production assembly is reused when no node
    // (or its visibility, which is part of the node hash) changed.
    const key = combineHashes([...results.values()].map((r) => r.hash))
    if (cache.assembly?.key !== key) {
      cache.assembly?.value.dispose()
      cache.assembly = null
      cache.assembly = { key, value: assembleProduction(design, results, QUALITY.production, key) }
    }
    return cache.assembly.value
  }
}
