/** The in-process kernel: the evaluator plus the exporter registry, behind the public contract. */
import { type Design, evaluationOrder, type Node, NodeSchema, resolveDesign } from '@pave/schema'
import type { Scene } from './core'
import { Evaluator } from './evaluate/evaluate'
import { EXPORTERS } from './export/index'
import { FEATURES } from './features/index'
import { loadRuntime } from './runtime/index'
import type {
  Diagnostic,
  EvaluateOptions,
  ExportFormat,
  ExportOptions,
  ExportResult,
  Kernel,
} from './types'

const LEVELS = { error: 0, warning: 1, info: 2 } as const

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

/** Error findings shown in an export's notes; the rest are counted. */
const NOTED_ERRORS = 5

/**
 * The evaluation's errors, as notes: a file that leaves the building with a wall too thin to
 * cast, or a stone nothing holds, must say so where the recipient reads. Nodes left out are
 * named by `missingNotes` instead.
 */
function errorNotes(scene: Scene): string[] {
  const errors = scene.evaluation.diagnostics.filter(
    (d) => d.level === 'error' && !d.code.startsWith('feature.') && d.code !== 'design.invalid',
  )
  const notes = errors.slice(0, NOTED_ERRORS).map((d) => `Check before making: ${d.message}`)
  if (errors.length > NOTED_ERRORS)
    notes.push(
      `${errors.length - NOTED_ERRORS} more manufacturability errors; see the design's checks.`,
    )
  return notes
}

/**
 * Nodes already checked against the schema, by identity (an edit replaces only what it
 * touches): why each is invalid, or the node with the schema's defaults filled in.
 */
const checked = new WeakMap<object, { problem: string | null; node: Node }>()

/**
 * Why a node is not a valid node of its kind (null when it is), and the node to evaluate: the
 * schema's parse when it parses, so a stored node that leaves out a defaulted field (`visible`,
 * a finish) evaluates as the schema says rather than as hidden or unfinished.
 */
function nodeProblem(node: unknown): { problem: string | null; node: Node } {
  if (node === null || typeof node !== 'object')
    return { problem: 'it is not a node', node: node as Node }
  let entry = checked.get(node)
  if (entry === undefined) {
    const parsed = NodeSchema.safeParse(node)
    const kind = (node as { kind?: unknown }).kind
    // A value out of its range is left to the feature, which clamps it or falls back with a
    // warning of its own (a stored measured size of 0); only a document whose shape is wrong
    // (a field missing, a number sent as a string, an unknown kind) is refused here.
    const issues = parsed.success
      ? []
      : parsed.error.issues.filter((i) => i.code !== 'too_small' && i.code !== 'too_big')
    const problem =
      issues.length === 0
        ? null
        : issues[0]!.path.join('.') === 'kind'
          ? `its kind “${String(kind)}” is not one this version knows`
          : issues
              .slice(0, 3)
              .map((i) => `${i.path.join('.') || 'kind'}: ${i.message}`)
              .join('; ')
    entry = { problem, node: parsed.success ? (parsed.data as Node) : (node as Node) }
    checked.set(node, entry)
  }
  return entry
}

/**
 * The kernel's boundary. A document from a client, the server or a file is checked before any
 * feature sees it: something that is not a design at all is rejected with one readable error;
 * a node that does not fit its schema (a field missing, a number sent as a string) is left out
 * with a `design.invalid` diagnostic, so it fails readably instead of as a TypeError deep in a
 * builder, and the rest of the piece still evaluates.
 */
function admit(input: unknown): { design: Design; issues: Diagnostic[] } {
  const value = input as Partial<Design> | null
  if (
    value === null ||
    typeof value !== 'object' ||
    value.nodes === null ||
    typeof value.nodes !== 'object' ||
    !Array.isArray(value.order)
  )
    throw new Error('This is not a Pavé design: it needs a map of nodes and an outliner order.')
  const issues: Diagnostic[] = []
  // Entries, not assignment: an id "__proto__" assigned into an object sets its prototype and
  // the node is gone without a word.
  const nodes: [string, Node][] = []
  for (const [id, node] of Object.entries(value.nodes)) {
    const { problem, node: admitted } = nodeProblem(node)
    if (problem === null) {
      nodes.push([id, admitted])
      continue
    }
    const name = (node as { name?: unknown } | null)?.name
    issues.push({
      level: 'error',
      code: 'design.invalid',
      nodeId: id,
      message: `“${typeof name === 'string' ? name : id}” was left out: it is not a valid node (${problem}).`,
    })
  }
  const dropped = new Set(issues.map((i) => i.nodeId))
  return {
    design: {
      ...(value as Design),
      nodes: Object.fromEntries(nodes),
      order: value.order.filter((id) => !dropped.has(id)),
    },
    issues,
  }
}

/**
 * Creates a kernel that runs in the calling thread — for Node, the server and tests. In a
 * browser use `createKernelClient()` so evaluation never blocks the UI.
 */
export function createKernel(): LocalKernel {
  const evaluator = new Evaluator(FEATURES)
  const exporters = new Map(EXPORTERS.map((e) => [e.format, e]))

  /**
   * Follow fields left absent (claws, wire, side-stone angles, shoulders, row gap) are filled
   * from the stone first, so every feature builds from explicit numbers and the node hashes
   * change exactly when a filled value does.
   */
  const prepare = (input: Design): { design: Design; issues: Diagnostic[] } => {
    const { design, issues } = admit(input)
    // A cycle is reported as one, not as whatever filling follow fields along it runs into.
    if (!evaluationOrder(design))
      throw new Error('The design has nodes that reference each other in a cycle')
    return { design: resolveDesign(design), issues }
  }

  /** The boundary's findings join the evaluation's, in its order (errors first). */
  const withIssues = (scene: Scene, issues: readonly Diagnostic[]): Scene => {
    if (issues.length === 0) return scene
    // A node left out here is not in the design the evaluator saw, so a node that reads it is
    // told it "does not exist". It does; it is invalid, and the designer is told that instead.
    const invalid = new Map(issues.map((i) => [i.nodeId, i]))
    const name = (id: string) => scene.nodes.get(id)?.node.name ?? id
    const explained = scene.evaluation.diagnostics.map((d) => {
      const input = d.code === 'feature.blocked' ? d.related?.[0] : undefined
      const issue = input === undefined ? undefined : invalid.get(input)
      if (!issue || !d.nodeId) return d
      const label = /^“([^”]*)”/.exec(issue.message)?.[1] ?? input
      return {
        ...d,
        message: `“${name(d.nodeId)}” was left out because “${label}” is not a valid node.`,
      }
    })
    const all = [...issues, ...explained]
    all.sort((a, b) => LEVELS[a.level] - LEVELS[b.level])
    scene.evaluation.diagnostics = all
    return scene
  }

  const scene = async (input: Design, options?: EvaluateOptions): Promise<Scene> => {
    await loadRuntime()
    const { design, issues } = prepare(input)
    return withIssues(await evaluator.scene(design, options), issues)
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
      await loadRuntime()
      const prepared = prepare(design)
      // The exporter reads the cached solids, so it runs in the same exclusive, fault-guarded
      // job as the evaluation: no other request can free them halfway through a file.
      return evaluator.withScene(
        prepared.design,
        {
          detail: exporter.detail,
          separateImportedBodies: exporter.separateImportedBodies,
          ...(options.assets ? { assets: options.assets } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        },
        async (evaluated) => {
          const result = await exporter.run(evaluated, options)
          const invalid = prepared.issues.map((i) => `Not in this file: ${i.message}`)
          return {
            ...result,
            notes: [
              ...result.notes,
              ...missingNotes(evaluated, options),
              ...invalid,
              ...errorNotes(evaluated),
              ...evaluated.evaluation.diagnostics
                .filter(
                  (d) =>
                    d.code === 'stone.offsetSeating' &&
                    (!options.only || options.only.includes(d.nodeId!)),
                )
                .map((d) => d.message),
            ],
          }
        },
      )
    },
    dispose: () => evaluator.dispose(),
  }
}
