/**
 * What the assistant is told after it reads or changes shots: where each shot's camera stands
 * (preset shots resolved to the same pose the viewfinder and Blender use) and how much of the
 * frame the piece fills. With these numbers "move the camera a bit lower" is one scenes.update
 * with a new position, rather than guesswork about where a preset puts the camera.
 */
import { describePose, predictFraming, resolveScene } from '@pave/render'
import type { SavedScene } from '@pave/schema'
import type { Ctx } from '../context'
import { getPiece } from '../lookups'
import { serviceContext } from '../service-context'

/** More shots than this are listed without their cameras: the note stays short. */
const MAX_SHOTS = 8

export async function cameraNote(
  ctx: Ctx,
  pieceId: string | null,
  shots: readonly SavedScene[],
  signal?: AbortSignal,
): Promise<string | null> {
  if (!pieceId || shots.length === 0) return null
  const geometry = ctx.services.optional('geometry')
  if (!geometry?.subject) return null
  let subject: Awaited<ReturnType<NonNullable<typeof geometry.subject>>>
  try {
    const piece = await getPiece(ctx, pieceId)
    subject = await geometry.subject(piece.design, serviceContext(ctx), { pieceId, signal })
  } catch {
    // Framing is a courtesy; a piece the kernel cannot evaluate still has its shots.
    return null
  }
  const lines = shots.slice(0, MAX_SHOTS).map((shot) => {
    const resolved = resolveScene(shot.scene, subject)
    const c = resolved.camera
    const framing = predictFraming(
      c,
      resolved.output.width / resolved.output.height,
      subject.silhouette ?? [],
    )
    const kind =
      shot.scene.camera.preset === 'custom' ? 'custom camera' : `${shot.scene.camera.preset} preset`
    const lock = shot.scene.camera.locked ? ', locked' : ''
    return `- "${shot.title}" (${shot.id}, ${kind}${lock}): ${describePose(c)}; framing ${framing.label}.`
  })
  return ['Shot cameras (mm, Z up, front faces −Y):', ...lines].join('\n')
}
