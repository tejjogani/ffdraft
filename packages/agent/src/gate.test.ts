import { COMMAND_NAMES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import {
  admit,
  checkOverlap,
  MAX_TURNS,
  opNodeIds,
  RUN_CAP_USD,
  repeatedFailure,
  runCap,
} from './gate'
import { fromApiName, toolDefs, toolFor } from './tools'

describe('the gate', () => {
  it('caps a run at 40 model calls and $3, with a way to go on', () => {
    expect(runCap({ turns: MAX_TURNS - 1, costUsd: RUN_CAP_USD - 0.01 })).toBeNull()
    expect(runCap({ turns: MAX_TURNS, costUsd: 0 })).toEqual({ kind: 'turns', turns: 40 })
    expect(runCap({ turns: 1, costUsd: 3.2 })).toEqual({ kind: 'cost', costUsd: 3.2 })
  })

  it('gives the agent exactly its person’s rights, and asks a person for confirm tools', () => {
    expect(admit(toolFor('design.apply'), 'designer')).toEqual({ kind: 'run' })
    expect(admit(toolFor('design.apply'), 'viewer')).toMatchObject({
      kind: 'refuse',
      message: expect.stringMatching(/needs the designer role/),
    })
    expect(admit(toolFor('pieces.get'), 'viewer')).toEqual({ kind: 'run' })
    expect(admit(toolFor('pieces.buildFromSpec'), 'owner')).toEqual({ kind: 'approve' })
    expect(admit(toolFor('viewport.capture'), 'viewer').kind).toBe('refuse')
  })

  it('never offers the key or setup commands as tools, so neither the model nor MCP can reach them', () => {
    const tools = new Set(toolDefs().map((t) => t.command as string))
    for (const name of COMMAND_NAMES.filter((n) => n.startsWith('assistant.')))
      expect(tools.has(name)).toBe(false)
    expect(fromApiName('assistant_key_set')).toBeNull()
  })

  it('refuses a call that failed three times with the same input, whatever its key order', () => {
    const fail = { name: 'design.apply', input: { a: 1, b: [2] }, isError: true }
    const twice = [fail, { ...fail, input: { b: [2], a: 1 } }]
    expect(repeatedFailure({ name: 'design.apply', input: { a: 1, b: [2] } }, twice)).toBeNull()
    expect(
      repeatedFailure({ name: 'design.apply', input: { b: [2], a: 1 } }, [...twice, fail]),
    ).toMatch(/failed 3 times/)
    expect(repeatedFailure({ name: 'design.apply', input: { a: 2 } }, [...twice, fail])).toBeNull()
  })

  it('lets a person’s edit to the same feature win, and notes edits elsewhere', () => {
    const mine = [{ t: 'update', id: 'band' }]
    expect(
      opNodeIds([
        { t: 'add', node: { id: 'p1', parent: 'head' } },
        { t: 'move', id: 'x' },
      ]),
    ).toEqual(new Set(['p1', 'head', 'x']))
    expect(checkOverlap(mine, [])).toEqual({ kind: 'clear', notes: null })
    expect(
      checkOverlap(mine, [{ seq: 4, label: 'Thinner band', ops: [{ t: 'update', id: 'band' }] }]),
    ).toMatchObject({
      kind: 'conflict',
      nodeIds: ['band'],
    })
    expect(
      checkOverlap(mine, [{ seq: 4, label: 'Bigger stone', ops: [{ t: 'update', id: 'center' }] }]),
    ).toMatchObject({ kind: 'clear', notes: expect.stringMatching(/v4 “Bigger stone”/) })
    expect(checkOverlap(mine, [{ seq: 5, label: 'Pendant', ops: [{ t: 'setKind' }] }]).kind).toBe(
      'conflict',
    )
  })
})
