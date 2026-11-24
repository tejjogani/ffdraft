/**
 * Waiting for render takes without holding a model call open. `renders.create` in a run queues a
 * take and returns at once; the step is stored as `waiting` with the take's id, and the run
 * suspends as `waiting` (no session, no stream, nothing billed). When the take settles, its
 * `job.updated` event wakes the run; the loop then reads the take and answers the call with what
 * came of it — the image itself, so the model can look at it — and the conversation goes on.
 *
 * The step rows are the truth: a restart, a missed event or a second window changes nothing,
 * because every wake re-reads the takes, and boot recovery nudges every waiting run once.
 */
import type { BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { errorResult, type ShapeImage, shapeResult } from '@pave/agent'
import { lookLabel, QUALITY_LABELS } from '@pave/render'
import type { RenderJob } from '@pave/schema'
import { readAsset } from '../assets/assets'
import type { Ctx } from '../context'
import { updateRender } from '../jobs'
import type { Runtime } from '../runtime'
import { isTerminal, publishJob } from '../service-context'
import { modelImage } from './images'

/** A browser take nobody's window rendered in this long is given up as failed. */
export const BROWSER_TAKE_EXPIRY_MS = 10 * 60_000

/** Who is waiting on a take: the run to wake, as whom. */
export interface Waiter {
  runId: string
  threadId: string
  orgId: string
  userId: string
}

/**
 * Takes the runs of this server wait on, and the wake-up when one settles. Filled by the loop
 * whenever it finds a step still waiting (so after a restart too), emptied as takes settle.
 */
export class TakeWaits {
  readonly #waiting = new Map<string, Waiter>()
  readonly #off: () => void

  constructor(runtime: Runtime, wake: (waiter: Waiter) => void) {
    this.#off = runtime.events.subscribeAll((orgId, event) => {
      if (event.type !== 'job.updated' || event.kind !== 'render' || !isTerminal(event.status))
        return
      const waiter = this.#waiting.get(event.id)
      if (!waiter || waiter.orgId !== orgId) return
      this.#waiting.delete(event.id)
      wake(waiter)
    })
  }

  register(takeId: string, waiter: Waiter): void {
    this.#waiting.set(takeId, waiter)
  }

  /** The takes a run waits on (tests). */
  of(runId: string): string[] {
    return [...this.#waiting].filter(([, w]) => w.runId === runId).map(([id]) => id)
  }

  dispose(): void {
    this.#off()
    this.#waiting.clear()
  }
}

/** The take a call waits for: what `renders.create` returned, while it is still live. */
export function waitFor(command: string, value: unknown): { kind: 'render'; id: string } | null {
  if (command !== 'renders.create') return null
  const job = value as Partial<RenderJob> | null
  if (!job?.id || isTerminal(job.status)) return null
  return { kind: 'render', id: job.id }
}

/**
 * A browser take nobody rendered (no Pavé window open, or one that could not draw) fails after
 * {@link BROWSER_TAKE_EXPIRY_MS}, so a run never waits on it for ever. Returns the take as it is
 * now.
 */
export async function expireBrowserTake(ctx: Ctx, take: RenderJob): Promise<RenderJob> {
  if (take.engine !== 'browser' || isTerminal(take.status)) return take
  if (Date.now() - Date.parse(take.createdAt) < BROWSER_TAKE_EXPIRY_MS) return take
  const row = await updateRender(ctx, take.id, {
    status: 'failed',
    error:
      'No Pavé window rendered this preview within 10 minutes. Keep Pavé open in a browser, or set up Blender for renders on this computer.',
  })
  if (row) publishJob(ctx, { kind: 'render', id: row.id, pieceId: row.pieceId }, row)
  return { ...take, status: 'failed', error: row?.error ?? take.error }
}

const plainIssue = (i: NonNullable<RenderJob['critique']>['passes'][number]['issues'][number]) =>
  `${i.severity} ${i.code}: ${i.message}`

/** What the automatic numeric pass found and changed, in a few lines. */
function autoTuneNote(take: RenderJob): string | null {
  const passes = take.critique?.passes ?? []
  if (!passes.length) return null
  const adjusted = passes.flatMap((p) => p.adjustments)
  const last = passes.at(-1)!
  const lines = [
    adjusted.length
      ? `Auto-tune adjusted the shot after a draft: ${adjusted.map((a) => `${a.path} → ${a.value}`).join(', ')}.`
      : 'Auto-tune measured a draft and changed nothing.',
    last.issues.length
      ? `Numeric checks on the take: ${last.issues.map(plainIssue).join('; ')}.`
      : 'Numeric checks on the take (framing, exposure, noise): no issues.',
  ]
  return lines.join('\n')
}

/**
 * The answer to a `renders.create` call once its take has settled: the take's facts, what the
 * numeric pass did, whether the design has moved on since, and the image for the model to
 * judge with its own eyes.
 */
export async function takeResult(
  ctx: Ctx,
  toolUseId: string,
  take: RenderJob,
  pieceVersion: number,
): Promise<{ result: BetaToolResultBlockParam; isError: boolean }> {
  if (take.status === 'canceled')
    return {
      result: errorResult(
        toolUseId,
        `Take ${take.id} was canceled by the designer before it finished. Do not render it again unless they ask.`,
      ),
      isError: true,
    }
  if (take.status === 'failed')
    return {
      result: errorResult(
        toolUseId,
        `Take ${take.id} failed: ${take.error ?? 'the render engine gave no reason'}.`,
      ),
      isError: true,
    }

  const s = take.scene
  const facts = {
    id: take.id,
    title: take.title,
    status: take.status,
    engine: take.engine,
    sceneId: take.sceneId,
    groupId: take.groupId,
    variantLabel: take.variantLabel,
    retryOf: take.retryOf,
    look: s.look,
    camera: s.camera,
    environment: s.environment,
    overrides: s.overrides,
    output: s.output,
    seconds: take.seconds,
    device: take.device,
    designVersion: take.sourceVersion,
  }
  const notes: string[] = [
    `Take ${take.id} ("${take.title}"): ${lookLabel(s.look)}, ${s.camera.preset} at ${s.camera.focalLength} mm, ${s.output.width}×${s.output.height} ${QUALITY_LABELS[s.output.quality]}${
      take.seconds
        ? `, ${Math.round(take.seconds)} s of machine time${take.device ? ` on ${take.device}` : ''}`
        : ''
    }.`,
  ]
  const tune = autoTuneNote(take)
  if (tune) notes.push(tune)
  if (take.engine === 'browser')
    notes.push(
      'Preview quality: this take was drawn in the browser because Blender is not set up on this computer. Judge framing, angle and form from it, not materials or sparkle, and say it is a preview when you show it.',
    )
  if (take.sourceVersion < pieceVersion)
    notes.push(
      `The design changed while this rendered (it shows version ${take.sourceVersion}; the piece is at ${pieceVersion}), so the take is stale. Re-render it if the change matters for the picture.`,
    )

  const images: ShapeImage[] = []
  const still = take.assetIds[0]
  if (still && !s.animation) {
    const { asset, bytes } = await readAsset(ctx, still)
    const image = await modelImage(bytes, asset.mime)
    if (image) images.push({ label: `Take ${take.id}: ${take.title}`, ...image })
  } else if (s.animation) {
    notes.push('This take is a video; you cannot watch it. Its frames are not attached.')
  }
  return {
    result: shapeResult({ toolUseId, output: facts, images, notes }),
    isError: false,
  }
}
