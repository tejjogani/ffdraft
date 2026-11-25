/**
 * Does a value conform to a JSON Schema? The small subset structured outputs use (types, enum,
 * const, properties, required, additionalProperties false, items, anyOf, allOf, local $ref), so the
 * fake can hold a response source to what the real API guarantees: a structured-output answer, or
 * the input of a strict tool call, always matches its schema.
 */

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

const typeOf = (v: unknown): string =>
  v === null
    ? 'null'
    : Array.isArray(v)
      ? 'array'
      : typeof v === 'number'
        ? Number.isInteger(v)
          ? 'integer'
          : 'number'
        : typeof v

const typeMatches = (v: unknown, t: string): boolean => {
  const actual = typeOf(v)
  return actual === t || (t === 'number' && actual === 'integer')
}

/** The first place `value` breaks `schema`, or null when it conforms. */
export function conformError(
  value: unknown,
  schema: unknown,
  root: unknown = schema,
  path = '$',
): string | null {
  if (!isObj(schema)) return null
  if (typeof schema.$ref === 'string') {
    const target = schema.$ref
      .replace(/^#\/?/, '')
      .split('/')
      .filter(Boolean)
      .reduce<unknown>((s, k) => (isObj(s) ? s[k] : undefined), root)
    return conformError(value, target, root, path)
  }
  if (Array.isArray(schema.anyOf)) {
    const errors = schema.anyOf.map((s) => conformError(value, s, root, path))
    if (errors.every((e) => e !== null)) return `${path}: matches none of anyOf (${errors[0]})`
  }
  if (Array.isArray(schema.allOf))
    for (const s of schema.allOf) {
      const e = conformError(value, s, root, path)
      if (e) return e
    }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string]
    if (!types.some((t) => typeMatches(value, t)))
      return `${path}: expected ${types.join('|')}, got ${typeOf(value)}`
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value))
    return `${path}: expected ${JSON.stringify(schema.const)}`
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))
  )
    return `${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`
  if (isObj(value)) {
    const props = isObj(schema.properties) ? schema.properties : {}
    for (const r of Array.isArray(schema.required) ? (schema.required as string[]) : [])
      if (!(r in value)) return `${path}: missing required property ${r}`
    for (const [k, v] of Object.entries(value)) {
      if (k in props) {
        const e = conformError(v, props[k], root, `${path}.${k}`)
        if (e) return e
      } else if (schema.additionalProperties === false) return `${path}: unexpected property ${k}`
      else if (isObj(schema.additionalProperties)) {
        const e = conformError(v, schema.additionalProperties, root, `${path}.${k}`)
        if (e) return e
      }
    }
  }
  if (Array.isArray(value) && schema.items !== undefined)
    for (let i = 0; i < value.length; i++) {
      const e = conformError(value[i], schema.items, root, `${path}[${i}]`)
      if (e) return e
    }
  return null
}
