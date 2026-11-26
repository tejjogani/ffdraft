import { link, lstat, mkdtemp, open, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  applyOps,
  type CommandInput,
  type CommandOutput,
  type Design,
  migrateDesign,
  type Op,
  PRONG_NUMBERS,
  type StoredChange,
  sameJson,
} from '@pave/schema'
import { z } from 'zod'

export type CadExamplesCall = <N extends 'org.settings.get' | 'pieces.get' | 'design.history'>(
  name: N,
  input: CommandInput<N>,
) => Promise<CommandOutput<N>>

const shankField = z.enum(['widthTop', 'widthBottom', 'thicknessTop', 'thicknessBottom'])
const prongNumber = z.enum(PRONG_NUMBERS)

const exampleFields = {
  schemaVersion: z.literal(1),
  beforeMm: z.number(),
  afterMm: z.number(),
  actor: z.enum(['user', 'agent', 'system']),
  undo: z.boolean(),
}
export const CadExampleSchema = z.discriminatedUnion('feature', [
  z.strictObject({
    ...exampleFields,
    feature: z.literal('ringShank'),
    field: shankField,
  }),
  z.strictObject({
    ...exampleFields,
    feature: z.literal('setting'),
    field: z.literal('prongTipOffsetsMm'),
    prong: z.number().int().min(1).max(PRONG_NUMBERS.length),
  }),
])
export type CadExample = z.infer<typeof CadExampleSchema>

async function requireEvaluationOptIn(call: CadExamplesCall) {
  if ((await call('org.settings.get', {})).allowEvalUse !== true)
    throw new Error(
      'CAD example export requires evaluation use to be enabled in Settings → Privacy.',
    )
}

function exampleOf(change: StoredChange, before: Design, after: Design): CadExample | undefined {
  const [op] = change.ops
  if (change.ops.length !== 1 || op?.t !== 'update') return
  const fields = Object.entries(op.patch)
  if (fields.length !== 1) return
  const [field, input] = fields[0]!
  const from = before.nodes[op.id]
  const to = after.nodes[op.id]
  const undo = Boolean(change.reverts?.length)
  const base = { schemaVersion: 1, actor: change.actor.type, undo }

  if (from?.kind === 'ringShank' && to?.kind === 'ringShank' && typeof input === 'number') {
    const parsed = shankField.safeParse(field)
    if (!parsed.success) return
    const beforeMm = from[parsed.data]
    const afterMm = to[parsed.data]
    if (beforeMm !== afterMm)
      return CadExampleSchema.parse({
        ...base,
        feature: 'ringShank',
        field: parsed.data,
        beforeMm,
        afterMm,
      })
  }

  if (from?.kind !== 'setting' || to?.kind !== 'setting' || field !== 'prongTipOffsetsMm') return
  const beforeOffsets = from.prongTipOffsetsMm ?? {}
  // Undoing the first offset can remove the container itself. One prior key and one reverted
  // change still identify the single prong. Other whole-map edits are outside this format.
  const offsets =
    input === null && change.reverts?.length === 1
      ? Object.entries(beforeOffsets)
      : input !== null && typeof input === 'object' && !Array.isArray(input)
        ? Object.entries(input)
        : []
  if (offsets.length !== 1) return
  const [key, value] = offsets[0]!
  const number = prongNumber.safeParse(key)
  if (!number.success || (value !== null && typeof value !== 'number')) return
  const beforeMm = beforeOffsets[number.data] ?? 0
  const afterMm = to.prongTipOffsetsMm?.[number.data] ?? 0
  if (beforeMm !== afterMm)
    return CadExampleSchema.parse({
      ...base,
      feature: 'setting',
      field,
      prong: Number(number.data),
      beforeMm,
      afterMm,
    })
}

/** Reconstruct each edit's immediate before and after states, newest to oldest. */
export async function* cadExamples(
  call: CadExamplesCall,
  pieceId: string,
  pageSize = 25,
): AsyncGenerator<CadExample> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200)
    throw new Error('CAD history page size must be between 1 and 200.')
  await requireEvaluationOptIn(call)
  const snapshot = await call('pieces.get', { id: pieceId })
  let after = migrateDesign(snapshot.design)
  let seq = snapshot.version
  while (seq > 0) {
    const page = await call('design.history', { pieceId, before: seq + 1, limit: pageSize })
    if (page.length === 0) throw new Error('CAD history is incomplete for this project.')
    for (const change of page) {
      if (seq < 1 || change.seq !== seq || change.pieceId !== pieceId)
        throw new Error('CAD history is incomplete for this project.')
      let before: Design
      try {
        before = applyOps(after, change.inverse as Op[]).design
        const replayed = applyOps(before, change.ops as Op[]).design
        if (!sameJson(replayed, after)) throw new Error('Incomplete inverse')
      } catch {
        throw new Error('Could not reconstruct CAD history for this project.')
      }
      const example = exampleOf(change, before, after)
      if (example) yield example
      after = before
      seq--
    }
  }
}

/** Stage a private file and publish it exclusively, after checking current consent again. */
export async function writeCadExamples(
  call: CadExamplesCall,
  pieceId: string,
  output: string,
): Promise<number> {
  const existing = await lstat(output).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err
  })
  if (existing) throw new Error('Choose a new output path. The output already exists.')
  const staging = await mkdtemp(join(dirname(output), '.pave-cad-examples-'))
  const temp = join(staging, 'examples.jsonl')
  try {
    const file = await open(temp, 'wx', 0o600)
    let count = 0
    try {
      for await (const example of cadExamples(call, pieceId)) {
        await file.writeFile(`${JSON.stringify(example)}\n`)
        count++
      }
    } finally {
      await file.close()
    }
    await requireEvaluationOptIn(call)
    // Both paths are on the same filesystem. link() never replaces an existing destination.
    await link(temp, output)
    return count
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
