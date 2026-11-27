/**
 * One Blender take: an optional preview draft that is measured (`assessRender`) and, when it
 * shows a framing or exposure problem the numbers can fix, adjusted once — then the take itself.
 * Bounded: at most two Blender passes per job, and the draft doubles as the take when it already
 * is what was asked for (a small preview still with nothing to fix).
 */
import { join } from 'node:path'
import {
  applyAdjustments,
  assessRender,
  draftOf,
  importedStationDetail,
  resolveScene,
  type SceneAdjustment,
  sceneHash,
} from '@pave/render'
import { type BlenderRenderResult, type RuntimeOptions, renderWithBlender } from '@pave/render/node'
import { type RenderJob, type RenderScene, RenderSceneSchema } from '@pave/schema'
import sharp from 'sharp'
import type { RenderSubject } from '../../services'

export type Critique = NonNullable<RenderJob['critique']>

/** What the automatic pass may change: framing and exposure. Quality and sparkle are a person's call. */
const AUTO_PATHS = new Set<SceneAdjustment['path']>([
  'camera.focalLength',
  'camera.preset',
  'environment.intensity',
])
export interface TakeOptions {
  /** What was asked for. */
  scene: RenderScene
  autoTune: boolean
  glb: Uint8Array
  subject: RenderSubject
  /** The piece and design version rendered: part of the take's scene hash. */
  design: { pieceId: string; version: number }
  workDir: string
  runtime: Pick<RuntimeOptions, 'blenderPath' | 'pythonPath'>
  signal: AbortSignal
  timeoutMs(scene: RenderScene): number
  onProgress(progress: number): void
  /** After each Blender pass (0, 1), e.g. to meter its seconds. */
  onPass(pass: number, result: BlenderRenderResult): Promise<void>
  /** Stores an output file; returns its asset id. */
  store(path: string, role: 'draft' | 'take'): Promise<string>
}

export interface TakeResult {
  /** What was rendered: the request after any automatic adjustment. */
  scene: RenderScene
  assetIds: string[]
  critique: Critique
  seconds: number
  device: string
  /** `sceneHash` of the resolved scene the take itself rendered. */
  sceneHash: string
}

/** One adjustment per path, from the most severe issue that proposes it. */
export function autoFixes(issues: ReturnType<typeof assessRender>): SceneAdjustment[] {
  const fixes = new Map<SceneAdjustment['path'], SceneAdjustment>()
  const ranked = issues.toSorted(
    (a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'),
  )
  for (const issue of ranked)
    for (const fix of issue.adjust)
      if (AUTO_PATHS.has(fix.path) && !fixes.has(fix.path)) fixes.set(fix.path, fix)
  return [...fixes.values()]
}

const sameScene = (a: RenderScene, b: RenderScene) => JSON.stringify(a) === JSON.stringify(b)

/** A GIF is a courtesy copy for places that will not play video: small, at most 15 fps. */
const GIF_LONG_SIDE = 360
const GIF_MAX_FPS = 15
const GIF_MAX_FRAMES = 240

/**
 * A looping GIF of the composited frames, made with sharp (already the server's image library,
 * so no new dependency), or null when there is nothing worth making or it fails: the MP4 is the
 * take, the GIF only rides along.
 */
export async function gifOf(frames: string[], fps: number, out: string): Promise<string | null> {
  const step = Math.max(1, Math.round(fps / GIF_MAX_FPS))
  const picked = frames.filter((_, i) => i % step === 0)
  if (picked.length < 2 || picked.length > GIF_MAX_FRAMES) return null
  try {
    const { width = 0, height = 0 } = await sharp(picked[0]).metadata()
    const k = Math.min(1, GIF_LONG_SIDE / Math.max(width, height, 1))
    const size = { width: Math.round(width * k), height: Math.round(height * k) }
    const pages = await Promise.all(
      picked.map((f) => sharp(f).resize(size).flatten({ background: '#ffffff' }).png().toBuffer()),
    )
    const delay = Math.round((1000 * step) / fps)
    await sharp(pages, { join: { animated: true } })
      .gif({ delay: pages.map(() => delay), loop: 0 })
      .toFile(out)
    return out
  } catch (err) {
    console.error('Making the take’s GIF failed (the video is unaffected):', err)
    return null
  }
}

export async function renderTake(o: TakeOptions): Promise<TakeResult> {
  let seconds = 0
  let pass = 0
  // `renderWithBlender` only reacts to an abort that comes after it has started its process, so
  // a cancel that lands between passes (or while one is being stored) must be caught here.
  const blend = async (scene: RenderScene, from: number, to: number) => {
    o.signal.throwIfAborted()
    const resolved = resolveScene(scene, o.subject)
    const result = await renderWithBlender({
      ...o.runtime,
      resolved,
      glb: o.glb,
      outDir: join(o.workDir, `pass-${pass}`),
      signal: o.signal,
      timeoutMs: o.timeoutMs(scene),
      onProgress: (p) => o.onProgress(from + (to - from) * p),
    })
    seconds += result.seconds
    await o.onPass(pass++, result)
    o.signal.throwIfAborted()
    return { ...result, hash: sceneHash(resolved, o.design) }
  }
  const store = async (path: string, role: 'draft' | 'take') => {
    const assetId = await o.store(path, role)
    o.signal.throwIfAborted()
    return assetId
  }

  const passes: Critique['passes'] = []
  let scene = o.scene
  if (o.autoTune) {
    const draftScene = draftOf(scene)
    const draftIsTake = sameScene(draftScene, scene)
    const draft = await blend(draftScene, 0, draftIsTake ? 0.95 : 0.35)
    const issues = assessRender(
      draft.metrics,
      draftScene,
      !!importedStationDetail(draftScene.camera, o.subject),
    )
    const fixes = autoFixes(issues)
    const tuned = fixes.length ? RenderSceneSchema.safeParse(applyAdjustments(scene, fixes)) : null
    if (!tuned?.success && draftIsTake) {
      const assetId = await store(draft.files.image!, 'take')
      passes.push({ adjustments: [], issues, draftAssetId: null })
      return {
        scene,
        assetIds: [assetId],
        critique: { passes },
        seconds,
        device: draft.device,
        sceneHash: draft.hash,
      }
    }
    const draftAssetId = await store(draft.files.image!, 'draft')
    passes.push({ adjustments: tuned?.success ? fixes : [], issues, draftAssetId })
    if (tuned?.success) scene = tuned.data
  }

  const take = await blend(scene, o.autoTune ? 0.35 : 0, 0.95)
  passes.push({
    adjustments: [],
    issues: assessRender(take.metrics, scene, !!importedStationDetail(scene.camera, o.subject)),
    draftAssetId: null,
  })
  const frames = take.files.frames ?? []
  // An animation: the video, its first frame as a poster, and a small GIF when it comes cheap.
  const outputs = take.files.image
    ? [take.files.image]
    : take.files.video
      ? [
          take.files.video,
          ...frames.slice(0, 1),
          ...[await gifOf(frames, scene.animation?.fps ?? 30, join(o.workDir, 'take.gif'))].filter(
            (g): g is string => g !== null,
          ),
        ]
      : frames
  const assetIds: string[] = []
  for (const path of outputs) assetIds.push(await store(path, 'take'))
  return {
    scene,
    assetIds,
    critique: { passes },
    seconds,
    device: take.device,
    sceneHash: take.hash,
  }
}
