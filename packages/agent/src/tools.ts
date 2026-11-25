/**
 * The assistant's tools, generated from the command registry: every command marked `tool` plus
 * the client tools a studio window runs. One global list, sorted by name and never varied by
 * role, piece or capability, so its bytes (which come first in every request) stay cacheable.
 * The gate decides what the caller may actually run; the list only says what exists.
 *
 * Tool names must match `^[a-zA-Z0-9_-]{1,64}$`, so the registry's dots become underscores. No
 * registry name contains an underscore, which makes the mapping a bijection (tested).
 */
import {
  type ClientToolName,
  COMMAND_NAMES,
  type CommandDef,
  clientTools,
  commands,
  isToolCommand,
  type ToolCommandName,
} from '@pave/schema'
import { z } from 'zod'

/** A command the assistant can call: a registry tool command or a client tool. */
export type AgentToolName = ToolCommandName | ClientToolName

type Registry = typeof commands & typeof clientTools
const registry: Registry = { ...commands, ...clientTools }

export type AgentToolInput<N extends AgentToolName> = z.output<Registry[N]['input']>
export type AgentToolOutput<N extends AgentToolName> = z.output<Registry[N]['output']>

/** A JSON Schema object as tools carry it. */
export type JsonSchema = { [key: string]: unknown }

export interface ToolDef {
  /** The name the model sees (`design_apply`). */
  name: string
  command: AgentToolName
  description: string
  input_schema: JsonSchema & { type: 'object' }
  /** Set only where the API's strict mode supports every keyword of the schema. */
  strict?: true
  kind: 'query' | 'mutation'
  /** Runs only after a person approves it. */
  confirm: boolean
  /** Runs in a studio window rather than on the server. */
  client: boolean
}

export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

export const toApiName = (command: AgentToolName): string => command.replaceAll('.', '_')

const clientNames = new Set<string>(Object.keys(clientTools))

/** Every tool command and client tool, in registry order. */
export const AGENT_TOOLS: readonly AgentToolName[] = [
  ...COMMAND_NAMES.filter(isToolCommand),
  ...(Object.keys(clientTools) as ClientToolName[]),
]

const byApiName = new Map<string, AgentToolName>(AGENT_TOOLS.map((c) => [toApiName(c), c]))

/** The command behind a tool name the model used, or null for a name that is not a tool. */
export const fromApiName = (name: string): AgentToolName | null => byApiName.get(name) ?? null

// ── JSON Schema for the model ────────────────────────────────────────────────────────────────

/** Standard keywords kept in tool schemas; field metadata for the inspector is dropped. */
const KEEP = new Set([
  'type',
  'properties',
  'required',
  'items',
  'prefixItems',
  'enum',
  'const',
  'anyOf',
  'oneOf',
  'allOf',
  'additionalProperties',
  'propertyNames',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'default',
  'description',
])

/** Keywords the API's strict tool mode accepts (structured outputs' supported subset). */
const STRICT_OK = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'const',
  'anyOf',
  'allOf',
  'additionalProperties',
  'description',
])

const UNITS: Record<string, string> = { mm: 'mm', deg: 'degrees', ct: 'carats', '%': 'percent' }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Keeps standard keywords, folds the useful field metadata (unit, node kinds) into the
 * description, and drops zod's ±2^53 integer bounds, which say nothing to the model.
 */
export function cleanSchema(js: unknown): unknown {
  if (Array.isArray(js)) return js.map(cleanSchema)
  if (!isObj(js)) return js
  const out: Record<string, unknown> = {}
  const notes: string[] = []
  if (typeof js.unit === 'string' && UNITS[js.unit]) notes.push(`in ${UNITS[js.unit]}`)
  if (Array.isArray(js.refKinds)) notes.push(`id of a ${js.refKinds.join(' / ')} node`)
  for (const [k, v] of Object.entries(js)) {
    if (!KEEP.has(k)) continue
    if ((k === 'minimum' || k === 'maximum') && Math.abs(v as number) >= Number.MAX_SAFE_INTEGER)
      continue
    if (k === 'properties' && isObj(v))
      out[k] = Object.fromEntries(Object.entries(v).map(([p, s]) => [p, cleanSchema(s)]))
    else if (k === 'default' || k === 'enum' || k === 'const' || k === 'required') out[k] = v
    else out[k] = cleanSchema(v)
  }
  const description = [js.description ?? (notes.length ? js.title : undefined), ...notes]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join('; ')
  if (description) out.description = description
  return out
}

/**
 * Whether strict mode can carry this schema unchanged: only supported keywords, every object
 * closed and fully required (no optional or defaulted fields), and no free-form records. Strict
 * schemas are compiled by the API, and an unsupported keyword is a 400 on every request, so
 * anything doubtful stays non-strict and is validated here instead (every tool input is).
 */
export function strictCompatible(js: unknown): boolean {
  if (Array.isArray(js)) return js.every(strictCompatible)
  if (!isObj(js)) return true
  for (const [k, v] of Object.entries(js)) {
    if (!STRICT_OK.has(k)) return false
    if (k === 'additionalProperties' && v !== false) return false
    if (k === 'properties') {
      if (!isObj(v)) return false
      const required = new Set((js.required as string[] | undefined) ?? [])
      if (Object.keys(v).some((p) => !required.has(p))) return false
      if (!Object.values(v).every(strictCompatible)) return false
    } else if (k !== 'enum' && k !== 'const' && k !== 'required' && !strictCompatible(v))
      return false
  }
  return true
}

/** Adds `additionalProperties: false` to every object schema that does not set it. */
function closeObjects(js: unknown): unknown {
  if (Array.isArray(js)) return js.map(closeObjects)
  if (!isObj(js)) return js
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(js)) {
    if (k === 'properties' && isObj(v))
      out[k] = Object.fromEntries(Object.entries(v).map(([p, s]) => [p, closeObjects(s)]))
    else if (k === 'enum' || k === 'const' || k === 'required') out[k] = v
    else out[k] = closeObjects(v)
  }
  if (out.type === 'object' && out.additionalProperties === undefined)
    out.additionalProperties = false
  return out
}

const CONFIRM_NOTE =
  ' Needs the designer’s approval: the run pauses on this call until they approve or decline it.'
const CLIENT_NOTE = ' Runs in the designer’s studio window.'

function toolDef(command: AgentToolName): ToolDef {
  const def: CommandDef = registry[command]
  const confirm = typeof def.tool === 'object' && def.tool.confirm
  const client = clientNames.has(command)
  const raw = z.toJSONSchema(def.input, { io: 'input' })
  const cleaned = cleanSchema(raw) as JsonSchema
  if (cleaned.type !== 'object')
    throw new Error(`Tool ${command}: input must be an object schema, got ${String(cleaned.type)}`)
  const hasFields = isObj(cleaned.properties) && Object.keys(cleaned.properties).length > 0
  const strict = hasFields && strictCompatible(cleaned)
  return {
    name: toApiName(command),
    command,
    description: def.description + (confirm ? CONFIRM_NOTE : '') + (client ? CLIENT_NOTE : ''),
    input_schema: (strict ? closeObjects(cleaned) : cleaned) as ToolDef['input_schema'],
    ...(strict ? { strict: true as const } : {}),
    kind: def.kind,
    confirm,
    client,
  }
}

let cached: readonly ToolDef[] | null = null

/**
 * The tool list, sorted by name with plain code-unit comparison (locale-independent), built once
 * per process. Every request and the MCP server use this same list.
 */
export function toolDefs(): readonly ToolDef[] {
  if (!cached)
    cached = Object.freeze(
      AGENT_TOOLS.map(toolDef).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    )
  return cached
}

export function toolFor(command: AgentToolName): ToolDef {
  const d = toolDefs().find((t) => t.command === command)
  if (!d) throw new Error(`Not a tool: ${command}`)
  return d
}

// ── Validating what the model sent ───────────────────────────────────────────────────────────

export type ParsedToolCall =
  | { ok: true; command: AgentToolName; def: ToolDef; input: unknown }
  | { ok: false; command: AgentToolName | null; error: string }

/**
 * Checks a tool call against its command's input schema before anything runs. Tool input
 * streams eagerly, so the API no longer validates it and the SDK's tolerant JSON parser can
 * hand back a silently truncated object: this check is what keeps a bad call from running.
 */
export function parseToolCall(name: string, input: unknown): ParsedToolCall {
  const command = fromApiName(name)
  if (!command) return { ok: false, command: null, error: `There is no tool named ${name}.` }
  const parsed = registry[command].input.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      command,
      error: `Invalid input for ${name}: ${z.prettifyError(parsed.error)}`,
    }
  return { ok: true, command, def: toolFor(command), input: parsed.data }
}
