/**
 * "Move the camera a bit lower" on the real loop and the real kernel: the model reads the
 * shot, is told where its camera stands and how the piece fills the frame, moves it with one
 * scenes.update, and the designer undoes that one change. A locked shot is refused to the model.
 */

import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { customCameraPatch, orbitOf, poseFromLookAt, type Vec3 } from '@pave/render'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, settled, text, tool } from './testing'

const KEY = 'sk-ant-test-0000000000000000000000000000-FRAM'
const SLOW = 120_000

let s: AssistantServer
let api: Client
let n = 0
const cm = () => `fr${++n}`

beforeAll(async () => {
  s = await assistantServer({ env: { ANTHROPIC_API_KEY: KEY }, engines: true })
  api = client(s.server)
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())

/** The text of the newest tool result the model was sent. */
function lastResult(params: BetaMessageStreamParams): string {
  for (const m of params.messages.toReversed())
    if (Array.isArray(m.content))
      for (const b of (m.content as unknown as Record<string, unknown>[]).toReversed())
        if (b.type === 'tool_result')
          return (b.content as { type: string; text?: string }[])
            .map((c) => c.text ?? '')
            .join('\n')
  throw new Error('no tool result')
}

const vec = (line: string, name: string): Vec3 =>
  JSON.parse(line.match(new RegExp(`${name} (\\[[^\\]]+\\])`))![1]!) as Vec3

describe('directing the camera in words', () => {
  it(
    'moves the camera lower in one undoable change, from the pose the result gives',
    async () => {
      const piece = await api.call('pieces.create', { templateId: 'solitaire' })
      const shot = await api.call('scenes.create', { pieceId: piece.id, title: 'Hero', scene: {} })
      let told = ''
      s.model.push(
        {
          content: [tool('scenes_list', { pieceId: piece.id }, 'toolu_l')],
          stop_reason: 'tool_use',
        },
        ({ params }) => {
          told = lastResult(params)
          const line = told.split('\n').find((l) => l.startsWith('- ') && l.includes(shot.id))!
          const position = vec(line, 'position')
          const target = vec(line, 'target')
          // "A bit lower": eight degrees down, around the same target.
          const o = orbitOf(position, target)
          const lower = { ...poseFromLookAt(position, target, 90, 10), elevation: o.elevation - 8 }
          const patch = customCameraPatch(lower, { center: target, radius: 10 })
          delete (patch.camera as Record<string, unknown>).framedOn
          return {
            content: [tool('scenes_update', { id: shot.id, patch }, 'toolu_u')],
            stop_reason: 'tool_use',
          }
        },
        ({ params }) => {
          told = lastResult(params)
          return { content: [text('Lowered the camera by about 8°.')], stop_reason: 'end_turn' }
        },
      )
      const before = await api.call('scenes.list', { pieceId: piece.id })
      const { run } = await api.call('threads.send', {
        text: 'Move the camera a bit lower',
        clientId: 'w1',
        clientMessageId: cm(),
        context: { pieceId: piece.id },
      } as never)
      await settled(s.parts, run.id, SLOW)
      const trace = await api.call('traces.run', { id: run.id })
      expect(trace.run.error).toBeNull()

      // The result told the model where the camera now stands and how the piece fills the frame.
      expect(told).toMatch(/Shot cameras/)
      expect(told).toMatch(/custom camera/)
      expect(told).toMatch(/elevation 16(\.\d)?°/)
      expect(told).toMatch(/framing \d+% · /)

      const history = await api.call('scenes.history', { id: shot.id })
      expect(history).toHaveLength(1)
      expect(history[0]!.actor).toMatchObject({ type: 'agent', toolCallId: 'toolu_u' })

      // One Undo puts the preset back.
      const undone = await api.call('scenes.revert', { id: shot.id })
      expect(undone.scene.scene.camera).toEqual(before[0]!.scene.camera)
    },
    SLOW,
  )

  it(
    'refuses to move a locked camera and says why',
    async () => {
      const piece = await api.call('pieces.create', { templateId: 'solitaire' })
      const shot = await api.call('scenes.create', {
        pieceId: piece.id,
        title: 'Hero',
        scene: { camera: { preset: 'hero', focalLength: 90, locked: true } },
      })
      let told = ''
      s.model.push(
        {
          content: [
            tool(
              'scenes_update',
              { id: shot.id, patch: { camera: { focalLength: 60 } } },
              'toolu_x',
            ),
          ],
          stop_reason: 'tool_use',
        },
        ({ params }) => {
          told = lastResult(params)
          return { content: [text('That shot is locked.')], stop_reason: 'end_turn' }
        },
      )
      const { run } = await api.call('threads.send', {
        text: 'Zoom out',
        clientId: 'w1',
        clientMessageId: cm(),
        context: { pieceId: piece.id },
      } as never)
      await settled(s.parts, run.id, SLOW)
      expect(told).toMatch(/locked/)
      expect(
        (await api.call('scenes.list', { pieceId: piece.id }))[0]!.scene.camera.focalLength,
      ).toBe(90)
    },
    SLOW,
  )
})
