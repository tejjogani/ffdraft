import type { Evaluation } from '@pave/kernel'
import { applyOps, buildDesign, designFrom, TEMPLATES } from '@pave/schema'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { classifyImport } from '../empty/importers'
import { Outliner } from './Outliner'
import { addMenu, nextSteps } from './suggestions'
import { featureRowKey, featureTree, parentOf, stoneRowKey } from './tree'

const stone = (nodeId: string, index: number): Evaluation['stones'][number] => ({
  id: `${nodeId}:${index}`,
  nodeId,
  cut: 'round',
  stone: 'diamond',
  dims: { width: 1, length: 1, depth: 0.6 },
  carat: 0.005,
  meshKey: 'round',
  matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  role: 'melee',
  setting: 'bead',
})

const design = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
const ALL = [
  'ringShank',
  'gem',
  'setting',
  'halo',
  'gemRow',
  'pave',
  'vectorBody',
  'meshBody',
  'relief',
  'bail',
  'chain',
  'primitive',
  'pattern',
]

describe('outliner tree', () => {
  it('nests each node under what it attaches to', () => {
    const rows = featureTree(design('halo'), []).rows(new Set())
    const depth = Object.fromEntries(rows.map((r) => [r.id, r.depth]))
    const d = design('halo')
    const kind = (k: string) => d.order.find((id) => d.nodes[id]!.kind === k)!
    expect(depth[kind('ringShank')]).toBe(0)
    expect(depth[kind('gem')]).toBe(1)
    expect(depth[kind('setting')]).toBe(2)
    expect(rows).toHaveLength(d.order.length)
  })
  it('hides the children of collapsed nodes', () => {
    const d = design('halo')
    const band = d.order.find((id) => d.nodes[id]!.kind === 'ringShank')!
    expect(featureTree(d, []).rows(new Set([featureRowKey(band)]))).toHaveLength(1)
  })
  it('groups planar and spatial curves without folding the bodies they drive', () => {
    const d = designFrom('other', [
      {
        id: 'rail',
        kind: 'curve',
        plane: 'front',
        points: [
          { id: 'p1', u: 0, v: 0 },
          { id: 'p2', u: 4, v: 0 },
        ],
      },
      { id: 'wire', kind: 'pipe', curve: 'rail' },
      {
        id: 'edge',
        kind: 'nurbsCurve',
        degree: 1,
        knots: [0, 1],
        controlPoints: [
          [0, 0, 0, 1],
          [0, 0, 3, 1],
        ],
      },
    ])
    const tree = featureTree(d, [])
    const folded = tree.rows(new Set())
    const curves = folded.find((r) => r.kind === 'construction')!
    expect(curves).toMatchObject({ count: 2, expanded: false, depth: 0 })
    expect(folded).toHaveLength(2)
    expect(folded[0]).toMatchObject({ id: 'wire', depth: 0 })
    expect(parentOf(d, 'wire')).toBe('rail')
    expect(tree.ancestors('edge')).toEqual([curves.key])
    expect(tree.rows(new Set([curves.key])).slice(2)).toMatchObject([
      { kind: 'feature', id: 'rail', parent: curves.key },
      { kind: 'feature', id: 'edge', parent: curves.key },
    ])
  })

  it('lists repeated stones only after opening their own disclosure', () => {
    const d = designFrom('ring', [
      { id: 'band', kind: 'ringShank' },
      { id: 'pave', kind: 'pave', host: 'band' },
      { id: 'row', kind: 'gemRow', host: 'band' },
      { id: 'center', kind: 'gem' },
    ])
    const tree = featureTree(d, [
      stone('pave', 0),
      stone('row', 0),
      stone('center', 0),
      stone('pave', 1),
      stone('retired', 0),
    ])
    const initial = tree.rows(new Set())
    const stones = initial.find((r) => r.kind === 'stones')!
    expect(stones).toMatchObject({
      id: 'pave',
      count: 2,
      parent: featureRowKey('pave'),
      expanded: false,
    })
    expect(initial.filter((r) => r.kind === 'stones')).toMatchObject([
      { id: 'pave', count: 2 },
      { id: 'row', count: 1 },
    ])
    expect(initial.some((r) => r.kind === 'stone')).toBe(false)
    expect(tree.ancestors('pave', 'pave:1')).toEqual([
      featureRowKey('band'),
      featureRowKey('pave'),
      stones.key,
    ])
    expect(tree.rows(new Set([stones.key])).filter((r) => r.kind === 'stone')).toMatchObject([
      { id: 'pave:0', nodeId: 'pave', parent: stones.key, key: stoneRowKey('pave:0'), number: 1 },
      { id: 'pave:1', nodeId: 'pave', parent: stones.key, key: stoneRowKey('pave:1'), number: 2 },
    ])
  })
})

describe('Features panel', () => {
  it('offers a visibility control alongside the folded construction curves group', () => {
    const d = designFrom('other', [
      {
        id: 'rail',
        name: 'Handmade rail',
        kind: 'curve',
        plane: 'front',
        points: [
          { id: 'p1', u: 0, v: 0 },
          { id: 'p2', u: 4, v: 0 },
        ],
      },
    ])
    const html = renderToStaticMarkup(
      createElement(Outliner, {
        design: d,
        stones: [],
        diagnostics: [],
        session: null,
        aiTouched: new Set<string>(),
        readOnly: true,
        onDelete: () => {},
        subjectOf: (nodeId) =>
          nodeId ? { type: 'part', pieceId: 'piece', nodeId } : { type: 'piece', pieceId: 'piece' },
        header: null,
      }),
    )
    expect(html).toContain('Construction curves')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Hide construction curves in view"')
    expect(html).not.toContain('Handmade rail')
  })
})

describe('add menu and next steps', () => {
  it('offers only what the kernel supports and says why a kind cannot be added', () => {
    const empty = designFrom('ring', [])
    const groups = addMenu(empty, ['ringShank', 'gem', 'pave'])
    const options = groups.flatMap((g) => g.options)
    expect(options.map((o) => o.kind).sort()).toEqual(['gem', 'pave', 'ringShank'])
    expect(options.find((o) => o.kind === 'ringShank')!.disabled).toBeNull()
    expect(options.find((o) => o.kind === 'pave')!.disabled).toMatch(/^Needs a /)
    expect(options.find((o) => o.kind === 'ringShank')!.title).toBe('Ring band')
  })
  it('suggests icing a body, then a bail, then a chain', () => {
    let d = designFrom('pendant', [
      { id: 'trophy', kind: 'meshBody', source: { type: 'builtin', name: 'trophy' } },
    ])
    expect(nextSteps(d, ALL).map((s) => s.label)).toEqual(['Ice it out', 'Add a bail'])
    d = applyOps(d, [{ t: 'add', node: { id: 'b', kind: 'bail', host: 'trophy' } }]).design
    expect(nextSteps(d, ALL).map((s) => s.label)).toEqual(['Ice it out', 'Hang on a chain'])
  })
  it('suggests a stone for a bare band', () => {
    expect(nextSteps(design('wedding-band'), ALL)[0]).toMatchObject({
      label: 'Add a stone',
      kind: 'gem',
    })
  })
})

describe('imports', () => {
  it('classifies by extension, not MIME type', () => {
    expect(classifyImport('Trophy.STL')).toBe('mesh')
    expect(classifyImport('logo.svg')).toBe('svg')
    expect(classifyImport('coin.jpeg')).toBe('image')
    expect(classifyImport('notes.txt')).toBeNull()
  })
})
