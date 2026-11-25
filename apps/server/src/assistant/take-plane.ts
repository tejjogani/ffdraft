/**
 * After CAD is built from a pinned picture (Take to CAD), the picture lies in the matching CAD
 * view as an image plane, scaled so the piece in the picture is as wide as the built piece and
 * centred on it. The designer then models over it, nudges it, or fades it out.
 *
 * The scale comes from the picture's cut-out (the piece's outline against a plain background);
 * without a usable cut-out the picture is placed the way a person's drop places it, centred and
 * a little larger than the piece. A picture already in a view is left where the person put it.
 */
import type { ImagePlane, ImagePlaneView, PhotoView } from '@pave/schema'
import { and, desc, eq } from 'drizzle-orm'
import { type Ctx, invoke } from '../context'
import * as t from '../db/schema'
import { getPiece } from '../lookups'
import { photoMatte } from '../photos'
import { pinBoardOf } from '../references/pins'
import { serviceContext } from '../service-context'

type Vec3 = [number, number, number]

/** The latest photo the run read, and the angle the read saw it from; null when it read none. */
export async function lastReadOf(
  ctx: Ctx,
  runId: string,
): Promise<{ assetId: string; view: PhotoView } | null> {
  const step = await ctx.repo.steps.first(
    and(
      eq(t.agentStep.runId, runId),
      eq(t.agentStep.name, 'references.read'),
      eq(t.agentStep.status, 'done'),
      eq(t.agentStep.isError, false),
    ),
    desc(t.agentStep.idx),
  )
  const assetId = (step?.input as { assetIds?: string[] } | null)?.assetIds?.[0]
  const view = (step?.output as { value?: { read?: { view?: PhotoView } } } | null)?.value?.read
    ?.view
  return assetId && view ? { assetId, view } : null
}

/** Which CAD view a photo's angle lies in; angles with no flat view use the front. */
export const planeViewOf = (view: PhotoView): ImagePlaneView =>
  view === 'top' ? 'top' : view === 'side' ? 'right' : 'front'

/** A view's 2D axes, as in the studio's lib/image-planes.ts: front (x, z), top (x, y), right (y, z). */
const AXES: Record<ImagePlaneView, [0 | 1 | 2, 0 | 1 | 2]> = {
  front: [0, 2],
  top: [0, 1],
  right: [1, 2],
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** The bounding box of the matte's subject, in pixels; null when it is empty. */
function subjectBox(matte: Uint8Array, width: number, height: number) {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (matte[y * width + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  return x1 < x0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

/**
 * Where the picture goes: pure, so the test can check the arithmetic. `box` is the subject in
 * the picture's pixels (null without a cut-out); `bounds` the built piece's.
 */
export function fitPlane(
  view: ImagePlaneView,
  bounds: { min: Vec3; max: Vec3 },
  picture: { width: number; height: number },
  box: { x0: number; y0: number; x1: number; y1: number } | null,
): ImagePlane {
  const [ua, va] = AXES[view]
  const extentU = Math.max(bounds.max[ua] - bounds.min[ua], 0.5)
  const extentV = Math.max(bounds.max[va] - bounds.min[va], 0.5)
  const cu = (bounds.min[ua] + bounds.max[ua]) / 2
  const cv = (bounds.min[va] + bounds.max[va]) / 2
  const aspect = picture.height / picture.width
  if (!box) {
    const width = Math.max(extentU * 1.6, (extentV * 1.6) / Math.max(aspect, 1e-3))
    return {
      view,
      center: [round(cu), round(cv)],
      width: round(width),
      opacity: 0.6,
      locked: false,
    }
  }
  // The subject's width in the picture becomes the piece's width in this view.
  const width = Math.min(2000, Math.max(1, extentU / ((box.x1 - box.x0) / picture.width)))
  const heightMm = width * aspect
  // Move the picture so the subject's centre sits on the piece's centre (picture y runs down).
  const dx = ((box.x0 + box.x1) / 2 / picture.width - 0.5) * width
  const dy = -((box.y0 + box.y1) / 2 / picture.height - 0.5) * heightMm
  return {
    view,
    center: [round(cu - dx), round(cv - dy)],
    width: round(width),
    opacity: 0.6,
    locked: false,
  }
}

/**
 * Lays the piece's pin of `assetId` in the view the photo was taken from. Returns a sentence for
 * the model when it did, null when there was nothing to do (no such pin, already placed, no
 * geometry service that can say where the piece is).
 */
export async function placeTakePlane(
  ctx: Ctx,
  pieceId: string,
  read: { assetId: string; view: PhotoView },
  signal?: AbortSignal,
): Promise<string | null> {
  const board = await pinBoardOf(ctx, pieceId)
  if (!board) return null
  const pins = await ctx.repo.references.many({ where: eq(t.reference.boardId, board.id) })
  const pin = pins.find((r) => r.assetId === read.assetId && r.plane === null)
  if (!pin) return null
  const geometry = ctx.services.isConfigured('geometry') ? ctx.services.get('geometry') : null
  if (!geometry?.subject) return null
  const piece = await getPiece(ctx, pieceId)
  const subject = await geometry.subject(piece.design, serviceContext(ctx), {
    pieceId,
    ...(signal ? { signal } : {}),
  })
  const matte = await photoMatte(ctx, read.assetId).catch(() => null)
  const box = matte?.plain ? subjectBox(matte.matte, matte.width, matte.height) : null
  const view = planeViewOf(read.view)
  const plane = fitPlane(
    view,
    subject.bounds,
    matte ?? { width: pin.width ?? 1, height: pin.height ?? 1 },
    box,
  )
  await invoke(ctx, 'references.place', { id: pin.id, plane })
  return `The picture now lies in the ${view} view as an image plane${box ? ', scaled so the piece in it is as wide as the build' : ''}; the designer can model over it.`
}
