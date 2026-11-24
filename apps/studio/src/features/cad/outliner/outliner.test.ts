import { applyOps, buildDesign, designFrom, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { classifyImport } from '../empty/importers'
import { addMenu, nextSteps } from './suggestions'
import { treeRows } from './tree'

const design = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
const ALL = ['ringShank', 'gem', 'setting', 'halo', 'gemRow', 'pave', 'vectorBody', 'meshBody', 'relief', 'bail', 'chain', 'primitive', 'pattern']

describe('outliner tree', () => {
  it('nests each node under what it attaches to', () => {
    const rows = treeRows(design('halo'), new Set())
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
    expect(treeRows(d, new Set([band]))).toHaveLength(1)
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
    let d = designFrom('pendant', [{ id: 'trophy', kind: 'meshBody', source: { type: 'builtin', name: 'trophy' } }])
    expect(nextSteps(d, ALL).map((s) => s.label)).toEqual(['Ice it out', 'Add a bail'])
    d = applyOps(d, [{ t: 'add', node: { id: 'b', kind: 'bail', host: 'trophy' } }]).design
    expect(nextSteps(d, ALL).map((s) => s.label)).toEqual(['Ice it out', 'Hang on a chain'])
  })
  it('suggests a stone for a bare band', () => {
    expect(nextSteps(design('wedding-band'), ALL)[0]).toMatchObject({ label: 'Add a stone', kind: 'gem' })
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
