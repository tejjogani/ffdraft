import { COMMAND_NAMES, clientTools, commands, isToolCommand } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { hash } from './hash'
import {
  AGENT_TOOLS,
  fromApiName,
  parseToolCall,
  strictCompatible,
  TOOL_NAME_PATTERN,
  toApiName,
  toolDefs,
} from './tools'

/** Keywords a tool's input schema may use: standard JSON Schema the API accepts. */
const ALLOWED = new Set([
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

/** Walks a schema's subschemas (not the values of `default`, `enum` or `const`). */
function* schemas(js: unknown, path = '$'): Generator<[string, Record<string, unknown>]> {
  if (Array.isArray(js)) {
    for (const [i, x] of js.entries()) yield* schemas(x, `${path}[${i}]`)
    return
  }
  if (typeof js !== 'object' || js === null) return
  const o = js as Record<string, unknown>
  yield [path, o]
  for (const [k, v] of Object.entries(o)) {
    if (k === 'default' || k === 'enum' || k === 'const' || k === 'required') continue
    if (k === 'properties' && v && typeof v === 'object')
      for (const [p, s] of Object.entries(v)) yield* schemas(s, `${path}.${p}`)
    else yield* schemas(v, `${path}.${k}`)
  }
}

describe('tool names', () => {
  it('maps every registry name to a valid API name and back (a bijection)', () => {
    for (const name of [...COMMAND_NAMES, ...Object.keys(clientTools)])
      expect(name, `${name} must not contain "_"`).not.toContain('_')
    const api = AGENT_TOOLS.map(toApiName)
    expect(new Set(api).size).toBe(AGENT_TOOLS.length)
    for (const [i, name] of api.entries()) {
      expect(name).toMatch(TOOL_NAME_PATTERN)
      expect(fromApiName(name)).toBe(AGENT_TOOLS[i])
    }
    expect(fromApiName('pieces.get')).toBeNull()
    expect(fromApiName('threads_send')).toBeNull()
  })

  it('offers exactly the tool commands and the client tools', () => {
    const expected = [
      ...COMMAND_NAMES.filter((n) => 'tool' in commands[n] && commands[n].tool !== undefined),
      ...Object.keys(clientTools),
    ].sort()
    expect([...AGENT_TOOLS].sort()).toEqual(expected)
    expect(
      toolDefs()
        .map((t) => t.command)
        .sort(),
    ).toEqual(expected)
  })

  it('never offers settings, keys, threads, approvals, attestation or usage', () => {
    for (const name of COMMAND_NAMES) {
      const forbidden =
        /^(org|session|threads|runs|client|traces|usage|assistant)\./.test(name) ||
        name === 'pieces.attest'
      if (forbidden) expect(isToolCommand(name), name).toBe(false)
    }
    for (const t of toolDefs()) expect(t.command).not.toMatch(/^(org|session|assistant|usage)\./)
  })
})

describe('tool schemas', () => {
  it('is an object schema the API accepts for every tool', () => {
    for (const t of toolDefs()) {
      expect(t.input_schema.type, t.name).toBe('object')
      expect(t.description.length, t.name).toBeGreaterThan(10)
      expect(t.name.length).toBeLessThanOrEqual(64)
      // Plain JSON: survives a round trip unchanged, no functions, no undefined.
      expect(JSON.parse(JSON.stringify(t.input_schema))).toEqual(t.input_schema)
      expect(t.input_schema).not.toHaveProperty('$schema')
      for (const [path, s] of schemas(t.input_schema)) {
        for (const k of Object.keys(s)) expect(ALLOWED.has(k), `${t.name} ${path}: ${k}`).toBe(true)
        // No references at all, so no reference cycles.
        expect(s, `${t.name} ${path}`).not.toHaveProperty('$ref')
        expect(s, `${t.name} ${path}`).not.toHaveProperty('$defs')
        if (typeof s.minimum === 'number')
          expect(Math.abs(s.minimum)).toBeLessThan(Number.MAX_SAFE_INTEGER)
      }
    }
  })

  it('marks strict only schemas the strict subset fully supports', () => {
    const strict = toolDefs().filter((t) => t.strict)
    expect(strict.length).toBeGreaterThan(0)
    for (const t of strict) {
      expect(strictCompatible(t.input_schema), t.name).toBe(true)
      for (const [, s] of schemas(t.input_schema))
        if (s.type === 'object') expect(s.additionalProperties, t.name).toBe(false)
    }
    // Schemas with records, ranges or defaults stay non-strict.
    const byName = new Map(toolDefs().map((t) => [t.command, t]))
    expect(byName.get('design.apply')?.strict).toBeUndefined()
    expect(byName.get('design.evaluate')?.strict).toBeUndefined()
    expect(byName.get('pieces.get')?.strict).toBe(true)
  })

  it('is sorted and stable (snapshot)', () => {
    const defs = toolDefs()
    const names = defs.map((t) => t.name)
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
    expect(toolDefs()).toBe(defs)
    expect({
      hash: hash(JSON.stringify(defs)),
      tools: defs.map(
        (t) =>
          `${t.name} ${t.kind}${t.confirm ? ' confirm' : ''}${t.strict ? ' strict' : ''}${t.client ? ' client' : ''}`,
      ),
    }).toMatchSnapshot()
  })

  it('folds units and node kinds into descriptions and drops inspector metadata', () => {
    const viewport = toolDefs().find((t) => t.command === 'viewport.capture')!
    const text = JSON.stringify(viewport.input_schema)
    expect(text).not.toMatch(/"(group|widget|step|advanced|when|refKinds|unit|title)"/)
    expect(viewport.client).toBe(true)
    expect(viewport.description).toContain('studio window')
    const build = toolDefs().find((t) => t.command === 'pieces.buildFromSpec')!
    expect(build.confirm).toBe(true)
    expect(build.description).toContain('approval')
  })
})

describe('parseToolCall', () => {
  it('accepts a valid call and applies defaults', () => {
    const r = parseToolCall('design_evaluate', { pieceId: 'pc_1' })
    expect(r).toMatchObject({ ok: true, command: 'design.evaluate', input: { detail: 'draft' } })
  })

  it('refuses an unknown name, a wrong type, a truncated object and a broken rule', () => {
    expect(parseToolCall('threads_send', {})).toMatchObject({ ok: false, command: null })
    const wrong = parseToolCall('pieces_get', { id: 42 })
    expect(wrong.ok).toBe(false)
    // What the SDK's tolerant parser returns for input cut off mid-way: the op list is missing.
    const truncated = parseToolCall('design_apply', { pieceId: 'pc_1', label: 'Widen the' })
    expect(truncated).toMatchObject({ ok: false, command: 'design.apply' })
    if (!truncated.ok) expect(truncated.error).toMatch(/ops/)
    const both = parseToolCall('design_revert', { pieceId: 'pc_1', seq: 3, runId: 'run_1' })
    expect(both.ok).toBe(false)
    if (!both.ok) expect(both.error).toMatch(/exactly one/)
  })
})
