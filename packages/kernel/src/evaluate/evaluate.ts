/**
 * The evaluator: walks a design in dependency order, memoises every node on a content hash,
 * and assembles the cached results into a {@link Scene} (and from it the public Evaluation).
 */
import { type Design, evaluationOrder, type Node, nodeRefs } from '@pave/schema'
import { type AnyFeature, type NodeResult, QUALITY, type Scene } from '../core'
import { manufacturabilityDiagnostics } from '../dfm/index'
import { discardRuntime, isRuntimeFault } from '../runtime/index'
import type { Detail, Diagnostic, EvaluateOptions, Evaluation } from '../types'
import {
  type Assembly,
  activeResults,
  assembleDraft,
  assembleProduction,
  type DraftCache,
} from './assemble'
import { buildNode, disposeResult, failedResult } from './build'
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
  /** Whole-piece checks, reused while no node (and so no part or stone) changed. */
  checks: { key: string; value: Diagnostic[] } | null
}

const LEVEL_ORDER = { error: 0, warning: 1, info: 2 } as const

export class Evaluator {
  private readonly features: ReadonlyMap<string, AnyFeature>
  private readonly caches: Record<Detail, DetailCache> = {
    draft: { nodes: new Map(), draftParts: new Map(), assembly: null, checks: null },
    production: { nodes: new Map(), draftParts: new Map(), assembly: null, checks: null },
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
    const run = this.queue.then(() => this.guarded(() => this.evaluate(design, options)))
    this.queue = run.catch(() => {})
    return run
  }

  /**
   * Runs `fn` (an evaluation, or an export of the last scene) and survives a fault inside a
   * WASM runtime: the heaps are then corrupt, so every cached solid is forgotten (not freed —
   * freeing would touch the dead heap) and the runtimes are reloaded on the next call.
   * Reusing them would make every later design in this kernel fail.
   */
  async guarded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      if (!isRuntimeFault(error)) throw error
      this.forget()
      discardRuntime()
      throw new Error(
        'The geometry engine ran out of room on this design and was restarted. Make the design lighter (fewer or larger stones, a smaller piece) and try again.',
        { cause: error },
      )
    }
  }

  /** Frees every cached solid. The evaluator can be used again afterwards. */
  dispose(): void {
    try {
      for (const cache of Object.values(this.caches)) {
        for (const result of cache.nodes.values()) disposeResult(result)
        cache.assembly?.value.dispose()
        cache.assembly = null
      }
    } catch (error) {
      // A runtime that faulted earlier cannot free anything; dropping the references is all
      // that is left to do.
      if (!isRuntimeFault(error)) throw error
      discardRuntime()
    } finally {
      this.forget()
    }
  }

  /** Drops every cached result without touching WASM memory. */
  private forget(): void {
    for (const cache of Object.values(this.caches)) {
      cache.nodes.clear()
      cache.draftParts.clear()
      cache.assembly = null
      cache.checks = null
    }
  }

  private async evaluate(design: Design, options: EvaluateOptions): Promise<Scene> {
    const started = performance.now()
    const detail = options.detail ?? 'draft'
    const quality = QUALITY[detail]
    const cache = this.caches[detail]
    // A corrupt document (an order entry with no node, a node missing from the order) is
    // evaluated as far as it makes sense and reported, never a TypeError from deep inside.
    const listed = design.order.filter((id) => Object.hasOwn(design.nodes, id))
    const unlisted = Object.keys(design.nodes).filter((id) => !design.order.includes(id))
    const order = evaluationOrder({ ...design, order: [...listed, ...unlisted] })
    if (!order) throw new Error('The design has nodes that reference each other in a cycle')
    const documentIssues: Diagnostic[] = [
      ...design.order
        .filter((id) => !Object.hasOwn(design.nodes, id))
        .map((id) => ({
          level: 'warning' as const,
          code: 'design.missingNode',
          message: `The outliner lists “${id}”, which is not in the design; it was skipped.`,
        })),
      ...unlisted.map((id) => ({
        level: 'warning' as const,
        code: 'design.unlisted',
        nodeId: id,
        message: `“${design.nodes[id]!.name ?? id}” is not in the outliner; it was evaluated anyway.`,
      })),
    ]
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
    const assembly = this.assembleOrDrop(design, results, detail, cache)
    timings['@assemble'] = performance.now() - assembleStarted

    const active = activeResults(design, results)
    const { stones, gemMeshes } = instanceStones(design, active)
    const diagnostics: Diagnostic[] = [
      ...documentIssues,
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
    const scene: Scene = {
      design,
      detail,
      quality,
      nodes: results,
      parts: assembly.parts,
      stones,
      evaluation,
    }
    // Whole-piece checks. Those that need fused bodies (cuts, buried stones, connectivity,
    // file limits) return nothing at draft; sizes, bail fit and group references run at both,
    // so the interactive view shows them too. They depend only on the node results, so they are
    // reused, like the production assembly, while no node changed.
    const checkStarted = performance.now()
    const checkKey = combineHashes([...results.values()].map((r) => r.hash))
    if (cache.checks?.key !== checkKey) {
      let value: Diagnostic[]
      try {
        value = manufacturabilityDiagnostics(scene)
      } catch (error) {
        if (isRuntimeFault(error)) throw error
        // A check that cannot run must not cost the designer the geometry it was checking.
        value = [
          {
            level: 'warning',
            code: 'dfm.unavailable',
            message: `Manufacturability checks could not be completed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ]
      }
      cache.checks = { key: checkKey, value }
    }
    diagnostics.push(...cache.checks.value)
    timings['@dfm'] = performance.now() - checkStarted
    diagnostics.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
    evaluation.ms = performance.now() - started
    return scene
  }

  /**
   * Assembles, and if a node's solid cannot be meshed or made manifold after all (the build
   * checks catch nearly every such body, but meshing is lazy), marks that node failed and
   * assembles the rest — one bad body costs its node, not the whole evaluation.
   */
  private assembleOrDrop(
    design: Design,
    results: Map<string, NodeResult>,
    detail: Detail,
    cache: DetailCache,
  ): Assembly {
    try {
      return this.assemble(design, results, detail, cache)
    } catch (error) {
      if (isRuntimeFault(error)) throw error
      const quality = QUALITY[detail]
      let dropped = 0
      for (const result of activeResults(design, results)) {
        const solids = [
          ...result.bodies.map((b) => b.solid),
          ...result.additions.map((a) => a.solid),
          ...(detail === 'production' ? result.cuts.map((c) => c.solid) : []),
        ]
        try {
          for (const solid of solids) solid.manifold(quality)
        } catch (reason) {
          const failed = failedResult(
            result,
            `its surface could not be made into a closed solid (${reason instanceof Error ? reason.message : 'the geometry kernel rejected it'})`,
          )
          results.set(result.id, failed)
          cache.nodes.set(result.id, failed)
          dropped++
        }
      }
      if (dropped === 0) throw error
      // The cached draft parts and assembly may hold the dropped solids.
      cache.draftParts.clear()
      cache.assembly?.value.dispose()
      cache.assembly = null
      return this.assemble(design, results, detail, cache)
    }
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
