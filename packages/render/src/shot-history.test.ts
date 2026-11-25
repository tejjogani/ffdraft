import { RenderSceneSchema } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { cameraMoves, kindsOf, redoTarget, shotChangeRefusal, undoTarget } from './shot-history'

let seq = 0
const change = (id: string, reverts: string | null = null, revertedBy: string | null = null) => ({
  id,
  seq: ++seq,
  reverts,
  revertedBy,
})

describe('undo and redo targets', () => {
  it('undoes the newest edit, redoes the newest undo, and a new edit clears redo', () => {
    seq = 0
    // edit A, edit B, undo B (U), so: undo → A, redo → U.
    const a = change('a')
    const b = change('b', null, 'u')
    const u = change('u', 'b')
    expect(kindsOf([a, b, u]).get('u')).toBe('undo')
    expect(undoTarget([a, b, u])?.id).toBe('a')
    expect(redoTarget([a, b, u])?.id).toBe('u')
    // Redo it (R reverts U): R is a redo, and Undo now takes R back.
    const u2 = { ...u, revertedBy: 'r' }
    const r = change('r', 'u')
    expect(kindsOf([a, b, u2, r]).get('r')).toBe('redo')
    expect(undoTarget([a, b, u2, r])?.id).toBe('r')
    expect(redoTarget([a, b, u2, r])).toBeNull()
    // An edit after an undo: nothing to redo.
    const c = change('c')
    expect(redoTarget([a, b, u, c])).toBeNull()
    expect(undoTarget([a, b, u, c])?.id).toBe('c')
    expect(undoTarget([])).toBeNull()
  })
})

describe('the camera lock', () => {
  const scene = (camera: Record<string, unknown>) =>
    RenderSceneSchema.parse({ camera: { preset: 'hero', focalLength: 90, ...camera } })
  const locked = scene({ locked: true })

  it('names the camera settings a change moves, not the lock itself', () => {
    expect(cameraMoves(scene({}), scene({ focalLength: 100, locked: true }))).toEqual([
      'focalLength',
    ])
  })

  it('refuses to move a locked camera, and lets only a person lock or unlock it', () => {
    expect(shotChangeRefusal(locked, scene({ locked: true, roll: 5 }), 'person')).toMatch(/locked/)
    expect(shotChangeRefusal(locked, scene({ locked: true, roll: 5 }), 'agent')).toMatch(/locked/)
    expect(shotChangeRefusal(locked, scene({}), 'agent')).toMatch(/Only a person/)
    expect(shotChangeRefusal(scene({}), locked, 'agent')).toMatch(/Only a person/)
    // A person unlocks and moves in one change; anyone changes the look of a locked shot.
    expect(shotChangeRefusal(locked, scene({ roll: 5 }), 'person')).toBeNull()
    expect(shotChangeRefusal(locked, { ...locked, look: 'black-acrylic' }, 'agent')).toBeNull()
  })
})
