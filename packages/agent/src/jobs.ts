/**
 * AI jobs: an assistant run with a stage, a one-sentence goal and a short plan a person sees
 * before it starts. A piece moves through three stages, Design, then CAD, then Render; each can
 * be done by hand or by a job, and a person watches the job and changes what it made.
 *
 * The plan is not written by the model. Each stage has a recipe: a few steps, each owning the
 * tools that do its work. The server moves the plan along as the run's tool calls start, so the
 * plan needs no cooperation from the prompt and reads the same in every window. A tool of an
 * earlier step after a later one has started (reading the piece again while checking it) is
 * that later step's work, so the plan never moves backwards.
 *
 * Pure: the server applies these to the run record; the studio only shows the result.
 */
import type { AiJob, JobStage, PlanStepState, Run } from '@pave/schema'
import type { AgentToolName } from './tools'

export interface JobStep {
  id: string
  label: string
  tools: readonly AgentToolName[]
}

export interface JobRecipe {
  stage: JobStage
  /** The stage's name on the piece's stepper. */
  label: string
  /** The stage's button that starts the job. */
  button: string
  /** The goal when the person gives none. */
  goal: string
  steps: readonly JobStep[]
}

export const JOB_RECIPES: Record<JobStage, JobRecipe> = {
  design: {
    stage: 'design',
    label: 'Design',
    button: 'Propose directions with AI',
    goal: 'Propose a few design directions from the brief and write the spec for the strongest one.',
    steps: [
      {
        id: 'brief',
        label: 'Read the brief, photos and references',
        tools: [
          'pieces.get',
          'boards.list',
          'boards.get',
          'references.search',
          'references.similar',
          'references.lineage',
          'freeform.analyze',
        ],
      },
      {
        id: 'directions',
        label: 'Propose directions',
        tools: ['references.generate', 'references.save', 'boards.create'],
      },
      { id: 'spec', label: 'Write the spec', tools: ['pieces.setSpec', 'pieces.update'] },
    ],
  },
  cad: {
    stage: 'cad',
    label: 'CAD',
    button: 'Make the CAD with AI',
    goal: 'Turn the brief and spec into a buildable CAD model, then check it.',
    steps: [
      {
        id: 'brief',
        label: 'Read the brief and the spec',
        tools: [
          'pieces.get',
          'boards.get',
          'references.search',
          'design.history',
          'freeform.analyze',
        ],
      },
      {
        id: 'spec',
        label: 'Settle the spec',
        tools: ['pieces.create', 'pieces.setSpec', 'pieces.update'],
      },
      {
        id: 'build',
        label: 'Build the CAD',
        tools: ['pieces.buildFromSpec', 'design.apply', 'design.revert'],
      },
      { id: 'check', label: 'Check weight, sizes and stones', tools: ['design.evaluate'] },
      {
        id: 'look',
        label: 'Look at it and fix what is off',
        tools: ['viewport.capture', 'viewport.select'],
      },
    ],
  },
  render: {
    stage: 'render',
    label: 'Render',
    button: 'Render with AI',
    goal: 'Render the piece in a few studio shots.',
    steps: [
      {
        id: 'setup',
        label: 'Set up the shots',
        tools: ['scenes.list', 'scenes.create', 'scenes.update'],
      },
      { id: 'render', label: 'Render the takes', tools: ['renders.create', 'shots.create'] },
      {
        id: 'review',
        label: 'Look over the takes',
        tools: ['renders.list', 'renders.get', 'shots.list', 'shots.get'],
      },
    ],
  },
}

type Plan = AiJob['plan']

const withStates = (plan: Plan, state: (step: Plan[number], i: number) => PlanStepState): Plan =>
  plan.map((s, i) => ({ ...s, state: state(s, i) }))

/** The first pending step starts; used when a job (or a continuation of one) begins. */
function startFirstPending(plan: Plan): Plan {
  const at = plan.findIndex((s) => s.state === 'pending')
  return at === -1 ? plan : withStates(plan, (s, i) => (i === at ? 'running' : s.state))
}

/** A new job for a stage: the recipe's plan, its first step under way. */
export function newJob(stage: JobStage, goal?: string, continues: string | null = null): AiJob {
  const recipe = JOB_RECIPES[stage]
  return {
    stage,
    goal: goal?.trim() || recipe.goal,
    plan: startFirstPending(
      recipe.steps.map((s) => ({ id: s.id, label: s.label, state: 'pending' as const })),
    ),
    continues,
    review: null,
    pausedBy: null,
  }
}

/** The step of the stage's recipe a tool belongs to, or -1. */
export function stepOfTool(stage: JobStage, tool: string): number {
  return JOB_RECIPES[stage].steps.findIndex((s) => (s.tools as readonly string[]).includes(tool))
}

/**
 * A tool call started: its step becomes the running one. Steps between the last one reached and
 * it are over: done if they had begun, skipped if not. Returns null when nothing changes.
 */
export function advanceJob(job: AiJob, tool: string): AiJob | null {
  const k = stepOfTool(job.stage, tool)
  if (k === -1 || k >= job.plan.length) return null
  const reached = job.plan.findLastIndex((s) => s.state !== 'pending')
  if (k < reached) return null
  if (job.plan[k]!.state === 'running') return null
  return {
    ...job,
    plan: withStates(job.plan, (s, i) => {
      if (i === k) return 'running'
      if (i < k && s.state === 'running') return 'done'
      if (i < k && s.state === 'pending') return 'skipped'
      return s.state
    }),
  }
}

/**
 * The run ended. Done: the running step is done, steps never reached were skipped, and the
 * outputs wait for review. Failed: the running step failed. Paused or stopped: it goes back to
 * pending, to be picked up by Resume.
 */
export function endJob(
  job: AiJob,
  status: Exclude<Run['status'], 'running' | 'awaiting-approval'>,
  pausedBy: AiJob['pausedBy'] = null,
): AiJob {
  const running: PlanStepState =
    status === 'done' ? 'done' : status === 'failed' ? 'failed' : 'pending'
  return {
    ...job,
    plan: withStates(job.plan, (s) =>
      s.state === 'running'
        ? running
        : status === 'done' && s.state === 'pending'
          ? 'skipped'
          : s.state,
    ),
    review: status === 'done' ? 'pending' : null,
    pausedBy: status === 'paused' ? (pausedBy ?? 'pause') : null,
  }
}

/**
 * The job carried on in a new run: what was done stays done, what was cut short is to do again,
 * and with `redoStepId` that step and every later one (they build on it) are done again.
 */
export function continueJob(
  job: AiJob,
  continues: string,
  redoStepId?: string,
): { job: AiJob; redo: Plan[number] | null } {
  const redoAt = redoStepId ? job.plan.findIndex((s) => s.id === redoStepId) : -1
  const plan = withStates(job.plan, (s, i) =>
    redoAt !== -1 && i >= redoAt
      ? 'pending'
      : s.state === 'running' || s.state === 'failed'
        ? 'pending'
        : s.state,
  )
  return {
    job: { ...job, plan: startFirstPending(plan), continues, review: null, pausedBy: null },
    redo: redoAt === -1 ? null : job.plan[redoAt]!,
  }
}

/** The message a job sends the assistant as the person's turn. */
export function jobMessage(
  job: AiJob,
  kind: { type: 'start' } | { type: 'resume' } | { type: 'redo'; step: string },
): string {
  const recipe = JOB_RECIPES[job.stage]
  const steps = job.plan.map((s, i) => `${i + 1}. ${s.label}`).join('\n')
  switch (kind.type) {
    case 'start':
      return `${recipe.label} job: ${job.goal}\n\nPlan:\n${steps}`
    case 'resume': {
      const left = job.plan.filter((s) => s.state === 'pending' || s.state === 'running')
      return `Resume the ${recipe.label} job: ${job.goal}\n\nI may have changed the piece since you stopped; start from the piece as it is now and keep my changes. ${
        left.length
          ? `Still to do: ${left.map((s) => s.label).join('; ')}.`
          : 'Check the result once more.'
      }`
    }
    case 'redo':
      return `Redo this step of the ${recipe.label} job, and what follows from it: ${kind.step}. Start from the piece as it is now and keep my changes.`
  }
}
