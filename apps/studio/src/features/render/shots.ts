/**
 * The Render tab's model, pure so its rules are tested without a browser:
 *
 *  - the shot list is the piece's saved shots, or (before anything is saved) the default set
 *    for its kind; opening the tab writes nothing, the first edit or render saves the set;
 *  - each shot's takes, newest first, and the one in the set (the person's pick, else the
 *    newest finished take);
 *  - how long a running take has left, from its progress and the estimate.
 */
import { DEFAULT_SHOTS } from '@pave/render'
import {
  type PieceKind,
  type RenderJob,
  type RenderScene,
  RenderSceneSchema,
  type SavedScene,
} from '@pave/schema'

export interface Shot {
  /** The saved shot's id, or the default's key while nothing is saved. */
  key: string
  title: string
  scene: RenderScene
  saved: SavedScene | null
}

export function shotList(saved: readonly SavedScene[] | undefined, kind: PieceKind): Shot[] {
  if (saved?.length)
    return saved.map((s) => ({ key: s.id, title: s.title, scene: s.scene, saved: s }))
  return DEFAULT_SHOTS(kind).map((d) => ({
    key: d.key,
    title: d.title,
    scene: RenderSceneSchema.parse(d.scene),
    saved: null,
  }))
}

const newestFirst = (a: RenderJob, b: RenderJob) => b.createdAt.localeCompare(a.createdAt)

/** A shot's takes, newest first. A default shot has none (takes always come from a saved one). */
export function takesOf(shot: Shot, takes: readonly RenderJob[] | undefined): RenderJob[] {
  if (!shot.saved || !takes) return []
  return takes.filter((t) => t.sceneId === shot.saved!.id).sort(newestFirst)
}

/** The take a shot shows in the set: the person's pick while it is finished, else the newest. */
export function pickOf(shot: Shot, takes: readonly RenderJob[]): RenderJob | null {
  const done = takes.filter((t) => t.status === 'done' && t.assetIds.length > 0)
  const picked = shot.saved?.takeId ? done.find((t) => t.id === shot.saved!.takeId) : undefined
  return picked ?? done.sort(newestFirst)[0] ?? null
}

export const isLive = (t: Pick<RenderJob, 'status'>) =>
  t.status === 'queued' || t.status === 'running'

/**
 * Seconds a take has left. While it has barely started the estimate stands; after that the
 * pace so far is the better guide (it already knows this machine and this piece).
 */
export function secondsLeft(
  take: Pick<RenderJob, 'status' | 'progress' | 'createdAt'>,
  estimate: number | null,
  now = Date.now(),
): number | null {
  if (!isLive(take)) return null
  const p = take.progress
  if (take.status === 'running' && p > 0.08) {
    const elapsed = (now - Date.parse(take.createdAt)) / 1000
    return Math.max(1, (elapsed * (1 - p)) / p)
  }
  return estimate === null ? null : Math.max(1, estimate * (1 - p))
}

/** A take's label in the strip: its variant, else its retake note, else the shot's title. */
export function takeLabel(take: RenderJob): string {
  if (take.variantLabel) return take.variantLabel
  if (take.retryOf && take.note) return take.note
  return take.title
}

/** Whether a take was the assistant's. */
export const byAssistant = (take: Pick<RenderJob, 'actor'>) => take.actor.type === 'agent'

/**
 * A take's files by role. A still: its image. An animation: the video first, then its poster
 * (the first frame) and, when one was made, a GIF (see RenderJob.assetIds). A browser take of
 * an animation is refused, so every animation take with files came from Blender.
 */
export function takeMedia(take: Pick<RenderJob, 'scene' | 'assetIds'>): {
  /** A picture to show or use as a cover: the still, or the animation's poster. */
  still: string | null
  video: string | null
  gif: string | null
} {
  if (!take.scene.animation) return { still: take.assetIds[0] ?? null, video: null, gif: null }
  return {
    video: take.assetIds[0] ?? null,
    still: take.assetIds[1] ?? null,
    gif: take.assetIds[2] ?? null,
  }
}

/** "360° turntable · 6 s" for an animation take; null for a still. */
export function motionLabel(take: Pick<RenderJob, 'scene'>): string | null {
  const a = take.scene.animation
  if (!a) return null
  const names: Record<string, string> = {
    turntable: '360° turntable',
    'half-orbit': 'Half orbit',
    'push-in': 'Push-in',
    'macro-sweep': 'Macro sweep',
    'light-sweep': 'Sparkle pass',
    'orbit-arc': 'Short arc',
    'rack-focus': 'Rack focus',
  }
  return `${names[a.type] ?? a.type} · ${a.seconds} s`
}
