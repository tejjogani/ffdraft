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
  resolveScene,
  type SceneAdjustment,
} from '@pave/render'
import { type BlenderRenderResult, type RuntimeOptions, renderWithBlender } from '@pave/render/node'
import { type RenderJob, type RenderScene, RenderSceneSchema } from '@pave/schema'
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
  workDir: string
  runtime: Pick<RuntimeOptions, 'blenderPath'>
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

export async function renderTake(o: TakeOptions): Promise<TakeResult> {
  let seconds = 0
  let pass = 0
  // `renderWithBlender` only reacts to an abort that comes after it has started its process, so
  // a cancel that lands between passes (or while one is being stored) must be caught here.
  const blend = async (scene: RenderScene, from: number, to: number) => {
    o.signal.throwIfAborted()
    const result = await renderWithBlender({
      ...o.runtime,
      resolved: resolveScene(scene, o.subject),
      glb: o.glb,
      outDir: join(o.workDir, `pass-${pass}`),
      signal: o.signal,
      timeoutMs: o.timeoutMs(scene),
      onProgress: (p) => o.onProgress(from + (to - from) * p),
    })
    seconds += result.seconds
    await o.onPass(pass++, result)
    o.signal.throwIfAborted()
    return result
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
    const issues = assessRender(draft.metrics, draftScene)
    const fixes = autoFixes(issues)
    const tuned = fixes.length ? RenderSceneSchema.safeParse(applyAdjustments(scene, fixes)) : null
    if (!tuned?.success && draftIsTake) {
      const assetId = await store(draft.files.image!, 'take')
      passes.push({ adjustments: [], issues, draftAssetId: null })
      return { scene, assetIds: [assetId], critique: { passes }, seconds, device: draft.device }
    }
    const draftAssetId = await store(draft.files.image!, 'draft')
    passes.push({ adjustments: tuned?.success ? fixes : [], issues, draftAssetId })
    if (tuned?.success) scene = tuned.data
  }

  const take = await blend(scene, o.autoTune ? 0.35 : 0, 0.95)
  passes.push({ adjustments: [], issues: assessRender(take.metrics, scene), draftAssetId: null })
  const outputs = take.files.image
    ? [take.files.image]
    : take.files.video
      ? [take.files.video]
      : (take.files.frames ?? [])
  const assetIds: string[] = []
  for (const path of outputs) assetIds.push(await store(path, 'take'))
  return { scene, assetIds, critique: { passes }, seconds, device: take.device }
}
