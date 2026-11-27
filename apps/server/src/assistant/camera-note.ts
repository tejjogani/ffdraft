/**
 * What the assistant is told after it reads or changes shots: where each shot's camera stands
 * (preset shots resolved to the same pose the viewfinder and Blender use) and how much of the
 * frame the piece fills. With these numbers "move the camera a bit lower" is one scenes.update
 * with a new position, rather than guesswork about where a preset puts the camera.
 */
import { describePose, predictFraming, resolveScene } from '@pave/render'
import type { SavedScene } from '@pave/schema'
import { subjectsOf } from '../cinema'
import type { Ctx } from '../context'
import { getPiece } from '../lookups'

/** More shots than this are listed without their cameras: the note stays short. */
const MAX_SHOTS = 8

export async function cameraNote(
  ctx: Ctx,
  pieceId: string | null,
  shots: readonly SavedScene[],
  signal?: AbortSignal,
): Promise<string | null> {
  if (!pieceId || shots.length === 0) return null
  const shown = shots.slice(0, MAX_SHOTS)
  let subjectFor: Awaited<ReturnType<typeof subjectsOf>>
  try {
    const piece = await getPiece(ctx, pieceId)
    subjectFor = await subjectsOf(
      ctx,
      piece,
      shown.map(({ scene }) => scene),
      signal,
    )
  } catch {
    // Framing is a courtesy; a piece the kernel cannot evaluate still has its shots.
    return null
  }
  const lines = shown.flatMap((shot) => {
    const subject = subjectFor(shot.scene)
    if (!subject) return []
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
  return lines.length ? ['Shot cameras (mm, Z up, front faces −Y):', ...lines].join('\n') : null
}
