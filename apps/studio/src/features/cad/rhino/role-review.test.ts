import { describe, expect, test } from 'vitest'
import { parseRhinoStoneFields, selectedRhinoPeers, uniqueRhinoHeadPairs } from './role-review'

const body = (id: string, placement: string[], groups = ['setting-group']) => ({
  id,
  groups,
  placement,
})

describe('bulk Rhino settings', () => {
  test('pairs within each actual placement even when both share a Rhino group', () => {
    const stoneA = body('stone-a', ['outer', 'place-a'])
    const stoneB = body('stone-b', ['outer', 'place-b'])
    const headA = body('head-a', ['outer', 'place-a'])
    const headB = body('head-b', ['outer', 'place-b'])
    const ungrouped = body('head-c', ['outer', 'place-b'], [])
    expect(uniqueRhinoHeadPairs([stoneA, stoneB], [headB, ungrouped, headA])).toEqual(
      new Map([
        ['stone-a', 'head-a'],
        ['stone-b', 'head-b'],
      ]),
    )
  })

  test('leaves both stones unpaired when they share the only eligible head', () => {
    const first = body('stone-a', [], ['group-1'])
    const second = body('stone-b', [], ['group-2'])
    const shared = body('head', [], ['group-1', 'group-2'])
    expect(uniqueRhinoHeadPairs([first, second], [shared])).toEqual(new Map())
  })

  test('leaves a stone unpaired if two heads match its group and placement', () => {
    const stone = body('stone', [])
    expect(uniqueRhinoHeadPairs([stone], [body('head-a', []), body('head-b', [])])).toEqual(
      new Map(),
    )
  })
})

const measured = {
  width: '3.25',
  length: '4.5',
  depth: '2.035',
  x: '0',
  y: '-7.1',
  z: '2.3',
  rx: '-45',
  ry: '15',
  rz: '120',
}

describe('confirmed Rhino stone fields', () => {
  test('keeps entered dimensions and world coordinates in independent axes', () => {
    expect(parseRhinoStoneFields(measured)).toEqual({
      width: 3.25,
      length: 4.5,
      depth: 2.035,
      girdle: [0, -7.1, 2.3],
      rotation: [-45, 15, 120],
    })
  })

  test.each([
    { ...measured, x: '' },
    { ...measured, ry: 'NaN' },
    { ...measured, depth: '0' },
  ])('requires a finite complete pose and positive dimensions', (fields) => {
    expect(parseRhinoStoneFields(fields)).toBeUndefined()
  })
})

describe('bulk Rhino review exclusions', () => {
  test('keeps isolated bodies unchecked unless the user explicitly includes them', () => {
    const isolated = new Set(['loose'])
    expect(selectedRhinoPeers(['near', 'loose'], isolated, new Map())).toEqual(['near'])
    expect(
      selectedRhinoPeers(
        ['near', 'loose'],
        isolated,
        new Map([
          ['near', false],
          ['loose', true],
        ]),
      ),
    ).toEqual(['loose'])
  })
})
