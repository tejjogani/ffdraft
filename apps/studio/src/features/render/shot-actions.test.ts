import { describe, expect, it, vi } from 'vitest'
import { rpc } from '../../lib/rpc'
import { freshTitle, queueCadRender, queueShotAction } from './shot-actions'

it('keeps an automatically suffixed view name within the shot title limit', () => {
  const title = 'A'.repeat(80)
  expect(freshTitle(title, [title, `${title.slice(0, 78)} 2`])).toBe(`${title.slice(0, 78)} 3`)
})

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((fulfill, fail) => {
    resolve = fulfill
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('shot action ordering', () => {
  it('renders after earlier look and camera edits, before a later look change', async () => {
    const slow = deferred()
    let scene = { look: 'studio-soft', focalLength: 90 }
    const look = queueShotAction('ring', 'edit', async () => {
      await slow.promise
      scene = { ...scene, look: 'catalog-white' }
    })
    const camera = queueShotAction('ring', 'edit', async () => {
      scene = { ...scene, focalLength: 105 }
    })
    const render = queueShotAction('ring', 'render', async () => scene)
    const later = queueShotAction('ring', 'edit', async () => {
      scene = { ...scene, look: 'black-acrylic' }
    })
    slow.resolve()
    const [, , rendered] = await Promise.all([look, camera, render, later])
    expect(rendered).toEqual({ look: 'catalog-white', focalLength: 105 })
    expect(scene).toEqual({ look: 'black-acrylic', focalLength: 105 })
  })

  it('queues work on another project while a save is pending', async () => {
    const slow = deferred()
    const edit = queueShotAction('ring', 'edit', () => slow.promise)
    await expect(queueShotAction('pendant', 'render', async () => 'queued')).resolves.toBe('queued')
    slow.resolve()
    await edit
  })

  it('skips a render queued behind a failed edit, then allows a new render', async () => {
    const slow = deferred()
    const edit = queueShotAction('ring', 'edit', () => slow.promise)
    const render = queueShotAction('ring', 'render', async () => 'queued')
    const results = Promise.allSettled([edit, render])
    slow.reject(new Error('The save failed'))
    expect((await results).map(({ status }) => status)).toEqual(['rejected', 'rejected'])
    await expect(queueShotAction('ring', 'render', async () => 'queued')).resolves.toBe('queued')
  })
})

describe('rendering saved CAD', () => {
  it('deduplicates a pending request and queues the existing Hero in Blender once', async () => {
    const loading = deferred()
    const front = { id: 'front', title: 'Front' }
    const hero = { id: 'hero', title: 'Hero' }
    const call = vi.spyOn(rpc, 'call').mockImplementation(async (name) => {
      if (name === 'scenes.ensureDefaults') {
        await loading.promise
        return { shots: [front, hero], editedId: null } as never
      }
      if (name === 'renders.create') return { id: 'take' } as never
      throw new Error(`Unexpected ${name}`)
    })
    try {
      const first = queueCadRender('ring', 3, () => true)
      const duplicate = queueCadRender('ring', 3, () => true)
      loading.resolve()
      await expect(Promise.all([first, duplicate])).resolves.toEqual([hero, hero])
      expect(call.mock.calls).toEqual([
        ['scenes.ensureDefaults', { pieceId: 'ring' }],
        [
          'renders.create',
          { pieceId: 'ring', baseVersion: 3, sceneId: 'hero', title: 'Hero', engine: 'blender' },
        ],
      ])
    } finally {
      call.mockRestore()
    }
  })

  it('stops before submitting when the active piece or saved CAD changes', async () => {
    const call = vi
      .spyOn(rpc, 'call')
      .mockResolvedValue({ shots: [{ id: 'front', title: 'Front' }], editedId: null } as never)
    try {
      const switched = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
      await expect(queueCadRender('old-piece', 3, switched)).resolves.toBeNull()
      const unsaved = vi
        .fn()
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error('Wait for the design to save.')
        })
      await expect(queueCadRender('dirty-piece', 3, unsaved)).rejects.toThrow(
        'Wait for the design to save.',
      )
      expect(call.mock.calls.map(([name]) => name)).toEqual([
        'scenes.ensureDefaults',
        'scenes.ensureDefaults',
      ])
    } finally {
      call.mockRestore()
    }
  })
})
