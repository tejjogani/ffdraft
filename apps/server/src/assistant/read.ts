/**
 * `references.read`: the structured read of one to four photos, as a separate Claude call on the
 * conversation's tier (inside a run it is the run's own client, so the read is billed to the run
 * and a scripted run plays it from its fixture). It is metered on the `llm` meter like a turn, and
 * checked against the monthly budget first. The answer is validated before anything uses it;
 * then the code, not the model, turns it into a spec draft and says whether a cut-out works.
 */
import { type ModelClient, specQuestions } from '@pave/agent'
import { mapError, messageUsage, StreamAdapter } from '@pave/agent/anthropic'
import { buildReadRequest, parseReadMessage, ReadError, specFromRead } from '@pave/agent/photo'
import {
  type AssistantModelId,
  type CommandOutput,
  type CommandParsedInput,
  type JobStage,
  PieceSpecSchema,
  type Tokens,
} from '@pave/schema'
import { readAsset } from '../assets/assets'
import type { Ctx } from '../context'
import { AppError, badRequest } from '../errors'
import { photoMatte } from '../photos'
import { assertSendable } from '../references/rights'
import { assertBudget, recordUsage } from '../usage'
import { modelImage } from './images'

export interface ReadCall {
  ctx: Ctx
  client: ModelClient
  model: AssistantModelId
  input: CommandParsedInput<'references.read'>
  signal?: AbortSignal
  /** The ledger's idempotency key and attribution. */
  usage: { key: string; runId: string | null; pieceId: string | null; stage?: JobStage | null }
  /** Adds what the read cost to its run, on every path where tokens were billed. */
  spent?: (usage: { tokens: Tokens; costUsd: number }) => Promise<unknown>
}

export async function readPhotos(
  call: ReadCall,
): Promise<{ output: CommandOutput<'references.read'>; tokens: Tokens; costUsd: number }> {
  const { ctx, input } = call
  await assertBudget(ctx)
  await assertSendable(ctx, input.assetIds, (id) => `Photo ${input.assetIds.indexOf(id) + 1}`)
  const images = []
  for (const id of input.assetIds) {
    const { asset, bytes } = await readAsset(ctx, id)
    if (asset.kind !== 'image') throw badRequest(`${asset.name} is not a picture`)
    const image = await modelImage(bytes, asset.mime)
    if (!image)
      throw badRequest(`${asset.name} is a ${asset.mime} picture, which Claude cannot read`)
    images.push({ label: asset.name, ...image })
  }

  const params = buildReadRequest({
    model: call.model,
    images,
    ...(input.kindHint ? { kindHint: input.kindHint } : {}),
    ...(input.note ? { note: input.note } : {}),
  })
  const meter = async (usage: { model: string; tokens: Tokens; costUsd: number }) => {
    await recordUsage(ctx, {
      meter: 'llm',
      provider: 'anthropic',
      model: usage.model,
      quantity:
        usage.tokens.input + usage.tokens.output + usage.tokens.cacheRead + usage.tokens.cacheWrite,
      unit: 'tokens',
      costUsd: usage.costUsd,
      idempotencyKey: call.usage.key,
      runId: call.usage.runId,
      pieceId: call.usage.pieceId,
      stage: call.usage.stage ?? null,
    })
    await call.spent?.(usage)
  }
  let message: Awaited<ReturnType<ReturnType<ModelClient['stream']>['finalMessage']>>
  const adapter = new StreamAdapter()
  try {
    const stream = call.client.stream(params, call.signal ? { signal: call.signal } : {})
    for await (const event of stream) adapter.push(event)
    message = await stream.finalMessage()
  } catch (err) {
    // A read that broke off or was stopped is still billed for what the API had streamed.
    const partial = adapter.partialUsage()
    if (partial) await meter(partial)
    if (call.signal?.aborted) throw call.signal.reason
    // Typed SDK errors become the same plain sentences a turn would show.
    throw new AppError('conflict', mapError(err, { model: call.model }).message)
  }

  // Billed whether or not the answer is usable: the tokens were spent.
  const usage = messageUsage(message)
  await meter({ model: message.model, ...usage })

  let read: ReturnType<typeof parseReadMessage>
  try {
    read = parseReadMessage(message)
  } catch (err) {
    if (err instanceof ReadError) throw new AppError('conflict', err.message)
    throw err
  }
  const { spec, assumed } = specFromRead(read)
  const specDraft = PieceSpecSchema.parse(spec)
  let cutout: { ok: boolean; reason: string }
  try {
    const matte = await photoMatte(ctx, input.assetIds[0]!)
    cutout = { ok: matte.plain, reason: matte.reason }
  } catch (err) {
    cutout = { ok: false, reason: `The photo could not be decoded for a cut-out: ${String(err)}` }
  }
  return {
    output: {
      read,
      specDraft,
      assumed,
      cutout,
      questions: specQuestions(specDraft),
      model: message.model,
    },
    tokens: usage.tokens,
    costUsd: usage.costUsd,
  }
}
