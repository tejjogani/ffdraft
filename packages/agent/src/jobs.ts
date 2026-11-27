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
import type { AiJob, JobAnswer, JobStage, PlanStepState, QuickAnswers, Run } from '@pave/schema'
import type { AgentToolName } from './tools'

export interface JobStep {
  id: string
  label: string
  tools: readonly AgentToolName[]
  /**
   * A step the person usually takes after the run (choosing a direction): when the run ends it
   * stays to do instead of being marked not needed. The assistant still takes it when asked.
   */
  byPerson?: true
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
  /**
   * Calls that need approval elsewhere but run on their own in this job, because the plan the
   * person started showed them (the Render job's takes); at most `limit` per run.
   */
  approved?: { tools: readonly AgentToolName[]; limit: number }
}

export const JOB_RECIPES: Record<JobStage, JobRecipe> = {
  design: {
    stage: 'design',
    label: 'Design',
    button: 'Gather ideas with AI',
    goal: 'Read the brief and the design board, ask what the brief leaves open, draw on the references I’ve saved, and sharpen the brief so I can choose a picture to take to CAD.',
    steps: [
      {
        id: 'brief',
        label: 'Read the brief and the design board; ask what the brief leaves open',
        tools: ['pieces.get', 'boards.get', 'boards.list', 'references.pins', 'chat.ask'],
      },
      {
        id: 'gather',
        label: 'Review saved references and sharpen the brief',
        tools: [
          'boards.forPiece',
          'references.save',
          'references.similar',
          'references.lineage',
          'references.read',
          'references.brief',
          'references.estimate',
          'references.generate',
          'freeform.analyze',
          'pieces.update',
        ],
      },
      {
        id: 'pick',
        label: 'You pick a picture or sketch and take it to CAD',
        tools: [],
        byPerson: true,
      },
    ],
  },
  cad: {
    stage: 'cad',
    label: 'CAD',
    button: 'Make the CAD with AI',
    goal: 'Make production-ready CAD from the design (or a picture from the board, the brief or the spec): production detail, every check run and each warning fixed or explained, the size set, stones and seats checked, weight, carats and cost confirmed, and a short report.',
    steps: [
      {
        id: 'brief',
        label: 'Read the brief, the board and any picture; ask for the specs',
        tools: [
          'pieces.get',
          'references.pins',
          'chat.ask',
          'boards.forPiece',
          'boards.get',
          'references.search',
          'references.read',
          'design.history',
          'design.describe',
          'design.meshComponents',
          'match.traceOutline',
          'freeform.analyze',
        ],
      },
      {
        id: 'spec',
        label: 'Settle the spec and the size; show the estimate',
        tools: [
          'pieces.create',
          'pieces.setSpec',
          'pieces.estimate',
          'pieces.update',
          'pieces.chooseDirection',
        ],
      },
      {
        id: 'build',
        label: 'Build the CAD and its production detail',
        tools: ['pieces.buildFromSpec', 'design.apply', 'design.replaceStone', 'design.revert'],
      },
      {
        id: 'check',
        label: 'Run every check; fix or explain each warning',
        tools: ['design.evaluate'],
      },
      {
        id: 'look',
        label: 'Look at it, compare it with any photo, fix what is off',
        tools: ['viewport.capture', 'viewport.select', 'match.fit'],
      },
    ],
  },
  render: {
    stage: 'render',
    label: 'Render',
    button: 'Render with AI',
    goal: 'Look at the piece, ask me at most three quick questions, then place the cameras for a shot set and any animations, check the framing, render each take, look at it, re-render what falls short, and hand the set over for review.',
    steps: [
      {
        id: 'look',
        label: 'Look at the piece and any shot references; ask what the images are for',
        tools: ['pieces.get', 'references.pins', 'scenes.list', 'scenes.suggest', 'chat.ask'],
      },
      {
        id: 'setup',
        label: 'Place each camera and the look; check the framing',
        tools: [
          'scenes.create',
          'scenes.update',
          'scenes.revert',
          'scenes.capture',
          'renders.estimate',
        ],
      },
      {
        id: 'render',
        label: 'Render the stills and animations, look at each, re-render what falls short',
        tools: ['renders.create', 'renders.get', 'renders.list', 'viewport.capture'],
      },
      {
        id: 'review',
        label: 'You review the set: swap, star, choose the cover',
        tools: ['pieces.update'],
        byPerson: true,
      },
    ],
    // Starting the job approves the renders its plan describes; past that a person approves.
    approved: { tools: ['renders.create'], limit: 16 },
  },
}

/**
 * What "Try variants" in the CAD stage asks the assistant (not a job: variants are a side path
 * off the main one, and the variants skill takes it from there).
 */
export const VARIANTS_PROMPT =
  'Try variants of the current CAD: two to four alternatives, each taking one or two big decisions differently, built and checked, for me to compare.'

/** The goal of the CAD job "Take to CAD" starts from a design board's picture (a job goal: at most 300 characters). */
export const TAKE_TO_CAD_GOAL =
  'Make the CAD from this picture: ask me the specs first, show the estimate, then build it with the picture in its view.'

/** A Render job re-renders one shot at most this many times before leaving it to the person. */
export const MAX_RETAKES = 2

/**
 * Whether a call that normally needs a person's go-ahead runs on its own inside this job:
 * starting the job approved the work its plan shows, up to the recipe's limit (`used` is how
 * many such calls this run has made).
 */
export function jobApproves(job: AiJob | null, tool: string, used: number): boolean {
  const approved = job ? JOB_RECIPES[job.stage].approved : undefined
  return !!approved && (approved.tools as readonly string[]).includes(tool) && used < approved.limit
}

/** The machine time a Render job approves on its own when no Start popover gave one. */
export const DEFAULT_JOB_MACHINE_SECONDS = 30 * 60
/** The most a Render job approves on its own, whatever its popover said. */
export const MAX_JOB_MACHINE_SECONDS = 4 * 60 * 60
/** Room over the popover's estimate: a retake or one more shot of the same kind still fits. */
const MACHINE_SLACK = 1.5

/**
 * How much machine time (seconds, estimated) the takes a Render job approves on its own may add
 * up to, over every run of the job: the plan the person saw, with some room. A heavier take
 * (bigger, final quality, a long animation) asks, with its own estimate on the card.
 */
export function jobMachineBudget(job: AiJob): number {
  const seen = job.machineSeconds
  return Math.min(
    MAX_JOB_MACHINE_SECONDS,
    seen === null || seen === undefined ? DEFAULT_JOB_MACHINE_SECONDS : seen * MACHINE_SLACK,
  )
}

type Plan = AiJob['plan']

const withStates = (plan: Plan, state: (step: Plan[number], i: number) => PlanStepState): Plan =>
  plan.map((s, i) => ({ ...s, state: state(s, i) }))

/**
 * The first pending step starts; used when a job (or a continuation of one) begins. A person's
 * step is not started for them: it runs only when the assistant is asked to take it.
 */
function startFirstPending(stage: JobStage, plan: Plan): Plan {
  const steps = JOB_RECIPES[stage].steps
  const at = plan.findIndex(
    (s) => s.state === 'pending' && !steps.some((r) => r.id === s.id && r.byPerson),
  )
  return at === -1 ? plan : withStates(plan, (s, i) => (i === at ? 'running' : s.state))
}

/** A new job for a stage: the recipe's plan, its first step under way. */
export function newJob(stage: JobStage, goal?: string, continues: string | null = null): AiJob {
  const recipe = JOB_RECIPES[stage]
  return {
    stage,
    goal: goal?.trim() || recipe.goal,
    plan: startFirstPending(
      stage,
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
 * The run ended. Done: the running step is done, steps never reached were skipped (except
 * the person's own, which stay to do), and the outputs wait for review. Failed: the running step failed. Paused or stopped: it goes back to
 * pending, to be picked up by Resume.
 */
export function endJob(
  job: AiJob,
  status: Exclude<Run['status'], 'running' | 'awaiting-approval' | 'waiting'>,
  pausedBy: AiJob['pausedBy'] = null,
): AiJob {
  const running: PlanStepState =
    status === 'done' ? 'done' : status === 'failed' ? 'failed' : 'pending'
  const byPerson = (id: string) =>
    JOB_RECIPES[job.stage].steps.some((r) => r.id === id && r.byPerson)
  return {
    ...job,
    plan: withStates(job.plan, (s) =>
      s.state === 'running'
        ? running
        : status === 'done' && s.state === 'pending' && !byPerson(s.id)
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
    job: {
      ...job,
      plan: startFirstPending(job.stage, plan),
      continues,
      review: null,
      pausedBy: null,
    },
    redo: redoAt === -1 ? null : job.plan[redoAt]!,
  }
}

/**
 * The person answered the job's quick questions: the answers are kept under the step that
 * asked (the step chat.ask belongs to), replacing an earlier answer to the same question, so the
 * plan shows what was settled. Returns null when the job has no step that asks.
 */
export function recordAnswers(job: AiJob, answers: QuickAnswers): AiJob | null {
  const at = stepOfTool(job.stage, 'chat.ask')
  const stepId = at === -1 ? undefined : job.plan[at]?.id
  if (!stepId || !answers.answers.length) return null
  const fresh: JobAnswer[] = answers.answers.map((a) => ({
    stepId,
    id: a.id,
    question: a.question,
    answer: a.chosen.map((c) => c.label).join(', '),
    default: a.default,
  }))
  const kept = (job.answers ?? []).filter(
    (a) => !(a.stepId === stepId && fresh.some((f) => f.id === a.id)),
  )
  return { ...job, answers: [...kept, ...fresh] }
}

/** The answers as one line the model reads, or '' when there are none. */
export function answersLine(job: AiJob): string {
  const answers = job.answers ?? []
  if (!answers.length) return ''
  return `Already answered (do not ask again): ${answers.map((a) => `${a.question} ${a.answer}`).join('; ')}.`
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
      }${answersLine(job) ? ` ${answersLine(job)}` : ''}`
    }
    case 'redo':
      return `Redo this step of the ${recipe.label} job, and what follows from it: ${kind.step}. Start from the piece as it is now and keep my changes.${answersLine(job) ? ` ${answersLine(job)}` : ''}`
  }
}
