import { type CommandDef, type CommandName, commands, minimumRole, roleAllows } from '@pave/schema'
import { z } from 'zod'
import { writeAudit } from '../audit'
import type { Ctx } from '../context'
import { AppError, badRequest, forbidden } from '../errors'
import { handlers } from '../handlers'

const idOf = (v: unknown, ...keys: string[]): string | null => {
  if (typeof v !== 'object' || v === null) return null
  for (const k of keys) {
    const x = (v as Record<string, unknown>)[k]
    if (typeof x === 'string') return x
  }
  return null
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** Postgres stores neither U+0000 nor half a surrogate pair, in text or in jsonb. */
export const storable = (text: string): boolean =>
  !text.includes('\u0000') && !LONE_SURROGATE.test(text)

/** Where in `value` a string (or key) is that the database cannot store; null when none is. */
function unstorableAt(value: unknown, path = ''): string | null {
  if (typeof value === 'string') return storable(value) ? null : path || 'the input'
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const found = unstorableAt(item, `${path}[${i}]`)
      if (found) return found
    }
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  for (const [key, item] of Object.entries(value)) {
    const at = path ? `${path}.${key}` : key
    const found = storable(key) ? unstorableAt(item, at) : `a key of ${path || 'the input'}`
    if (found) return found
  }
  return null
}

/**
 * The command pipeline shared by HTTP and in-process callers: role check → input validation →
 * handler → (dev/test) output validation → audit. Throws {@link AppError}s.
 */
export async function execute(
  name: CommandName,
  rawInput: unknown,
  ctx: Ctx,
  opts: { validateOutputs: boolean },
): Promise<unknown> {
  const def: CommandDef = commands[name]
  const need = minimumRole(name)
  if (!roleAllows(ctx.role, need))
    throw forbidden(`${name} needs the ${need} role; you are ${ctx.role}`)

  const parsed = def.input.safeParse(rawInput ?? {})
  if (!parsed.success) throw badRequest(z.prettifyError(parsed.error), parsed.error.issues)
  // Refused here, before the handler: such text fails some writes and not others, and the audit
  // row (which stores the whole input) is written last, after the change it records.
  const unstorable = unstorableAt(parsed.data)
  if (unstorable)
    throw badRequest(
      `Text cannot contain the NUL character or half of a surrogate pair (at ${unstorable})`,
    )

  // Indexing the handler table by a union name loses the input/output correlation; the registry
  // schemas above and below are what guarantee the shapes.
  const handler = handlers[name] as (ctx: Ctx, input: unknown) => Promise<unknown>
  const output = await handler(ctx, parsed.data)

  if (opts.validateOutputs) {
    const checked = def.output.safeParse(output)
    if (!checked.success)
      throw new AppError('internal', `${name} produced output that violates its contract`, {
        issues: checked.error.issues,
      })
  }

  if (def.kind === 'mutation')
    await writeAudit(ctx, {
      action: name,
      input: parsed.data,
      targetId: idOf(parsed.data, 'id', 'pieceId', 'boardId', 'runId') ?? idOf(output, 'id'),
    })
  return output
}
