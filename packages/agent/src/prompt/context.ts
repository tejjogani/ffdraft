/**
 * The context message: what the studio looked like when the designer sent a message. It is
 * appended as a `role: "system"` message right after their message and never edited or removed
 * afterwards, so the conversation stays append-only (the prompt cache and the API's check on
 * replayed thinking both depend on that). The frozen system prompt never carries any of this.
 */
import { canonFor, renderCanonForPrompt } from '@pave/canon'
import type { Design, PieceSpec, PieceSpecInput } from '@pave/schema'

export interface ContextPiece {
  id: string
  title: string
  kind: string
  stage: string
  /** The design version the designer sees. */
  version: number
  archetype?: string | null
  /** Node ids in outliner order with their kind and name, so "the band" can be found. */
  nodes?: { id: string; kind: string; name?: string }[]
  /** The piece's design directions, oldest first; `chosen` marks the one its design came from. */
  directions?: { id: string; letter: string; name: string; chosen: boolean }[]
}

export interface ContextSelection {
  nodeId: string
  kind: string
  name?: string
  /** One stone inside a row, halo or pavé field (`nodeId:index`). */
  instance?: number
}

/** A reference pinned to the open piece, as the model is told about it. */
export interface ContextPin {
  id: string
  title: string
  /** Who has it and on what terms: provider, credit line, licence. */
  provider: string | null
  credit: string | null
  license: string | null
  /**
   * What the model can see of its picture: `above` (in the designer's message, labelled),
   * `earlier` (in an earlier message), `available` (not attached; its asset may be read),
   * `viewOnly` (details only, never the picture) or `none` (a link without a picture).
   */
  picture: 'above' | 'earlier' | 'available' | 'viewOnly' | 'none'
  assetId: string | null
  /** The CAD view it is laid in as an image plane, if any. */
  plane: string | null
}

export interface TurnContext {
  /** Today's date (YYYY-MM-DD), for anything time-dependent. */
  date: string
  piece: ContextPiece | null
  selection: ContextSelection[]
  board: { id: string; title: string } | null
  attachments: { assetId: string; name: string; mime: string }[]
  references: { id: string; title: string; viewOnly: boolean }[]
  /** Changes a person made to the piece since the assistant's last turn, oldest first. */
  designerEdits: { seq: number; label: string; by: string }[]
  /** The canon slice for the piece (`canonText`), when there is a piece. */
  canon: string | null
  /** The plan's allowances left this month (`allowanceLine`), so a job plans within them. */
  plan?: string | null
  /** Whether concept images can be generated, with which provider and at what price per image. */
  images?: string | null
  /** The open piece's pinned references, in the designer's order. */
  pins?: ContextPin[]
}

const PIN_PICTURE: Record<ContextPin['picture'], (assetId: string | null) => string> = {
  above: () => 'its picture is in the message above, labelled',
  earlier: (a) => `its picture was shown earlier in this conversation (asset ${a})`,
  available: (a) => `picture not attached; asset ${a} may be read with references.read`,
  viewOnly: () =>
    'view only: its details are known; its picture is never shown to you and cannot be read or fitted',
  none: () => 'a link without a picture',
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function pinLine(p: ContextPin, n: number): string {
  const terms = [p.provider, p.credit && clip(p.credit, 160), p.license].filter(Boolean).join('; ')
  return `${n}. “${p.title || 'Untitled'}” (id ${p.id}${terms ? `; ${terms}` : ''}; ${PIN_PICTURE[p.picture](p.assetId)})${p.plane ? `; laid in the ${p.plane} view as an image plane` : ''}`
}

const line = (label: string, value: string) => `${label}: ${value}`

/** Renders the context message. Deterministic for a given context. */
export function renderContext(c: TurnContext): string {
  const out = [
    'Context (the studio when the designer sent the message above).',
    line('Date', c.date),
  ]
  if (c.piece) {
    const p = c.piece
    out.push(
      line(
        'Open piece',
        `${p.title} (id ${p.id}; ${p.kind}${p.archetype ? `, ${p.archetype}` : ''}; stage ${p.stage}; design version ${p.version})`,
      ),
    )
    if (p.nodes?.length)
      out.push(
        line(
          'Nodes',
          p.nodes.map((n) => `${n.id} (${n.kind}${n.name ? ` "${n.name}"` : ''})`).join(', '),
        ),
      )
    if (p.directions?.length)
      out.push(
        line(
          'Directions',
          p.directions
            .map((d) => `${d.letter} "${d.name}" (id ${d.id}${d.chosen ? ', chosen' : ''})`)
            .join(', '),
        ),
      )
  } else out.push('Open piece: none')
  out.push(
    line(
      'Selection',
      c.selection.length
        ? c.selection
            .map(
              (s) =>
                `${s.nodeId}${s.instance !== undefined ? ` stone ${s.instance + 1}` : ''} (${s.kind}${s.name ? ` "${s.name}"` : ''})`,
            )
            .join(', ')
        : 'nothing',
    ),
  )
  if (c.board) out.push(line('Board', `${c.board.title} (id ${c.board.id})`))
  if (c.attachments.length)
    out.push(
      line(
        'Attachments',
        c.attachments.map((a) => `${a.name} (asset ${a.assetId}, ${a.mime})`).join(', '),
      ),
    )
  if (c.references.length)
    out.push(
      line(
        'References',
        c.references
          .map(
            (r) =>
              `${r.title} (id ${r.id}${r.viewOnly ? ', view only: its details are known, its image is not shown' : ''})`,
          )
          .join(', '),
      ),
    )
  if (c.pins?.length)
    out.push(
      'Pinned references (the designer’s reference panel beside CAD, in their order):',
      ...c.pins.map((p, i) => pinLine(p, i + 1)),
    )
  if (c.designerEdits.length)
    out.push(
      'Edits by people since your last turn (build on them; do not undo them):',
      ...c.designerEdits.map((e) => `- v${e.seq} ${e.label} (${e.by})`),
    )
  if (c.plan) out.push(line('Plan', c.plan))
  if (c.images) out.push(line('Image generation', c.images))
  if (c.canon) out.push('', c.canon)
  return out.join('\n')
}

/** Roughly 1.5K tokens: enough for the rules, one style and three exemplars. */
const CANON_BUDGET_TOKENS = 1500

/**
 * The canon slice for a piece: its rules with bands evaluated for this stone and size, the
 * matching style guides, exemplars and caveats. Null when the canon cannot read the piece; the
 * conversation then goes on without it rather than failing.
 */
export function canonText(piece: {
  spec?: PieceSpec | PieceSpecInput | null
  design?: Design | null
}): string | null {
  try {
    const slice = canonFor({
      ...(piece.spec ? { spec: piece.spec } : {}),
      ...(piece.design && Object.keys(piece.design.nodes).length ? { design: piece.design } : {}),
      budgetTokens: CANON_BUDGET_TOKENS,
    })
    return renderCanonForPrompt(slice)
  } catch {
    return null
  }
}
