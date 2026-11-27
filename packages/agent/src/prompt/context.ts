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
  /** The saved Render view selected when this message was sent. */
  shot?: { id: string; title: string } | null
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
  /** Text and allowed image context from copied references on the active project board. */
  moodboard?: {
    count: number
    references: (ContextPin & {
      note: string
      url: string | null
      sourceBoardId: string
      sourceReferenceId: string
    })[]
  }
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

/**
 * Text that comes from the workspace (titles, names, file names, pasted pages, museum records)
 * rather than from the server, on one line and in quotes. This message carries operator
 * authority: a newline in a title must not start a line that reads as an instruction.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is stripped
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g
const flat = (s: string) => s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
const q = (s: string, n = 200) => JSON.stringify(clip(flat(s), n))

function pinLine(p: ContextPin, n: number): string {
  const terms = [p.provider, p.credit && clip(flat(p.credit), 160), p.license && flat(p.license)]
    .filter(Boolean)
    .join('; ')
  return `${n}. ${q(p.title || 'Untitled')} (id ${p.id}${terms ? `; ${terms}` : ''}; ${PIN_PICTURE[p.picture](p.assetId)})${p.plane ? `; laid in the ${p.plane} view as an image plane` : ''}`
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
        `${q(p.title)} (id ${p.id}; ${p.kind}${p.archetype ? `, ${p.archetype}` : ''}; stage ${p.stage}; design version ${p.version})`,
      ),
    )
    if (p.nodes?.length)
      out.push(
        line(
          'Nodes',
          p.nodes.map((n) => `${n.id} (${n.kind}${n.name ? ` ${q(n.name, 80)}` : ''})`).join(', '),
        ),
      )
    if (p.directions?.length)
      out.push(
        line(
          'Directions',
          p.directions
            .map((d) => `${d.letter} ${q(d.name, 80)} (id ${d.id}${d.chosen ? ', chosen' : ''})`)
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
                `${s.nodeId}${s.instance !== undefined ? ` stone ${s.instance + 1}` : ''} (${s.kind}${s.name ? ` ${q(s.name, 80)}` : ''})`,
            )
            .join(', ')
        : 'nothing',
    ),
  )
  if (c.shot) out.push(line('Open render shot', `${q(c.shot.title)} (id ${c.shot.id})`))
  if (c.board) out.push(line('Board', `${q(c.board.title)} (id ${c.board.id})`))
  if (c.attachments.length)
    out.push(
      line(
        'Attachments',
        c.attachments
          .map((a) => `${q(a.name, 120)} (asset ${a.assetId}, ${flat(a.mime)})`)
          .join(', '),
      ),
    )
  if (c.references.length)
    out.push(
      line(
        'References',
        c.references
          .map(
            (r) =>
              `${q(r.title)} (id ${r.id}${r.viewOnly ? ', view only: its details are known, its image is not shown' : ''})`,
          )
          .join(', '),
      ),
    )
  if (c.pins?.length)
    out.push(
      'Pinned references (the designer’s reference panel beside CAD, in their order):',
      ...c.pins.map((p, i) => pinLine(p, i + 1)),
    )
  if (c.moodboard?.references.length)
    out.push(
      `Imported moodboard references on this design board (${c.moodboard.references.length} of ${c.moodboard.count}):`,
      ...c.moodboard.references.map((r, i) => {
        const credit = r.credit ? `; credit ${q(r.credit, 160)}` : ''
        const license = r.license ? `; license ${q(r.license, 100)}` : ''
        const where = `source board ${r.sourceBoardId}, reference ${r.sourceReferenceId}`
        const picture = r.picture === 'none' ? '' : `; ${PIN_PICTURE[r.picture](r.assetId)}`
        const note = r.note ? `; note ${q(r.note, 1000)}` : ''
        const link = r.url ? `; link ${q(r.url, 400)}` : ''
        return `${i + 1}. ${q(r.title || 'Untitled')} (id ${r.id}; ${where}${credit}${license}${picture}${link}${note})`
      }),
    )
  if (c.designerEdits.length)
    out.push(
      'Edits by people since your last turn (build on them; do not undo them):',
      ...c.designerEdits.map((e) => `- v${e.seq} ${q(e.label)} (by ${q(e.by, 80)})`),
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
