/**
 * The evaluator: walks a design in dependency order, memoises every node on a content hash,
 * and assembles the cached results into a {@link Scene} (and from it the public Evaluation).
 */
import {
  type Design,
  evaluationOrder,
  type Node,
  nodeRefs,
  pointFromCurvePlane,
} from '@pave/schema'
import { type AnyFeature, type NodeResult, QUALITY, type Scene } from '../core'
import { CHECK_NAMES, runCheck, withoutCascades } from '../dfm/index'
import type { HeadData } from '../features/setting'
import { transformPoint } from '../geometry/vec'
import { discardRuntime, isRuntimeFault, runtimeGeneration } from '../runtime/index'
import type { Detail, Diagnostic, EvaluatedCurve, EvaluateOptions, Evaluation } from '../types'
import {
  type Assembly,
  activeResults,
  assembleDraft,
  assembleProduction,
  type DraftCache,
  draftVolumes,
  withCurrentNames,
} from './assemble'
import { buildNode, disposeResult, failedResult, labelOf } from './build'
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

type SceneOptions = EvaluateOptions & { separateImportedBodies?: boolean }

const LEVEL_ORDER = { error: 0, warning: 1, info: 2 } as const

/**
 * Every evaluator in a thread shares the WASM heaps and the module-level solid scope, so all of
 * them run strictly one job at a time through this one queue. A queue per evaluator let two
 * kernels interleave, and the second one's nodes failed with "Solid scopes do not nest".
 */
let queue: Promise<unknown> = Promise.resolve()

export class Evaluator {
  private readonly features: ReadonlyMap<string, AnyFeature>
  private readonly caches: Record<Detail, DetailCache> = {
    draft: { nodes: new Map(), draftParts: new Map(), assembly: null, checks: null },
    production: { nodes: new Map(), draftParts: new Map(), assembly: null, checks: null },
  }
  /** The runtime the cached solids were made in (see `runtimeGeneration`). */
  private generation = runtimeGeneration()

  constructor(features: readonly AnyFeature[]) {
    this.features = new Map(features.map((f) => [f.kind, f]))
  }

  get kinds(): string[] {
    return [...this.features.keys()]
  }

  scene(design: Design, options: EvaluateOptions = {}): Promise<Scene> {
    return this.exclusive(() => this.evaluate(design, options))
  }

  /**
   * Evaluates and runs `use` on the scene before any other job may start, so nothing can
   * dispose the solids it reads (an exporter awaiting between files, a newer evaluation).
   */
  withScene<T>(
    design: Design,
    options: SceneOptions,
    use: (scene: Scene) => T | Promise<T>,
  ): Promise<T> {
    return this.exclusive(async () => use(await this.evaluate(design, options)))
  }

  /** Runs `fn` after every job queued before it, in any evaluator, guarded against faults. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(() => this.guarded(fn))
    queue = run.catch(() => {})
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
      discardRuntime()
      this.forget()
      throw new Error(
        'The geometry engine ran out of room on this design and was restarted. Make the design lighter (fewer or larger stones, a smaller piece) and try again.',
        { cause: error },
      )
    }
  }

  /** Frees every cached solid. The evaluator can be used again afterwards. */
  dispose(): void {
    // Solids made in a runtime that has since been discarded (by any kernel) cannot be freed.
    if (this.generation !== runtimeGeneration()) {
      this.forget()
      return
    }
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
    this.generation = runtimeGeneration()
    for (const cache of Object.values(this.caches)) {
      cache.nodes.clear()
      cache.draftParts.clear()
      cache.assembly = null
      cache.checks = null
    }
  }

  /**
   * Drops what was assembled from a node's cached result before that result is freed. The draft
   * parts and the production assembly are keyed on node hashes, so after an aborted evaluation
   * replaced a node, re-evaluating the earlier design would otherwise hit them and hand out
   * parts whose sources are freed solids (STEP reads those sources).
   */
  private release(cache: DetailCache, result: NodeResult): void {
    cache.draftParts.delete(result.id)
    cache.assembly?.value.dispose()
    cache.assembly = null
    disposeResult(result)
  }

  private async evaluate(design: Design, options: SceneOptions): Promise<Scene> {
    const started = performance.now()
    // Another kernel in this thread may have faulted and replaced the shared runtime: what this
    // one cached lives in the dropped heap and must be forgotten (never freed, never reused).
    if (this.generation !== runtimeGeneration()) this.forget()
    const detail = options.detail ?? 'draft'
    const quality = QUALITY[detail]
    const separateImportedBodies =
      detail === 'production' && options.separateImportedBodies === true
    const cache = this.caches[detail]
    // A corrupt document (an order entry with no node, a node missing from the order) is
    // evaluated as far as it makes sense and reported, never a TypeError from deep inside.
    const listed = design.order.filter((id) => Object.hasOwn(design.nodes, id))
    const unlisted = Object.keys(design.nodes).filter((id) => !design.order.includes(id))
    const sorted = evaluationOrder({ ...design, order: [...listed, ...unlisted] })
    if (!sorted) throw new Error('The design has nodes that reference each other in a cycle')
    // Only the design's own nodes: a reference to a missing "toString" must not evaluate
    // Object.prototype.toString as a node.
    const order = sorted.filter((id) => Object.hasOwn(design.nodes, id))
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
    /** Nodes renamed since their result was cached: id → the quoted old and new labels. */
    const renames = new Map<string, { before: string; after: string }>()
    for (const id of order) {
      const node = design.nodes[id] as Node
      const hash = combineHashes([
        hashNode(node),
        ...nodeRefs(node).map((ref) => results.get(ref)?.hash ?? '-'),
      ])
      let result = cache.nodes.get(id)
      if (result?.hash !== hash || result.transient) {
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
        if (result) this.release(cache, result)
        cache.nodes.set(id, built)
        result = built
        timings[id] = built.ms
      } else if (result.node !== node) {
        // The same geometry from a new node object: a rename (names are not hashed) or the same
        // document after a copy. The cached result is kept and given the current node.
        const before = labelOf(result.node)
        const after = labelOf(node)
        if (before !== after) renames.set(id, { before: `“${before}”`, after: `“${after}”` })
        result = { ...result, node }
        cache.nodes.set(id, result)
      }
      results.set(id, result)
    }
    // Messages name nodes in curly quotes; cached ones (this node's, its dependents', the
    // whole-piece checks') still carry the names they were written with. A message can only
    // name the nodes it is about: its own node, the nodes that node reads, and its `related`
    // ids. Each of those quotes is swapped for its node's new name, all at once, so two nodes
    // that swap names swap in the message too. A quote two of those nodes shared when the
    // message was written could be either, and is left as it is.
    const quotedAs = (id: string) =>
      renames.get(id)?.before ?? `“${results.get(id)?.node.name ?? id}”`
    const relabel = (list: readonly Diagnostic[]): Diagnostic[] =>
      list.map((d) => {
        const own = d.nodeId ? results.get(d.nodeId)?.node : undefined
        const about = new Set([
          ...(d.nodeId ? [d.nodeId] : []),
          ...(own ? nodeRefs(own) : []),
          ...(d.related ?? []).filter((id) => results.has(id)),
        ])
        const swaps = new Map<string, string>()
        for (const id of about) {
          const rename = renames.get(id)
          if (!rename) continue
          const others = [...about].filter((other) => other !== id)
          if (others.some((other) => quotedAs(other) === rename.before)) continue
          swaps.set(rename.before, rename.after)
        }
        if (swaps.size === 0) return d
        const message = d.message.replace(/“[^”]*”/g, (quoted) => swaps.get(quoted) ?? quoted)
        return message === d.message ? d : { ...d, message }
      })
    if (renames.size > 0) {
      for (const [id, result] of results) {
        const diagnostics = relabel(result.diagnostics)
        if (diagnostics.every((d, i) => d === result.diagnostics[i])) continue
        const renamed = { ...result, diagnostics }
        results.set(id, renamed)
        cache.nodes.set(id, renamed)
      }
      if (cache.checks) cache.checks = { ...cache.checks, value: relabel(cache.checks.value) }
    }
    for (const [id, stale] of cache.nodes)
      if (!results.has(id)) {
        this.release(cache, stale)
        cache.nodes.delete(id)
      }

    await breathe()
    const assembleStarted = performance.now()
    const assembly = this.assembleOrDrop(design, results, detail, cache, separateImportedBodies)
    const parts = withCurrentNames(assembly.parts, results)
    timings['@assemble'] = performance.now() - assembleStarted

    // Assembly can take seconds at production; an abort that arrived meanwhile stops here.
    await breathe()
    const active = activeResults(design, results)
    const { stones, gemMeshes } = instanceStones(design, active)
    const diagnostics: Diagnostic[] = [
      ...documentIssues,
      ...[...results.values()].flatMap((r) => r.diagnostics),
      ...stoneDiagnostics(stones),
    ]

    const curves = active.flatMap<EvaluatedCurve>(({ id, node, data }) => {
      if (node.kind === 'curve')
        return [
          {
            nodeId: id,
            plane: node.plane,
            closed: node.closed,
            points: node.points.map(({ u, v }) => pointFromCurvePlane(node.plane, [u, v])),
          },
        ]
      if (node.kind === 'nurbsCurve' && data)
        return [{ nodeId: id, closed: false, points: data as [number, number, number][] }]
      return []
    })
    const prongTips = active.flatMap(({ id, node, data, matrix }) =>
      node.kind === 'setting'
        ? (data as HeadData).claws.flatMap(({ number, tip }) =>
            tip
              ? [
                  {
                    nodeId: id,
                    number,
                    at: [...transformPoint(matrix, tip)] as [number, number, number],
                  },
                ]
              : [],
          )
        : [],
    )
    const evaluation: Evaluation = {
      detail,
      parts: parts.map((p) => p.part),
      stones: stones.map((s) => s.instance),
      gemMeshes,
      ...(curves.length ? { curves } : {}),
      ...(prongTips.length ? { prongTips } : {}),
      report: buildReport(
        design,
        parts,
        stones,
        detail === 'draft' ? draftVolumes(parts, quality) : undefined,
      ),
      diagnostics,
      ms: 0,
      timings,
    }
    const scene: Scene = {
      design,
      detail,
      quality,
      nodes: results,
      parts,
      stones,
      evaluation,
    }
    // Whole-piece checks. Those that need fused bodies (cuts, buried stones, connectivity,
    // file limits) return nothing at draft; sizes, bail fit and group references run at both,
    // so the interactive view shows them too. They depend only on the node results, so they are
    // reused, like the production assembly, while no node changed.
    const checkStarted = performance.now()
    const checkKey = assemblyKey(results, separateImportedBodies)
    if (cache.checks?.key !== checkKey) {
      // One check at a time with a breather between them, so an abort (or a newer request)
      // does not wait for every check of a heavy production piece. A check that cannot run
      // costs only its own findings (see `runCheck`).
      const found: Diagnostic[] = []
      for (const name of CHECK_NAMES) {
        await breathe()
        found.push(...runCheck(name, scene))
      }
      cache.checks = { key: checkKey, value: withoutCascades(found) }
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
    separateImportedBodies: boolean,
  ): Assembly {
    try {
      return this.assemble(design, results, detail, cache, separateImportedBodies)
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
      return this.assemble(design, results, detail, cache, separateImportedBodies)
    }
  }

  private assemble(
    design: Design,
    results: ReadonlyMap<string, NodeResult>,
    detail: Detail,
    cache: DetailCache,
    separateImportedBodies: boolean,
  ): Assembly {
    if (detail === 'draft') return assembleDraft(design, results, QUALITY.draft, cache.draftParts)
    // Fusing is the expensive step, so the whole production assembly is reused when no node
    // (or its visibility, which is part of the node hash) changed.
    const key = assemblyKey(results, separateImportedBodies)
    if (cache.assembly?.key !== key) {
      cache.assembly?.value.dispose()
      cache.assembly = null
      cache.assembly = {
        key,
        value: assembleProduction(design, results, QUALITY.production, key, separateImportedBodies),
      }
    }
    return cache.assembly.value
  }
}

function assemblyKey(results: ReadonlyMap<string, NodeResult>, separateImportedBodies: boolean) {
  const hashes = [...results.values()].map((r) => r.hash)
  if (separateImportedBodies) hashes.push('separate-imported-bodies')
  return combineHashes(hashes)
}
