/**
 * Render feedback: what a person does after the assistant made a take or set up a shot, recorded
 * as implicit feedback on the assistant's run, so its shot choices can be judged and improved
 * later from the traces. The design's own feedback (an edit corrected or removed) is read from
 * the edit history by the assistant's FeedbackHook; renders have no such history for takes, so
 * the handlers that change takes and shots call in here as they act.
 *
 * Signals: a take kept (set as the cover, or swapped into the set), swapped out of the set,
 * starred or unstarred, deleted, rendered again by hand; a shot's camera moved (reframed), its
 * look, light, backdrop, materials or motion changed (restyled), deleted (removed) or rendered
 * again by hand. Only people's actions count; nothing here ever fails the command it rides on.
 */
import type { Actor, FeedbackKind, RenderScene } from '@pave/schema'
import { and, desc, eq } from 'drizzle-orm'
import type { Ctx } from './context'
import * as t from './db/schema'
import { createId } from './ids'

type AgentActor = Extract<Actor, { type: 'agent' }>

const asAgent = (a: Actor | null | undefined): AgentActor | null =>
  a && a.type === 'agent' ? a : null

export interface RenderSignal {
  /** The assistant's actor on the take or shot: its run, and the call that made it. */
  agent: AgentActor
  kind: FeedbackKind
  target: `render:${string}` | `scene:${string}`
  detail: string
}

/** Records the signal against the run (and its step, when the call is known). */
export async function recordRenderFeedback(ctx: Ctx, signal: RenderSignal): Promise<void> {
  if (ctx.actor.type !== 'user') return
  try {
    const step = signal.agent.toolCallId
      ? await ctx.repo.steps.first(
          and(
            eq(t.agentStep.runId, signal.agent.runId),
            eq(t.agentStep.toolCallId, signal.agent.toolCallId),
          )!,
        )
      : undefined
    // The run may be gone (deleted thread): feedback about nothing is dropped, not an error.
    const run = await ctx.repo.runs.first(eq(t.agentRun.id, signal.agent.runId))
    if (!run) return
    await ctx.repo.feedback.insert({
      id: createId('fb'),
      runId: signal.agent.runId,
      stepId: step?.id ?? null,
      source: 'implicit',
      kind: signal.kind,
      target: signal.target,
      note: signal.detail,
      userId: ctx.user.id,
    })
  } catch (err) {
    console.error('Recording render feedback failed:', err)
  }
}

/** The assistant behind a shot: its latest change to it, else the run that created it. */
export async function shotAgent(
  ctx: Ctx,
  scene: { id: string; actor?: Actor | null },
): Promise<AgentActor | null> {
  const changes = await ctx.repo.sceneChanges.many({
    where: eq(t.renderSceneChange.sceneId, scene.id),
    orderBy: desc(t.renderSceneChange.seq),
    limit: 50,
  })
  for (const c of changes) {
    const agent = asAgent(c.actor)
    if (agent) return agent
  }
  return asAgent(scene.actor)
}

/** The assistant behind a take, if an assistant made it. */
export const takeAgent = (take: { actor: Actor }): AgentActor | null => asAgent(take.actor)

const LOOK_KEYS = ['look', 'environment', 'ground', 'sparkle', 'overrides', 'animation', 'output']

/**
 * What a person's change to a shot says: its camera moved, its look changed, or both. A lock
 * alone says nothing about the framing (the person keeps it as it is).
 */
export function shotChangeKinds(before: RenderScene, after: RenderScene): FeedbackKind[] {
  const kinds: FeedbackKind[] = []
  const { locked: _a, ...cameraBefore } = before.camera
  const { locked: _b, ...cameraAfter } = after.camera
  if (JSON.stringify(cameraBefore) !== JSON.stringify(cameraAfter)) kinds.push('reframed')
  const changed = LOOK_KEYS.filter(
    (k) =>
      JSON.stringify((before as Record<string, unknown>)[k]) !==
      JSON.stringify((after as Record<string, unknown>)[k]),
  )
  if (changed.length) kinds.push('restyled')
  return kinds
}

/** A person changed a shot's scene: reframed and restyled, against the assistant behind it. */
export async function noteShotChange(
  ctx: Ctx,
  scene: { id: string; title: string; actor?: Actor | null },
  before: RenderScene,
  after: RenderScene,
): Promise<void> {
  if (ctx.actor.type !== 'user') return
  const kinds = shotChangeKinds(before, after)
  if (!kinds.length) return
  const agent = await shotAgent(ctx, scene)
  if (!agent) return
  for (const kind of kinds)
    await recordRenderFeedback(ctx, {
      agent,
      kind,
      target: `scene:${scene.id}`,
      detail:
        kind === 'reframed'
          ? `Moved the camera of “${scene.title}”, which the assistant set up.`
          : `Changed the look of “${scene.title}”, which the assistant set up.`,
    })
}
