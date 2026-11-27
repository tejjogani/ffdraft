import { describe, expect, it } from 'vitest'
import { queueShotAction } from './shot-actions'

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
