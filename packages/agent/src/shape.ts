/**
 * Shapes what a tool returned into the `tool_result` the model reads, the same way for the
 * assistant's own loop and for MCP: big outputs are cut down, the stored inverse of a change is
 * dropped (the model never needs it), images an output points at are attached, and after a
 * design edit the evaluation and the canon's style findings are appended, so the model sees the
 * consequence of its edit without another call.
 */
import type {
  BetaImageBlockParam,
  BetaTextBlockParam,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'

/** About 10K tokens: a whole design document fits; a runaway list does not. */
export const MAX_RESULT_CHARS = 40_000

export interface ShapeImage {
  /** What it shows, for the model ("front, clay, version 7"). */
  label: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Base64, no data: prefix. */
  data: string
}

export interface ShapeInput {
  toolUseId: string
  output: unknown
  images?: readonly ShapeImage[]
  /** Text to add after the output: the evaluation after an edit, the canon after a spec. */
  notes?: readonly string[]
}

/** Drops `inverse` from any stored change in the output; it can be large and is never needed. */
function stripInverse(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripInverse)
  if (typeof v !== 'object' || v === null) return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) if (k !== 'inverse') out[k] = stripInverse(x)
  return out
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n… (cut: ${text.length - max} more characters. Ask for less, for example a narrower query or one piece at a time.)`
}

export function shapeResult(r: ShapeInput): BetaToolResultBlockParam {
  const text = r.output === undefined ? 'Done.' : JSON.stringify(stripInverse(r.output))
  const content: (BetaTextBlockParam | BetaImageBlockParam)[] = [
    { type: 'text', text: truncate(text, MAX_RESULT_CHARS) },
  ]
  for (const img of r.images ?? []) {
    content.push({ type: 'text', text: img.label })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    })
  }
  for (const n of r.notes ?? []) if (n) content.push({ type: 'text', text: n })
  return { type: 'tool_result', tool_use_id: r.toolUseId, content }
}

/** A failed or refused call, which the model reads and can correct. */
export function errorResult(toolUseId: string, message: string): BetaToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    is_error: true,
    content: [{ type: 'text', text: message }],
  }
}

/**
 * A call whose input did not validate: nothing ran. The raw input goes back JSON-encoded (with
 * the encoder, so its quotes are escaped), as the API's guidance for eagerly streamed input asks.
 */
export function invalidInputResult(
  toolUseId: string,
  input: unknown,
  error: string,
): BetaToolResultBlockParam {
  return errorResult(
    toolUseId,
    `${error}\nNothing was run. ${JSON.stringify({ INVALID_INPUT: JSON.stringify(input ?? null) })}`,
  )
}

/**
 * Closes a tool call the run will never answer (cancelled, failed, budget reached), so the
 * conversation stays valid: every tool_use must be followed by its tool_result.
 */
export function closedResult(toolUseId: string, reason: string): BetaToolResultBlockParam {
  return errorResult(toolUseId, `Not run: ${reason}`)
}

/** Facts of the design after a change, as the note appended to the edit's result. */
export interface EvaluationNote {
  metalMassG: number
  caratTotal: number
  stoneCount: number
  boundsMm: { x: number; y: number; z: number }
  diagnostics: readonly { level: string; code: string; message: string; nodeId?: string }[]
}

export interface StyleFinding {
  level: string
  code: string
  message: string
  nodeId?: string
  fix?: { label: string }
}

const n = (x: number, d = 2) => String(Number(x.toFixed(d)))

export function evaluationNote(e: EvaluationNote, findings: readonly StyleFinding[] = []): string {
  const lines = [
    `Evaluation: metal ${n(e.metalMassG)} g; ${e.stoneCount} stones, ${n(e.caratTotal)} ct; size ${n(e.boundsMm.x, 1)} × ${n(e.boundsMm.y, 1)} × ${n(e.boundsMm.z, 1)} mm.`,
  ]
  const where = (id?: string) => (id ? ` [${id}]` : '')
  if (e.diagnostics.length)
    lines.push(
      'Kernel diagnostics:',
      ...e.diagnostics.map((d) => `- ${d.level} ${d.code}${where(d.nodeId)}: ${d.message}`),
    )
  else lines.push('Kernel diagnostics: none.')
  if (findings.length)
    lines.push(
      'Canon style findings:',
      ...findings.map(
        (f) =>
          `- ${f.level} ${f.code}${where(f.nodeId)}: ${f.message}${f.fix ? ` (fix: ${f.fix.label})` : ''}`,
      ),
    )
  return lines.join('\n')
}
