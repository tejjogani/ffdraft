import type { Reference } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import {
  CANVAS_TILE,
  canvasLayout,
  classifyBoardFile,
  gridPlacement,
  movedTo,
  TAKE_TO_CAD_GOAL,
  takeToCadRefusal,
  urlsIn,
} from './board'

const ref = (over: Partial<Reference>): Reference => ({
  id: 'ref_1',
  boardId: 'brd_1',
  type: 'image',
  assetId: 'as_1',
  thumbUrl: null,
  title: 'A',
  note: '',
  source: null,
  rights: 'own',
  tags: [],
  palette: [],
  generation: null,
  pieceId: null,
  canvas: null,
  plane: null,
  width: 100,
  height: 80,
  position: 1,
  createdAt: new Date(0).toISOString(),
  ...over,
})

describe('the design board', () => {
  it('sorts dropped files into pictures, models and STEP (planned)', () => {
    expect(classifyBoardFile('Trophy.JPG')).toBe('image')
    expect(classifyBoardFile('sheet.webp')).toBe('image')
    for (const f of ['a.stl', 'b.obj', 'c.glb', 'd.3mf', 'e.ply'])
      expect(classifyBoardFile(f)).toBe('model')
    expect(classifyBoardFile('part.STEP')).toBe('step')
    expect(classifyBoardFile('notes.pdf')).toBeNull()
  })

  it('finds the links in pasted text, once each', () => {
    expect(
      urlsIn(
        'look https://www.pinterest.com/pin/1/, and https://www.pinterest.com/pin/1/ again (https://x.example/a).',
      ),
    ).toEqual(['https://www.pinterest.com/pin/1/', 'https://x.example/a'])
  })

  it('lays unplaced tiles on a grid and keeps placed ones where they are', () => {
    const layout = canvasLayout([
      ref({ id: 'a' }),
      ref({ id: 'b', canvas: { x: 900, y: 40, w: 300, z: 7 } }),
      ref({ id: 'c' }),
    ])
    expect(layout.get('a')).toEqual(gridPlacement(0))
    expect(layout.get('b')).toEqual({ x: 900, y: 40, w: 300, z: 7 })
    expect(layout.get('c')).toEqual(gridPlacement(1))
    expect(gridPlacement(5).y).toBeGreaterThan(CANVAS_TILE)
    expect(movedTo({ x: 0, y: 0, w: 10, z: 2 }, 10.4, -3.6, 9)).toEqual({
      x: 10,
      y: -4,
      w: 10,
      z: 10,
    })
  })

  it('takes pictures and sketches to CAD, never view-only pictures, links or models', () => {
    expect(takeToCadRefusal(ref({}))).toBeNull()
    expect(takeToCadRefusal(ref({ type: 'generated' }))).toBeNull()
    expect(takeToCadRefusal(ref({ rights: 'viewOnly' }))).toMatch(/View only/)
    expect(takeToCadRefusal(ref({ type: 'link', assetId: null }))).toMatch(/capture/)
    expect(takeToCadRefusal(ref({ type: 'model' }))).toMatch(/Open a 3D model as CAD/)
    expect(takeToCadRefusal(ref({ type: 'note', assetId: null }))).toMatch(/Only a picture/)
    // The job's goal has a 300-character limit on the server.
    expect(TAKE_TO_CAD_GOAL.length).toBeLessThanOrEqual(300)
  })
})
