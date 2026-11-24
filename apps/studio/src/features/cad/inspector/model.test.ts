import {
  applyOps,
  buildDesign,
  type Design,
  describeNode,
  NODE_KINDS,
  type Node,
  NodeSchema,
  TEMPLATES,
} from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { caratOf, inSystem, sizeOptions, snapWidth, widthForCarat } from './measures'
import { type InspectorRow, inspectorModel } from './model'

const designs = TEMPLATES.map((t) => buildDesign(t.spec))
const allNodes: Node[] = designs.flatMap((d) => Object.values(d.nodes))
const flat = (rows: InspectorRow[]): InspectorRow[] => rows.flatMap((r) => [r, ...flat(r.children)])
const rowsOf = (node: Node, advanced = false) =>
  inspectorModel(node, { advanced }).sections.flatMap((s) => flat(s.rows))
const nodeOf = (d: Design, kind: string) => Object.values(d.nodes).find((n) => n.kind === kind)!

describe('inspector model', () => {
  it('covers every node kind in the templates and every titled field of each', () => {
    const kinds = new Set(allNodes.map((n) => n.kind))
    expect(kinds.size).toBeGreaterThan(10)
    for (const node of allNodes) {
      const keys = new Set(
        rowsOf(node, true)
          .filter((r) => r.path.length === 1)
          .map((r) => r.field.key),
      )
      for (const f of describeNode(node.kind).fields) {
        const hidden = Object.entries(f.meta.when ?? {}).some(
          ([k, allowed]) => !allowed.includes((node as never)[k] as never),
        )
        if (!hidden) expect(keys, `${node.kind}.${f.key}`).toContain(f.key)
      }
    }
  })

  it('names every `when` key after a sibling field', () => {
    for (const kind of NODE_KINDS) {
      const fields = describeNode(kind).fields
      for (const f of fields)
        for (const k of Object.keys(f.meta.when ?? {}))
          expect(
            fields.map((x) => x.key),
            `${kind}.${f.key}`,
          ).toContain(k)
    }
  })

  it('hides fine-tuning until asked and counts what it would reveal', () => {
    const setting = nodeOf(designs[0]!, 'setting')
    const basic = inspectorModel(setting)
    const fine = inspectorModel(setting, { advanced: true })
    expect(flat(basic.sections.flatMap((s) => s.rows)).map((r) => r.field.key)).not.toContain(
      'prongSpin',
    )
    expect(flat(fine.sections.flatMap((s) => s.rows)).map((r) => r.field.key)).toContain(
      'prongSpin',
    )
    expect(basic.advanced).toBe(fine.advanced)
    expect(basic.advanced).toBeGreaterThan(0)
  })

  it('follows `when`: bezel fields only for bezels', () => {
    const setting = nodeOf(designs[0]!, 'setting')
    const keys = (n: Node) => rowsOf(n).map((r) => r.field.key)
    expect(keys(setting)).toContain('prongCount')
    expect(keys(setting)).not.toContain('wall')
    const bezel = NodeSchema.parse({ ...setting, style: 'bezel' })
    expect(keys(bezel)).toContain('wall')
    expect(keys(bezel)).not.toContain('prongCount')
  })

  it('groups rows into titled sections, untitled first', () => {
    const band = nodeOf(designs[0]!, 'ringShank')
    const model = inspectorModel(band)
    expect(model.title).toBe('Ring band')
    expect(model.sections[0]!.title).toBeNull()
    expect(model.sections.map((s) => s.title)).toEqual(expect.arrayContaining(['Material', 'Band']))
    const size = model.sections[0]!.rows.find((r) => r.field.key === 'size')!
    expect(size.field.widget).toBe('ringSize')
  })

  it('shows the active variant of a choice as nested rows', () => {
    const gem = nodeOf(designs[0]!, 'gem')
    const placement = rowsOf(gem).find((r) => r.field.key === 'placement')!
    expect(placement.field.widget).toBe('variant')
    expect(placement.children.map((r) => r.path.join('.'))).toEqual(
      expect.arrayContaining(['placement.shank', 'placement.angle']),
    )
    const free = applyOps(designs[0]!, [
      {
        t: 'update',
        id: gem.id,
        patch: {
          placement: { type: 'free', shank: null, angle: null, elevation: null, spin: null },
        },
      },
    ]).design
    expect(rowsOf(free.nodes[gem.id]!).find((r) => r.field.key === 'placement')!.children).toEqual(
      [],
    )
  })

  it('uses the library widgets for metals and stones', () => {
    const halo = nodeOf(
      designs.find((d) => Object.values(d.nodes).some((n) => n.kind === 'halo'))!,
      'halo',
    )
    const widgets = Object.fromEntries(rowsOf(halo).map((r) => [r.field.key, r.field.widget]))
    expect(widgets).toMatchObject({
      material: 'metal',
      finish: 'finish',
      cut: 'cut',
      stone: 'stone',
      stoneWidth: 'stoneSize',
    })
  })
})

describe('linked measures', () => {
  it('round-trips mm and carats for a 1 ct round', () => {
    const s = { cut: 'round' as const, stone: 'diamond' as const }
    const w = widthForCarat(s, 1, 0.6, 40)
    expect(w).toBeGreaterThan(6.2)
    expect(w).toBeLessThan(6.6)
    expect(caratOf(s, w)).toBeCloseTo(1, 1)
  })

  it('clamps carats to the field range', () => {
    expect(widthForCarat({ cut: 'round', stone: 'diamond' }, 500, 0.6, 40)).toBe(40)
  })

  it('snaps melee to stock sizes only when the field asks', () => {
    expect(snapWidth(1.33, 'melee')).toBe(1.3)
    expect(snapWidth(1.33, undefined)).toBe(1.33)
  })

  it('converts ring sizes between systems without rewriting them', () => {
    const us6 = { system: 'us' as const, value: 6 }
    expect(inSystem(us6, 'us')).toEqual({ size: us6, approx: false, deltaMm: 0 })
    const uk = inSystem(us6, 'uk')
    expect(uk.approx).toBe(true)
    expect(uk.size.system).toBe('uk')
    expect(Math.abs(uk.deltaMm)).toBeLessThan(0.3)
    expect(sizeOptions('us')).toContainEqual(us6)
    expect(sizeOptions('uk')).toContainEqual(uk.size)
  })

  it('keeps the essentials first when fine-tuning adds advanced-only sections', () => {
    for (const node of allNodes) {
      const sections = inspectorModel(node, { advanced: true }).sections
      const advancedOnly = sections.map((sec) => sec.rows.every((r) => r.field.meta.advanced))
      // Once an advanced-only section appears, every later one is advanced-only too.
      const first = advancedOnly.indexOf(true)
      if (first >= 0) expect(advancedOnly.slice(first).every(Boolean), node.kind).toBe(true)
    }
  })
})
