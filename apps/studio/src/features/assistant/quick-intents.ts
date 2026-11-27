/**
 * What a right-click is about, and the edits offered for it before any AI: "Replace stone…",
 * "Change metal", "Make it bigger / smaller". Pure and deterministic, so the same entries serve
 * every context menu, the command palette and tests; the edits themselves are the schema's
 * targeted-edit functions (`replaceStone`) and plain ops, never improvised.
 * docs/plans/targeted-edits.md §7.
 */
import type { Evaluation, StoneInstance } from '@pave/kernel'
import {
  type Capabilities,
  type Design,
  describeNode,
  fittedCarat,
  GEM_CUTS,
  IntentError,
  type IntentResult,
  labelForOps,
  MELEE_SIZES_MM,
  METALS,
  type MetalId,
  type Node,
  type NodeOf,
  nodeTitle,
  type Op,
  replaceStone,
  resolveDesign,
  stoneDims,
} from '@pave/schema'

export type Vec3 = [number, number, number]

/** The thing a context menu was opened on. */
export type Subject =
  | {
      type: 'stone'
      pieceId: string
      /**
       * A gem, or the row, halo or pavé field the clicked stone belongs to; or another node that
       * carries stones (a tennis chain), which Replace stone cannot change yet.
       */
      nodeId: string
      /** The clicked stone's index inside a field, as the evaluation numbered it. */
      instance?: number
      /** Its girdle centre in model mm at the version clicked (the plan's pick point). */
      point?: Vec3
      /** How many stones the node holds, when an evaluation said so. */
      count?: number
      /** What the evaluation calls the stone: a centre stone is not sized like melee. */
      role?: StoneInstance['role']
    }
  | { type: 'part'; pieceId: string; nodeId: string }
  | { type: 'piece'; pieceId: string }

type Gem = NodeOf<'gem'>
type Field = NodeOf<'gemRow'> | NodeOf<'halo'> | NodeOf<'pave'>
type StoneNode = Gem | Field

export const isStoneNode = (n: Node | undefined): n is StoneNode =>
  !!n && (n.kind === 'gem' || n.kind === 'gemRow' || n.kind === 'halo' || n.kind === 'pave')

/** `${nodeId}:${index}` → index. */
const instanceOf = (stoneId: string): number | undefined => {
  const i = Number(stoneId.slice(stoneId.lastIndexOf(':') + 1))
  return Number.isInteger(i) ? i : undefined
}

/**
 * The subject of a click on the model or a feature-tree row. A stone of a row, halo or pavé
 * addresses the whole field: one stone there shares its seat and spacing with the others.
 */
export function subjectFor(
  pieceId: string,
  design: Design,
  pick: { nodeId: string; stoneId?: string; partId?: string } | null,
  evaluation?: Evaluation | null,
): Subject {
  const node = pick ? design.nodes[pick.nodeId] : undefined
  if (!pick || !node) return { type: 'piece', pieceId }
  // A click on a stone is about the stone, whatever node carries it (a chain's stones too); a
  // stone node's tree row is about its stones even without a click on one.
  if (pick.partId || (!isStoneNode(node) && !pick.stoneId))
    return { type: 'part', pieceId, nodeId: node.id }
  const stones = evaluation?.stones.filter((s) => s.nodeId === node.id)
  const clicked = pick.stoneId ? stones?.find((s) => s.id === pick.stoneId) : undefined
  const instance = pick.stoneId && node.kind !== 'gem' ? instanceOf(pick.stoneId) : undefined
  const role = (clicked ?? stones?.[0])?.role
  return {
    type: 'stone',
    pieceId,
    nodeId: node.id,
    ...(instance !== undefined ? { instance } : {}),
    // The instance matrix is column-major: its translation is the girdle centre.
    ...(clicked ? { point: [clicked.matrix[12]!, clicked.matrix[13]!, clicked.matrix[14]!] } : {}),
    ...(stones?.length ? { count: stones.length } : {}),
    ...(role ? { role } : {}),
  }
}

/** "halo", "row", "pavé": how a jeweler names a field of stones. */
const FIELD_WORD: Record<Field['kind'], string> = { halo: 'halo', gemRow: 'row', pave: 'pavé' }

/** What a stone subject addresses, in words: "Centre stone", "All 24 stones in this halo". */
export function stoneScope(design: Design, subject: Extract<Subject, { type: 'stone' }>): string {
  const n = design.nodes[subject.nodeId]
  if (!isStoneNode(n)) return ''
  if (n.kind === 'gem') return nodeTitle(n)
  const count = subject.count ? `All ${subject.count} stones` : 'Every stone'
  return `${count} in this ${FIELD_WORD[n.kind]}`
}

// ── Stock steps ──────────────────────────────────────────────────────────────────────────────

/** The weights single stones are bought and talked about in. */
export const CARAT_STEPS = [
  0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.5, 1.75, 2,
  2.25, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10,
] as const

/**
 * The next step up or down a ladder from `value`; a value within 1 % of a step counts as on it
 * (a 1.497 ct stone is a 1.5). Null past either end.
 */
export function nextStep(
  ladder: readonly number[],
  value: number,
  dir: 'up' | 'down',
): number | null {
  if (dir === 'up') return ladder.find((s) => s > value * 1.01) ?? null
  return ladder.findLast((s) => s < value * 0.99) ?? null
}

/** A field's stone size and its key ("stoneWidth", or a pavé's largest stone). */
const fieldSize = (n: Field): number => (n.kind === 'pave' ? n.sizeMax : n.stoneWidth)

const fmt = (v: number, digits = 2) => Number(v.toFixed(digits)).toString()

/** Carats as the inspector shows them: two decimals, three for a stone under 0.1 ct. */
export const fmtCarat = (ct: number): string => ct.toFixed(ct < 0.1 ? 3 : 2)

/** One step bigger or smaller, as a ready edit, or why there is none. */
function stoneStep(
  design: Design,
  node: StoneNode,
  dir: 'up' | 'down',
): { edit?: IntentResult; hint?: string; disabled?: string } {
  const edge = dir === 'up' ? 'Already the largest stock size' : 'Already the smallest stock size'
  let result: IntentResult
  let hint: string
  try {
    if (node.kind === 'gem') {
      const resolved = resolveDesign(design).nodes[node.id] as Gem
      const carat = fittedCarat(node.cut, stoneDims(resolved), node.stone, node.sourcing)
      const next = nextStep(CARAT_STEPS, carat, dir)
      if (next === null) return { disabled: edge }
      result = replaceStone(design, { nodeId: node.id }, { carat: next })
      hint = `${fmtCarat(carat)} → ${fmtCarat(next)} ct`
    } else {
      const size = fieldSize(node)
      const next = nextStep(MELEE_SIZES_MM, size, dir)
      if (next === null) return { disabled: edge }
      result = replaceStone(design, { nodeId: node.id }, { widthMm: next })
      hint = `${fmt(size)} → ${fmt(next)} mm`
    }
  } catch (err) {
    if (err instanceof IntentError) return { disabled: err.message }
    throw err
  }
  // The field's own range ends before the stock list does (a halo takes 3.5 mm at most).
  if (!result.ops.length) return { disabled: edge }
  return { edit: result, hint }
}

/** A body's overall height, for "bigger / smaller" on a logo, a mesh or a relief. */
function heightStep(node: Node, dir: 'up' | 'down'): { ops: Op[] } | { disabled: string } | null {
  if (!('height' in node) || typeof node.height !== 'number') return null
  const field = describeNode(node.kind).fields.find((f) => f.key === 'height')
  if (!field) return null
  const step = field.meta.step ?? 0.05
  // Ten percent a click, on the field's own step, inside its range.
  const raw = node.height * (dir === 'up' ? 1.1 : 1 / 1.1)
  const next = Math.min(field.max ?? raw, Math.max(field.min ?? raw, Math.round(raw / step) * step))
  if (Math.abs(next - node.height) < step / 2)
    return { disabled: dir === 'up' ? 'Already as tall as it goes' : 'Already as small as it goes' }
  return { ops: [{ t: 'update', id: node.id, patch: { height: Number(next.toFixed(3)) } }] }
}

// ── Quick intents ────────────────────────────────────────────────────────────────────────────

export type QuickIntentId = 'replaceStone' | 'changeMetal' | 'bigger' | 'smaller'

export interface QuickIntent {
  id: QuickIntentId
  label: string
  /** Second line: what it will touch or do ("All 24 stones in this halo", "1.5 → 1.75 ct"). */
  hint?: string
  /** Why it cannot run now, shown in place of the hint on a disabled row. */
  disabled?: string
  /** A one-click intent's ready change. */
  edit?: { ops: Op[]; label: string }
  /** For a metal change: the nodes it rewrites and the metal they share (null when mixed). */
  metal?: { nodeIds: string[]; current: MetalId | null }
}

const hasMetal = (n: Node): n is Node & { material: MetalId } =>
  'material' in n && typeof n.material === 'string' && n.material in METALS

function metalOf(design: Design, ids: string[]): QuickIntent['metal'] {
  const metals = new Set(ids.map((id) => (design.nodes[id] as { material: MetalId }).material))
  return { nodeIds: ids, current: metals.size === 1 ? [...metals][0]! : null }
}

export const VIEW_ONLY = 'View only: ask an editor for access'

/**
 * The deterministic edits for a subject, in menu order. `readOnly` (viewer or guest) keeps the
 * rows in place, disabled with the reason, like every other edit.
 */
export function quickIntents(
  subject: Subject,
  design: Design,
  opts: { readOnly?: boolean } = {},
): QuickIntent[] {
  const intents: QuickIntent[] = []
  if (subject.type === 'stone' && !isStoneNode(design.nodes[subject.nodeId])) {
    // Stones a chain (or another part) carries: the intent cannot address them yet, so the row
    // says so; the part's metal can still change from here.
    const node = design.nodes[subject.nodeId]
    if (!node) return []
    intents.push({
      id: 'replaceStone',
      label: 'Replace stone…',
      disabled: `Stones on “${nodeTitle(node)}” can’t be replaced here yet`,
    })
    if (hasMetal(node))
      intents.push({
        id: 'changeMetal',
        label: 'Change metal',
        hint: METALS[node.material].label,
        metal: metalOf(design, [node.id]),
      })
  } else if (subject.type === 'stone') {
    const node = design.nodes[subject.nodeId]
    if (!isStoneNode(node)) return []
    // A field says how many stones it means; a single stone is named by the menu around it.
    intents.push({
      id: 'replaceStone',
      label: node.kind === 'gem' ? 'Replace stone…' : 'Replace stones…',
      ...(node.kind === 'gem' ? {} : { hint: stoneScope(design, subject) }),
    })
    for (const dir of ['up', 'down'] as const) {
      const step = stoneStep(design, node, dir)
      intents.push({
        id: dir === 'up' ? 'bigger' : 'smaller',
        label: dir === 'up' ? 'Make it bigger' : 'Make it smaller',
        ...(step.hint ? { hint: step.hint } : {}),
        ...(step.disabled ? { disabled: step.disabled } : {}),
        ...(step.edit ? { edit: { ops: step.edit.ops, label: step.edit.label } } : {}),
      })
    }
  } else if (subject.type === 'part') {
    const node = design.nodes[subject.nodeId]
    if (!node) return []
    if (hasMetal(node))
      intents.push({
        id: 'changeMetal',
        label: 'Change metal',
        hint: METALS[node.material].label,
        metal: metalOf(design, [node.id]),
      })
    for (const dir of ['up', 'down'] as const) {
      const step = heightStep(node, dir)
      if (!step) continue
      intents.push({
        id: dir === 'up' ? 'bigger' : 'smaller',
        label: dir === 'up' ? 'Make it bigger' : 'Make it smaller',
        ...('disabled' in step
          ? { disabled: step.disabled }
          : {
              hint: labelForOps(step.ops, design),
              edit: { ops: step.ops, label: labelForOps(step.ops, design) },
            }),
      })
    }
  } else {
    const ids = design.order.filter((id) => hasMetal(design.nodes[id]!))
    if (ids.length) {
      const metal = metalOf(design, ids)
      intents.push({
        id: 'changeMetal',
        label: 'Change metal everywhere',
        hint: metal?.current ? METALS[metal.current].label : 'Mixed metals',
        metal,
      })
    }
  }
  return opts.readOnly
    ? intents.map(({ edit: _edit, hint: _hint, ...i }) => ({ ...i, disabled: VIEW_ONLY }))
    : intents
}

/** The ops that put every listed node in `metal`; nothing for nodes already in it. */
export const metalOps = (design: Design, ids: readonly string[], metal: MetalId): Op[] =>
  ids
    .filter((id) => (design.nodes[id] as { material?: string } | undefined)?.material !== metal)
    .map((id) => ({ t: 'update', id, patch: { material: metal } }))

// ── Ask AI ───────────────────────────────────────────────────────────────────────────────────

export interface AskAi {
  label: string
  /** The row's second line: without a Claude key, the assistant opens on its key form first. */
  hint?: string
}

/**
 * What an entry point to the assistant says before it opens (the menus' Ask AI row): without a
 * key it still opens, on the form that connects Claude, so the row says so rather than going
 * dead.
 */
export function assistantHint(capabilities: Pick<Capabilities, 'assistant'>): string | undefined {
  return capabilities.assistant ? undefined : 'Connect Claude first, in the assistant'
}

export function askAi(subject: Subject, capabilities: Pick<Capabilities, 'assistant'>): AskAi {
  const label =
    subject.type === 'stone'
      ? 'Ask AI about this stone…'
      : subject.type === 'part'
        ? 'Ask AI about this part…'
        : 'Ask AI about this piece…'
  const hint = assistantHint(capabilities)
  return hint ? { label, hint } : { label }
}

/**
 * What "Ask AI" hands the assistant (`openAssistant`): the piece, what was right-clicked as the
 * selection (one stone of a field as `nodeId:index`, as the CAD workspace selects it), and a
 * draft to finish. A stone's draft starts the replacement the assistant makes with
 * design.replaceStone; a part or the piece gets no draft, so one already typed is kept.
 */
export function askAiRequest(subject: Subject): {
  pieceId: string
  selection: string[]
  draft?: string
} {
  if (subject.type === 'piece') return { pieceId: subject.pieceId, selection: [] }
  if (subject.type === 'part') return { pieceId: subject.pieceId, selection: [subject.nodeId] }
  const one = subject.instance !== undefined
  return {
    pieceId: subject.pieceId,
    selection: [one ? `${subject.nodeId}:${subject.instance}` : subject.nodeId],
    // A whole row, halo or pavé (clicked off any one stone) is about all its stones.
    draft:
      !one && (subject.count ?? 1) > 1 ? 'Replace these stones with ' : 'Replace this stone with ',
  }
}

/** Whether a cut is cut to more than one length : width (an oval, a pear; not a round). */
export const isFancy = (cut: keyof typeof GEM_CUTS): boolean =>
  GEM_CUTS[cut].lw.min !== GEM_CUTS[cut].lw.max
