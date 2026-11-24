/**
 * `match.fit`: fit a built piece's outline numbers to one photo. The photo is cut out with the
 * classical matte (a plain background is required, and refused honestly otherwise), the fit runs
 * in a kernel worker under a time budget and the caller's cancellation, and the answer is ops for
 * design.apply: the piece itself is never changed here, so a person's later edit cannot be lost
 * to a fit computed on an older version (the overlap gate sees the apply like any other edit).
 */
import { checkTarget, FIT_FLOOR, underFloor } from '@pave/match'
import { conflict, NotConfiguredError } from '../errors'
import { getPiece } from '../lookups'
import { photoMatte } from '../photos'
import { serviceContext } from '../service-context'
import type { HandlerGroup } from './types'

const round = (x: number) => Number(x.toFixed(3))

export const match: HandlerGroup<'match'> = {
  'match.fit': async (ctx, input) => {
    const geometry = ctx.services.get('geometry')
    if (!geometry.fitPhoto)
      throw new NotConfiguredError('geometry', 'This server cannot fit designs to photos.')
    const piece = await getPiece(ctx, input.pieceId)
    if (!Object.keys(piece.design.nodes).length)
      throw conflict('The piece has no design yet; build it from a spec first')
    const matte = await photoMatte(ctx, input.assetId)
    const started = Date.now()
    const empty = {
      overlap: null,
      version: piece.version,
      ops: [],
      params: [],
      camera: null,
      evaluations: 0,
      seconds: 0,
    }
    if (!matte.plain)
      return {
        ...empty,
        quality: 'failed' as const,
        reason: `${matte.reason} Compare the photo with a capture by eye instead.`,
        stopped: 'rejected' as const,
      }
    const bad = checkTarget({ id: 'photo', ...matte })
    if (bad)
      return {
        ...empty,
        quality: 'failed' as const,
        reason: bad.message,
        stopped: 'rejected' as const,
      }

    const out = await geometry.fitPhoto(
      piece.design,
      {
        fit: {
          matte: matte.matte,
          width: matte.width,
          height: matte.height,
          ...(input.view ? { view: input.view } : {}),
          budgetMs: input.seconds * 1000,
        },
        pieceId: piece.id,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      },
      serviceContext(ctx),
    )
    const r = out.result
    const score = r.scores.photo
    const why =
      r.quality === 'failed'
        ? r.diagnostics.map((d) => d.message).join(' ') || 'Nothing was fitted.'
        : r.quality === 'poor'
          ? `The recipe does not explain the photo's outline: ${score ? underFloor(score) : 'no score'}. The floor is an overlap of ${FIT_FLOOR.looseIou}. Do not apply these ops; compare by eye and say what differs.`
          : `The outlines agree (overlap ${score ? round(score.looseIou) : '?'}, floor ${FIT_FLOOR.looseIou}). Numbers marked assumed were not visible in the photo and keep the recipe's value.`
    return {
      quality: r.quality,
      reason: why,
      overlap: out.overlap === null ? null : round(out.overlap),
      version: piece.version,
      // Only a fit that explains the photo hands back edits to make.
      ops: r.quality === 'good' ? r.ops : [],
      params: out.params.map((p) => ({ ...p, from: round(p.from), to: round(p.to) })),
      camera: out.camera && {
        azimuth: round(out.camera.azimuth),
        elevation: round(out.camera.elevation),
      },
      stopped: r.stopped,
      evaluations: r.evaluations,
      seconds: round((Date.now() - started) / 1000),
    }
  },
}
