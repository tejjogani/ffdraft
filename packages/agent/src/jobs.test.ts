import { JOB_STAGES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import {
  advanceJob,
  continueJob,
  endJob,
  JOB_RECIPES,
  jobMessage,
  newJob,
  stepOfTool,
} from './jobs'
import { toolDefs } from './tools'

const states = (job: { plan: { state: string }[] }) => job.plan.map((s) => s.state)

describe('AI job plans', () => {
  it('names only real tools, each in at most one step of a stage', () => {
    const names = new Set(toolDefs().map((t) => t.command))
    for (const stage of JOB_STAGES) {
      const seen = new Set<string>()
      for (const step of JOB_RECIPES[stage].steps)
        for (const tool of step.tools) {
          expect(names.has(tool), `${stage}/${step.id}: ${tool}`).toBe(true)
          expect(seen.has(tool), `${stage}: ${tool} twice`).toBe(false)
          seen.add(tool)
        }
    }
  })

  it('starts on the first step with the recipe goal', () => {
    const job = newJob('cad')
    expect(job.goal).toBe(JOB_RECIPES.cad.goal)
    expect(states(job)).toEqual(['running', 'pending', 'pending', 'pending', 'pending'])
    expect(newJob('cad', '  A thinner band  ').goal).toBe('A thinner band')
  })

  it('moves forward with tool calls, skipping steps never begun, never backwards', () => {
    let job = newJob('cad')
    job = advanceJob(job, 'pieces.buildFromSpec')!
    expect(states(job)).toEqual(['done', 'skipped', 'running', 'pending', 'pending'])
    // Reading the piece again is the build step's work.
    expect(advanceJob(job, 'pieces.get')).toBeNull()
    // Another call of the running step changes nothing.
    expect(advanceJob(job, 'design.apply')).toBeNull()
    // A tool no step owns changes nothing.
    expect(advanceJob(job, 'collections.list')).toBeNull()
    job = advanceJob(job, 'viewport.capture')!
    expect(states(job)).toEqual(['done', 'skipped', 'done', 'skipped', 'running'])
    expect(stepOfTool('cad', 'design.evaluate')).toBe(3)
  })

  it('ends by status', () => {
    const job = advanceJob(newJob('cad'), 'design.apply')!
    const done = endJob(job, 'done')
    expect(states(done)).toEqual(['done', 'skipped', 'done', 'skipped', 'skipped'])
    expect(done.review).toBe('pending')
    expect(states(endJob(job, 'failed'))).toEqual([
      'done',
      'skipped',
      'failed',
      'pending',
      'pending',
    ])
    const paused = endJob(job, 'paused', 'edit')
    expect(states(paused)).toEqual(['done', 'skipped', 'pending', 'pending', 'pending'])
    expect(paused.pausedBy).toBe('edit')
    expect(paused.review).toBeNull()
  })

  it('carries on from where it stopped, or redoes a step and what follows', () => {
    const paused = endJob(advanceJob(newJob('cad'), 'design.apply')!, 'paused', 'edit')
    const resumed = continueJob(paused, 'run_1')
    expect(states(resumed.job)).toEqual(['done', 'skipped', 'running', 'pending', 'pending'])
    expect(resumed.job.continues).toBe('run_1')
    expect(resumed.job.pausedBy).toBeNull()
    expect(resumed.redo).toBeNull()

    const finished = endJob(advanceJob(newJob('cad'), 'viewport.capture')!, 'done')
    const redo = continueJob(finished, 'run_2', 'build')
    expect(states(redo.job)).toEqual(['done', 'skipped', 'running', 'pending', 'pending'])
    expect(redo.redo?.label).toBe('Build the CAD and its production detail')
    expect(redo.job.review).toBeNull()
  })

  it('writes the person’s turn for each way a job starts', () => {
    const job = newJob('render')
    expect(jobMessage(job, { type: 'start' })).toContain('Render job: Render the piece')
    expect(jobMessage(job, { type: 'start' })).toContain('1. Set up the shots')
    expect(jobMessage(job, { type: 'resume' })).toContain('keep my changes')
    expect(jobMessage(job, { type: 'resume' })).toContain('Still to do: Set up the shots; Render')
    expect(jobMessage(job, { type: 'redo', step: 'Render the takes' })).toContain(
      'Render the takes',
    )
  })

  it('leaves the person’s step (choosing a direction) to them, unless the assistant is asked', () => {
    let job = newJob('design')
    job = advanceJob(job, 'pieces.get') ?? job
    job = advanceJob(job, 'pieces.proposeDirections')!
    const proposed = endJob(job, 'done')
    expect(states(proposed)).toEqual(['done', 'done', 'pending'])
    expect(proposed.review).toBe('pending')

    // A mix asked for by chat: the directions step runs again; the choice is still theirs.
    let mix = continueJob(proposed, 'run_2').job
    expect(states(mix)).toEqual(['done', 'done', 'pending'])
    mix = advanceJob(mix, 'pieces.proposeDirections')!
    expect(states(mix)).toEqual(['done', 'running', 'pending'])
    expect(states(endJob(mix, 'done'))).toEqual(['done', 'done', 'pending'])

    // "Go with D": the assistant takes the step.
    let pick = continueJob(endJob(mix, 'done'), 'run_3').job
    pick = advanceJob(pick, 'pieces.chooseDirection')!
    expect(states(endJob(pick, 'done'))).toEqual(['done', 'done', 'done'])
  })
})
