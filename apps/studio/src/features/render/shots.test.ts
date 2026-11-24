import { type RenderJob, RenderSceneSchema, type SavedScene } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { pickOf, secondsLeft, shotList, takeLabel, takesOf } from './shots'

const scene = RenderSceneSchema.parse({})
const saved = (id: string, takeId: string | null = null): SavedScene => ({
  id,
  pieceId: 'p1',
  title: id,
  scene,
  position: 1,
  takeId,
  updatedAt: '2026-11-24T10:00:00.000Z',
})
const take = (id: string, at: string, extra: Partial<RenderJob> = {}): RenderJob => ({
  id,
  pieceId: 'p1',
  title: 'Hero',
  scene,
  requestedScene: scene,
  sceneId: 'scn_1',
  groupId: null,
  variantLabel: null,
  purpose: 'take',
  engine: 'blender',
  autoTune: true,
  status: 'done',
  progress: 1,
  sourceVersion: 1,
  stale: false,
  assetIds: ['as_1'],
  critique: null,
  retryOf: null,
  note: null,
  starred: false,
  seconds: 10,
  device: 'CPU',
  error: null,
  actor: { type: 'user', id: 'u1' },
  createdBy: 'u1',
  createdAt: at,
  finishedAt: at,
  ...extra,
})

describe('the shot list', () => {
  it('offers the default set until shots are saved, then shows exactly the saved ones', () => {
    expect(shotList([], 'ring').map((s) => [s.key, s.saved])).toEqual([
      ['hero', null],
      ['front', null],
      ['top', null],
      ['macro', null],
    ])
    expect(shotList([saved('scn_1')], 'ring').map((s) => s.key)).toEqual(['scn_1'])
  })

  it('shows the person’s pick in the set while it is finished, else the newest take', () => {
    const [shot] = shotList([saved('scn_1')], 'ring')
    const old = take('t1', '2026-11-24T10:00:00.000Z')
    const recent = take('t2', '2026-11-24T11:00:00.000Z')
    const live = take('t3', '2026-11-24T12:00:00.000Z', { status: 'running', assetIds: [] })
    const all = takesOf(shot!, [
      old,
      recent,
      live,
      take('x', '2026-11-24T12:00:00.000Z', { sceneId: 'other' }),
    ])
    expect(all.map((t) => t.id)).toEqual(['t3', 't2', 't1'])
    expect(pickOf(shot!, all)?.id).toBe('t2')
    const [swapped] = shotList([saved('scn_1', 't1')], 'ring')
    expect(pickOf(swapped!, all)?.id).toBe('t1')
  })
})

describe('time left', () => {
  it('uses the estimate at first, then the pace so far', () => {
    const start = Date.parse('2026-11-24T10:00:00.000Z')
    const queued = take('t', '2026-11-24T10:00:00.000Z', { status: 'queued', progress: 0 })
    expect(secondsLeft(queued, 120, start)).toBe(120)
    const half = take('t', '2026-11-24T10:00:00.000Z', { status: 'running', progress: 0.5 })
    expect(secondsLeft(half, 120, start + 60_000)).toBeCloseTo(60)
    expect(secondsLeft(take('t', '2026-11-24T10:00:00.000Z'), 120)).toBeNull()
  })

  it('labels a take by its variant or its retake note', () => {
    expect(takeLabel(take('t', 'x', { variantLabel: 'Platinum' }))).toBe('Platinum')
    expect(takeLabel(take('t', 'x', { retryOf: 'a', note: 'warmer key' }))).toBe('warmer key')
    expect(takeLabel(take('t', 'x'))).toBe('Hero')
  })
})
