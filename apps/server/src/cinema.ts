/**
 * The cinematographer's server side: what the assistant (or anyone) is told about a piece
 * before shots are set up (`scenes.suggest`), the look through each shot's exact camera before
 * render time is spent (`scenes.capture`), and the same framing check as a gate on the
 * assistant's own takes. The vocabulary and the maths are `@pave/render`'s cinema module; this
 * file only reads the piece and its kernel subject and draws the clay pictures.
 */
import {
  ASPECTS,
  type AspectKey,
  cinemaQuestions,
  pieceFeatures,
  placeShot,
  resolveScene,
  type SceneSubject,
  shotFraming,
  shotVocabulary,
} from '@pave/render'
import type { CommandOutput, CommandParsedInput, Piece, RenderScene } from '@pave/schema'
import { inArray } from 'drizzle-orm'
import { putAsset } from './assets/assets'
import type { Ctx } from './context'
import * as t from './db/schema'
import { badRequest } from './errors'
import { getPiece, getScene } from './lookups'
import { pngOf } from './photos'
import { assertSendable } from './references/rights'
import { serviceContext } from './service-context'

/** The kernel's subject for a piece (bounds, support points, stones), or null without one. */
export async function subjectOf(
  ctx: Ctx,
  piece: Pick<Piece, 'id' | 'design'>,
  signal?: AbortSignal,
  includeUnassignedRhino?: boolean,
): Promise<SceneSubject | null> {
  const geometry = ctx.services.optional('geometry')
  if (!geometry?.subject) return null
  return (await geometry.subject(piece.design, serviceContext(ctx), {
    pieceId: piece.id,
    ...(signal ? { signal } : {}),
    ...(includeUnassignedRhino && { includeUnassignedRhino }),
  })) as SceneSubject
}

/** A set can contain shots with and without imported previews. Evaluate each setting once. */
export async function subjectsOf(
  ctx: Ctx,
  piece: Pick<Piece, 'id' | 'design'>,
  scenes: readonly RenderScene[],
  signal?: AbortSignal,
) {
  const modes = new Set(scenes.map((scene) => scene.includeUnassignedRhino === true))
  const entries = await Promise.all(
    [...modes].map(async (mode) => [mode, await subjectOf(ctx, piece, signal, mode)] as const),
  )
  const subjects = new Map(entries)
  return (scene: RenderScene) => subjects.get(scene.includeUnassignedRhino === true) ?? null
}

export async function suggestShots(
  ctx: Ctx,
  input: CommandParsedInput<'scenes.suggest'>,
  signal?: AbortSignal,
): Promise<CommandOutput<'scenes.suggest'>> {
  const piece = await getPiece(ctx, input.pieceId)
  const subject = await subjectOf(ctx, piece, signal, input.includeUnassignedRhino).catch(
    () => null,
  )
  const features = pieceFeatures(piece.design, subject ?? undefined)
  const ratio = ASPECTS[input.aspect as AspectKey].ratio
  const hasStone = features.centreStoneNodeId !== null || (subject?.stones.length ?? 0) > 0
  const shots = shotVocabulary(piece.design.kind, hasStone).map((recipe) => {
    if (!subject)
      // Without a kernel the camera cannot be solved; the preset frames the piece when rendered.
      return {
        key: recipe.key,
        title: recipe.title,
        why: recipe.why,
        camera: { preset: recipe.basePreset, focalLength: recipe.focalLength },
        framing: 'not measured (no kernel)',
      }
    const camera = placeShot(recipe, subject, ratio, features.centreStoneNodeId)
    const check = shotFraming(sceneFor(camera, ratio), subject)
    return {
      key: recipe.key,
      title: recipe.title,
      why: recipe.why,
      camera,
      framing: `${check.framing.label}${check.subject === 'centre stone' ? ' (centre stone)' : ''}`,
    }
  })
  return {
    kind: piece.design.kind,
    features: features.lines,
    centreStoneNodeId: features.centreStoneNodeId,
    shots,
    questions: cinemaQuestions(features),
  }
}

/** A scene with only the camera and frame shape set: enough to measure framing. */
function sceneFor(camera: RenderScene['camera'], ratio: number): RenderScene {
  const width = ratio >= 1 ? 2000 : Math.round(2000 * ratio)
  const height = ratio >= 1 ? Math.round(2000 / ratio) : 2000
  return {
    look: 'catalog-white',
    camera,
    environment: { rotation: 0, intensity: 1, background: 'look' },
    ground: 'look',
    sparkle: 0.4,
    overrides: {},
    output: { width, height, quality: 'preview' },
  } as RenderScene
}

/** The rasteriser's camera for a resolved render camera: same orbit, span from the lens. */
function rasterCamera(c: ReturnType<typeof resolveScene>['camera']) {
  return {
    azimuth: c.azimuth,
    elevation: c.elevation,
    // The rasteriser turns its picture counter-clockwise; a render's roll turns it clockwise.
    roll: -c.roll,
    distance: c.distance,
    span: (c.distance * c.sensorWidth) / c.focalLength,
    shift: [0, 0] as [number, number],
    target: c.target,
  }
}

export async function captureShots(
  ctx: Ctx,
  input: CommandParsedInput<'scenes.capture'>,
  signal?: AbortSignal,
): Promise<CommandOutput<'scenes.capture'>> {
  const refs = await shotReferences(ctx, input)
  const saved = await Promise.all(input.ids.map((id) => getScene(ctx, id)))
  const pieceIds = new Set(saved.map((s) => s.pieceId))
  const pieceId = saved[0]?.pieceId
  if (!pieceId || pieceIds.size > 1)
    throw badRequest(
      'Capture shots of one piece at a time (house shots need a piece: copy one first)',
    )
  const piece = await getPiece(ctx, pieceId)
  const geometry = ctx.services.get('geometry')
  const subjectFor = await subjectsOf(
    ctx,
    piece,
    saved.map(({ scene }) => scene),
    signal,
  )
  const shots = saved.map((s) => {
    const subject = subjectFor(s.scene)
    const resolved = subject ? resolveScene(s.scene, subject) : null
    const { width, height } = s.scene.output
    const k = input.size / Math.max(width, height)
    return {
      saved: s,
      resolved,
      size: {
        width: Math.max(2, Math.round(width * k)),
        height: Math.max(2, Math.round(height * k)),
      },
      check: subject ? shotFraming(s.scene, subject) : null,
    }
  })
  let images: Uint8Array[] = []
  if (geometry.picture && shots.every((s) => s.resolved)) {
    const drawn = await geometry.picture(
      piece.design,
      {
        views: [],
        size: input.size,
        focus: [],
        shots: shots.map((s) => ({
          camera: rasterCamera(s.resolved!.camera),
          ...s.size,
          includeUnassignedRhino: s.saved.scene.includeUnassignedRhino,
        })),
        pieceId: piece.id,
        ...(signal ? { signal } : {}),
      },
      serviceContext(ctx),
    )
    images = drawn.images
  }
  const out = []
  for (const [i, s] of shots.entries()) {
    const rgba = images[i]
    const asset = rgba
      ? await putAsset(ctx, {
          bytes: await pngOf(rgba, s.size.width, s.size.height),
          name: `shot-${s.saved.id}-v${piece.version}.png`,
          kind: 'image',
        })
      : null
    out.push({
      id: s.saved.id,
      title: s.saved.title,
      assetId: asset?.id ?? null,
      subject: s.check?.subject ?? ('piece' as const),
      framing: s.check?.framing.label ?? 'not measured (no kernel)',
      ok: s.check?.ok ?? true,
      problem: s.check?.problem ?? null,
      referenceAssetId: refs.get(s.saved.id) ?? null,
    })
  }
  return { version: piece.version, shots: out }
}

/**
 * The shot reference named for each shot, checked: the shot is one being captured, the picture
 * is this organisation's, and it may be shown to a model (the loop puts it beside the capture
 * for the assistant to compare; a view-only picture never leaves).
 */
async function shotReferences(
  ctx: Ctx,
  input: CommandParsedInput<'scenes.capture'>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const r of input.references ?? []) {
    if (!input.ids.includes(r.id))
      throw badRequest(`Reference for ${r.id}: that shot is not one of the shots being captured`)
    out.set(r.id, r.assetId)
  }
  const assetIds = [...new Set(out.values())]
  if (!assetIds.length) return out
  const found = await ctx.repo.assets.many({ where: inArray(t.asset.id, assetIds) })
  const missing = assetIds.find((id) => !found.some((a) => a.id === id))
  if (missing) throw badRequest(`Shot reference ${missing} is not a picture in this studio`)
  const notImage = found.find((a) => !a.mime.startsWith('image/'))
  if (notImage) throw badRequest(`Shot reference ${notImage.id} is not a picture`)
  await assertSendable(ctx, assetIds, (id) => `Shot reference ${id}`)
  return out
}

/**
 * The gate before an assistant's take: a shot the framing check fails (the piece cut off or too
 * small; for a macro, the centre stone) is not rendered; the model is told what to fix. Null
 * when it may render (or when the piece cannot be measured: the gate never blocks blind).
 */
export async function framingRefusal(
  ctx: Ctx,
  input: { pieceId: string; sceneId?: string; scene?: RenderScene; title?: string },
  signal?: AbortSignal,
): Promise<string | null> {
  const saved = input.sceneId ? await getScene(ctx, input.sceneId).catch(() => null) : null
  const scene = input.scene ?? saved?.scene
  if (!scene) return null
  const piece = await getPiece(ctx, input.pieceId)
  const subject = await subjectOf(ctx, piece, signal, scene.includeUnassignedRhino).catch(
    () => null,
  )
  if (!subject) return null
  const check = shotFraming(scene, subject)
  if (check.ok) return null
  const name = input.title ?? saved?.title ?? 'this shot'
  return `Not rendered: in “${name}” ${check.problem} Fix the camera (scenes.update), check it with scenes.capture, then render.`
}
