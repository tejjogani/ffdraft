/**
 * Step 11's rules without a browser: what the collapsed assistant pill says about a job, which
 * stage a piece tab is, and the shot-reference pairs a framing check shows beside its captures.
 */
import { newJob } from '@pave/agent/studio'
import type { Message, Run } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { pillSummary, stageOfPath } from './jobs/status'
import { conversationItems } from './model'
import { referencePairs } from './ShotReferences'

const run = (status: Run['status'], job: Run['job']) => ({ status, job })

describe('the collapsed assistant pill', () => {
  it('says plainly what the conversation is doing', () => {
    expect(pillSummary(null)).toEqual({
      title: 'Assistant',
      detail: null,
      progress: null,
      working: false,
    })
    expect(pillSummary(run('running', null))).toMatchObject({ detail: 'Working…', working: true })
    expect(pillSummary(run('awaiting-approval', null))).toMatchObject({
      detail: 'Waiting for you',
      working: false,
    })
    expect(pillSummary(run('done', null)).detail).toBeNull()
  })

  it('shows a running job, its step and how far its plan has come', () => {
    const job = newJob('cad')
    job.plan[0]!.state = 'done'
    job.plan[1]!.state = 'running'
    expect(pillSummary(run('running', job))).toEqual({
      title: 'CAD job',
      detail: 'Settle the spec and the size; show the estimate…',
      progress: 1 / 5,
      working: true,
    })
    expect(pillSummary(run('awaiting-approval', job))).toMatchObject({ detail: 'Waiting for you' })
    expect(pillSummary(run('done', { ...job, review: 'pending' }))).toMatchObject({
      detail: 'Ready for review',
      working: false,
    })
  })
})

describe('the conversation follows the stage', () => {
  it('knows each piece tab’s stage', () => {
    expect(stageOfPath('/pieces/pc_1/directions')).toBe('design')
    expect(stageOfPath('/pieces/pc_1/design')).toBe('cad')
    expect(stageOfPath('/pieces/pc_1/render')).toBe('render')
    expect(stageOfPath('/pieces/pc_1')).toBeNull()
    expect(stageOfPath('/settings/ai')).toBeNull()
  })
})

describe('shot references beside the framing', () => {
  it('pairs each captured shot with the reference it copies, from the stored result', () => {
    const at = '2026-11-25T00:00:00.000Z'
    const m = (role: Message['role'], content: Record<string, unknown>[], seq: number): Message =>
      ({
        id: `m${seq}`,
        threadId: 'th',
        seq,
        role,
        content,
        runId: 'run_1',
        createdAt: at,
      }) as Message
    const output = {
      version: 3,
      shots: [
        {
          id: 'scn_a',
          title: 'Profile',
          assetId: 'as_cap',
          subject: 'piece',
          framing: '62% · good',
          ok: true,
          problem: null,
          referenceAssetId: 'as_ref',
        },
        {
          id: 'scn_b',
          title: 'Hero',
          assetId: 'as_cap2',
          subject: 'piece',
          framing: '64% · good',
          ok: true,
          problem: null,
          referenceAssetId: null,
        },
      ],
    }
    const items = conversationItems(
      [
        m('user', [{ type: 'text', text: 'Shoot it like this' }], 1),
        m(
          'assistant',
          [{ type: 'tool_use', id: 'tu1', name: 'scenes_capture', input: { ids: ['scn_a'] } }],
          2,
        ),
        m(
          'user',
          [
            {
              type: 'tool_result',
              tool_use_id: 'tu1',
              content: [
                { type: 'text', text: JSON.stringify(output) },
                { type: 'text', text: 'Shot reference for “Profile”' },
              ],
            },
          ],
          3,
        ),
      ],
      null,
    )
    const call = items.flatMap((i) => (i.kind === 'calls' ? i.calls : []))[0]!
    expect(call.output).toEqual(output)
    expect(referencePairs(call).map((s) => [s.id, s.referenceAssetId])).toEqual([
      ['scn_a', 'as_ref'],
    ])
    expect(referencePairs({ ...call, status: 'error' })).toEqual([])
  })
})
