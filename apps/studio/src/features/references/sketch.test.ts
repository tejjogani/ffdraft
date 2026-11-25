import { describe, expect, it } from 'vitest'
import {
  addStroke,
  clearSketch,
  drawSketch,
  INK,
  type Ink,
  isBlank,
  PAPER,
  SKETCH_PX,
  type SketchEntry,
  toSheet,
  undoSketch,
  visibleStrokes,
} from './sketch'

const pen = (points: [number, number][]) => ({ tool: 'pen' as const, size: 9, points })
const eraser = (points: [number, number][]) => ({ tool: 'eraser' as const, size: 36, points })

describe('the sketch pad', () => {
  it('draws, erases, clears and undoes, Clear included', () => {
    let s: SketchEntry[] = []
    expect(isBlank(s)).toBe(true)
    s = addStroke(
      s,
      pen([
        [10, 10],
        [200, 200],
      ]),
    )
    s = addStroke(s, eraser([[100, 100]]))
    expect(visibleStrokes(s)).toHaveLength(2)
    expect(isBlank(s)).toBe(false)
    // An empty stroke (a pointer that never moved onto the sheet) records nothing.
    expect(addStroke(s, pen([]))).toHaveLength(2)
    s = clearSketch(s)
    expect(isBlank(s)).toBe(true)
    expect(visibleStrokes(s)).toEqual([])
    // Clearing a blank sheet spends no Undo.
    expect(clearSketch(s)).toHaveLength(s.length)
    // Undo brings the cleared sketch back.
    s = undoSketch(s)
    expect(visibleStrokes(s)).toHaveLength(2)
    s = undoSketch(undoSketch(s))
    expect(s).toEqual([])
    expect(undoSketch(s)).toEqual([])
    // Only eraser marks: nothing worth saving.
    expect(
      isBlank([
        eraser([
          [1, 1],
          [2, 2],
        ]),
      ]),
    ).toBe(true)
  })

  it('maps pointers to the sheet whatever size it is shown at, kept on the sheet', () => {
    expect(toSheet(160, 80, 320, 320)).toEqual([SKETCH_PX / 2, SKETCH_PX / 4])
    expect(toSheet(-5, 400, 320, 320)).toEqual([0, SKETCH_PX])
  })

  it('draws ink on paper, the eraser as paper, a tap as a dot, at any output size', () => {
    const calls: string[] = []
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineCap: 'butt',
      lineJoin: 'miter',
      fillRect: (x: number, y: number, w: number, h: number) =>
        calls.push(`fill ${ctx.fillStyle} ${x},${y},${w},${h}`),
      beginPath: () => calls.push('begin'),
      moveTo: (x: number, y: number) => calls.push(`move ${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`line ${x},${y}`),
      stroke: () => calls.push(`stroke ${ctx.strokeStyle} ${ctx.lineWidth}`),
      arc: (x: number, y: number, r: number) => calls.push(`arc ${x},${y},${r}`),
      fill: () => calls.push(`dot ${ctx.fillStyle}`),
    } satisfies Ink
    drawSketch(
      ctx,
      [
        pen([
          [0, 0],
          [512, 512],
        ]),
        eraser([
          [512, 0],
          [0, 512],
        ]),
        pen([[100, 100]]),
      ],
      512,
    )
    expect(calls).toEqual([
      `fill ${PAPER} 0,0,512,512`,
      'begin',
      'move 0,0',
      'line 256,256',
      `stroke ${INK} 4.5`,
      'begin',
      'move 256,0',
      'line 0,256',
      `stroke ${PAPER} 18`,
      'begin',
      'arc 50,50,2.25',
      `dot ${INK}`,
    ])
  })
})
