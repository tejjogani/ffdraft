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
  importedStationDetail,
  pieceFeatures,
  placeShot,
  resolveScene,
  shotFraming,
  shotVocabulary,
  withImportedBodyDefaults,
} from '@pave/render'
import {
  type CommandOutput,
  type CommandParsedInput,
  isRhinoRoleBody,
  type Piece,
  type RenderScene,
  RenderSceneSchema,
} from '@pave/schema'
import { inArray } from 'drizzle-orm'
import { putAsset } from './assets/assets'
import type { Ctx } from './context'
import * as t from './db/schema'
import { badRequest } from './errors'
import { getPiece, getScene } from './lookups'
import { pngOf } from './photos'
import { assertSendable } from './references/rights'
import { serviceContext } from './service-context'
import type { RenderSubject } from './services'

type SubjectMode = Pick<RenderScene, 'includeUnassignedRhino' | 'pose'>

/** The kernel's subject for a piece (bounds, support points, stones), or null without one. */
export async function subjectOf(
  ctx: Ctx,
  piece: Pick<Piece, 'id' | 'design'>,
  signal?: AbortSignal,
  { includeUnassignedRhino, pose }: SubjectMode = {},
  asDesignedImports?: RenderSubject | null,
): Promise<RenderSubject | null> {
  if (includeUnassignedRhino && pose !== 'circular-band' && asDesignedImports)
    return asDesignedImports
  const geometry = ctx.services.optional('geometry')
  if (!geometry?.subject) return null
  return geometry.subject(piece.design, serviceContext(ctx), {
    pieceId: piece.id,
    ...(signal ? { signal } : {}),
    ...(includeUnassignedRhino && { includeUnassignedRhino }),
    ...(pose === 'circular-band' && { pose }),
  })
}

/** Includes every eligible imported body so defaults and render eligibility use the same geometry. */
export async function importedShotSubject(
  ctx: Ctx,
  piece: Pick<Piece, 'id' | 'design'>,
  signal = ctx.signal,
): Promise<RenderSubject | null> {
  if (!Object.values(piece.design.nodes).some(isRhinoRoleBody)) return null
  return subjectOf(ctx, piece, signal, { includeUnassignedRhino: true }).catch(() => null)
}

export function completeImportedShot(
  scene: RenderScene,
  subject: RenderSubject | null,
): RenderScene {
  const importOnly =
    !!subject &&
    subject.stones.length === 0 &&
    subject.parts.length > 0 &&
    subject.parts.every(({ importRole }) => importRole === 'unassigned')
  return withImportedBodyDefaults(scene, importOnly)
}

/** Evaluate each combination of jewelry pose and imported-body visibility once. */
export async function subjectsOf(
  ctx: Ctx,
  piece: Pick<Piece, 'id' | 'design'>,
  scenes: readonly RenderScene[],
  signal?: AbortSignal,
  asDesignedImports?: RenderSubject | null,
) {
  const keyOf = (scene: SubjectMode) =>
    `${scene.includeUnassignedRhino === true}:${scene.pose ?? 'as-designed'}`
  const modes = new Map(scenes.map((scene) => [keyOf(scene), scene]))
  const entries = await Promise.all(
    [...modes].map(
      async ([key, scene]) =>
        [key, await subjectOf(ctx, piece, signal, scene, asDesignedImports)] as const,
    ),
  )
  const subjects = new Map(entries)
  return (scene: RenderScene) => subjects.get(keyOf(scene)) ?? null
}

export async function suggestShots(
  ctx: Ctx,
  input: CommandParsedInput<'scenes.suggest'>,
  signal?: AbortSignal,
): Promise<CommandOutput<'scenes.suggest'>> {
  const piece = await getPiece(ctx, input.pieceId)
  const asDesignedImports = await importedShotSubject(ctx, piece, signal)
  const requested = completeImportedShot(RenderSceneSchema.parse(input), asDesignedImports)
  const { pose, includeUnassignedRhino, importedBodyLook } = requested
  const sceneOptions = {
    ...(pose && { pose }),
    ...(includeUnassignedRhino !== undefined && { includeUnassignedRhino }),
    ...(includeUnassignedRhino && { importedBodyLook: importedBodyLook ?? 'clay' }),
  } as const
  const subject = await subjectOf(ctx, piece, signal, requested, asDesignedImports).catch(
    () => null,
  )
  const circularBandDiameterMm = subject?.circularBandDiameterMm
  if (pose === 'circular-band' && subject && circularBandDiameterMm === undefined)
    throw badRequest(
      'Circular band needs a straight row of separate jewelry links. Choose the as-designed pose for this piece.',
    )
  const features = pieceFeatures(piece.design, subject ?? undefined)
  const ratio = ASPECTS[input.aspect as AspectKey].ratio
  const settingDetail =
    subject && importedStationDetail({ preset: 'hero', focalLength: 90 }, subject)
  const hasStone =
    features.centreStoneNodeId !== null || (subject?.stones.length ?? 0) > 0 || !!settingDetail
  const shots = shotVocabulary(piece.design.kind, hasStone, !!settingDetail).map((recipe) => {
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
      title:
        check.subject === 'setting detail'
          ? camera.preset === 'macro'
            ? 'Macro on the settings'
            : 'Hero setting detail'
          : recipe.title,
      why:
        check.subject === 'setting detail'
          ? 'Show the middle stones and the metalwork that holds them.'
          : recipe.why,
      camera,
      framing: `${check.framing.label}${check.subject === 'piece' ? '' : ` (${check.subject})`}`,
    }
  })
  return {
    kind: piece.design.kind,
    features: features.lines,
    centreStoneNodeId: features.centreStoneNodeId,
    ...(Object.keys(sceneOptions).length > 0 && { sceneOptions }),
    ...(circularBandDiameterMm !== undefined && { circularBandDiameterMm }),
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
  const imported = await importedShotSubject(ctx, piece, signal)
  const effective = saved.map((shot) => ({
    ...shot,
    scene: completeImportedShot(shot.scene, imported),
  }))
  const geometry = ctx.services.get('geometry')
  const subjectFor = await subjectsOf(
    ctx,
    piece,
    effective.map(({ scene }) => scene),
    signal,
    imported,
  )
  const shots = effective.map((s) => {
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
          pose: s.saved.scene.pose,
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
  const requested = input.scene ?? saved?.scene
  if (!requested) return null
  const piece = await getPiece(ctx, input.pieceId)
  const imported = await importedShotSubject(ctx, piece, signal)
  const scene = completeImportedShot(requested, imported)
  const subject = await subjectOf(ctx, piece, signal, scene, imported).catch(() => null)
  if (!subject) return null
  const check = shotFraming(scene, subject)
  if (check.ok) return null
  const name = input.title ?? saved?.title ?? 'this shot'
  return `Not rendered: in “${name}” ${check.problem} Fix the camera (scenes.update), check it with scenes.capture, then render.`
}
