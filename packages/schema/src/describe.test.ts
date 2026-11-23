import { describe, expect, it } from 'vitest'
import {
  applyOps,
  buildDesign,
  type Design,
  defaultNode,
  describeNode,
  describeOps,
  designFrom,
  emptyDesign,
  type FieldInfo,
  labelForOps,
  NODE_KINDS,
  NodeSchema,
  type Op,
  squashOps,
  TEMPLATES,
  variantPatch,
  visibleFields,
} from './index'

const solitaire = () => buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)

/** Every field, including those nested in groups and variants. */
const allFields = (fields: readonly FieldInfo[]): FieldInfo[] =>
  fields.flatMap((f) => [
    f,
    ...allFields(f.fields ?? []),
    ...(f.variants ?? []).flatMap((v) => allFields(v.fields)),
  ])

describe('describeNode', () => {
  it('names every kind and gives every field a widget, with `when` keys that exist', () => {
    for (const kind of NODE_KINDS) {
      const d = describeNode(kind)
      expect(d.title, kind).not.toBe('')
      expect(d.fields.length, kind).toBeGreaterThan(0)
      const check = (fields: readonly FieldInfo[]) => {
        for (const f of fields) {
          expect(f.widget, `${kind}.${f.key}`).toBeTruthy()
          for (const k of Object.keys(f.meta.when ?? {}))
            expect(
              fields.some((x) => x.key === k),
              `${kind}.${f.key} when ${k}`,
            ).toBe(true)
          if (f.fields) check(f.fields)
          for (const v of f.variants ?? []) check(v.fields)
        }
      }
      check(d.fields)
    }
  })

  it('reads titles, units, ranges, defaults and the new field metadata', () => {
    const band = describeNode('ringShank')
    expect(band.title).toBe('Ring band')
    const width = band.fields.find((f) => f.key === 'widthTop')!
    expect(width).toMatchObject({ type: 'number', widget: 'number', min: 1, max: 14, default: 2.2 })
    expect(width.meta).toMatchObject({ title: 'Width at top', unit: 'mm', group: 'Band' })
    expect(band.fields.find((f) => f.key === 'size')!.widget).toBe('ringSize')
    expect(band.fields.find((f) => f.key === 'material')!.widget).toBe('metal')
    expect(band.fields.find((f) => f.key === 'plating')!.meta.advanced).toBe(true)
    expect(band.fields.find((f) => f.key === 'transform')).toMatchObject({
      widget: 'group',
      meta: { advanced: true },
    })
    const profile = band.fields.find((f) => f.key === 'profile')!
    expect(profile.options).toContainEqual({ value: 'dShape', label: 'D-shape' })
    expect(profile.widget).toBe('select')

    const halo = describeNode('halo')
    expect(halo.fields.find((f) => f.key === 'stoneWidth')!.meta).toMatchObject({
      widget: 'stoneSize',
      snap: 'melee',
    })
    expect(halo.fields.find((f) => f.key === 'material')!.options).toContainEqual({
      value: 'pt950',
      label: 'Platinum 950',
    })
    const pave = describeNode('pave')
    for (const key of ['sizeMin', 'sizeMax'])
      expect(pave.fields.find((f) => f.key === key)!.meta.snap).toBe('melee')
    for (const key of ['gap', 'margin', 'seed'])
      expect(pave.fields.find((f) => f.key === key)!.meta.advanced, key).toBe(true)
    expect(describeNode('gem').fields.find((f) => f.key === 'width')!.widget).toBe('stoneSize')
  })

  it('describes choices of variants and lists of references', () => {
    const placement = describeNode('gem').fields.find((f) => f.key === 'placement')!
    expect(placement.type).toBe('variant')
    expect(placement.variants!.map((v) => v.value)).toEqual(['ringTop', 'surface', 'free'])
    const ringTop = placement.variants![0]!
    expect(ringTop.fields.find((f) => f.key === 'shank')).toMatchObject({
      widget: 'ref',
      required: true,
      meta: { refKinds: ['ringShank'] },
    })
    const tools = describeNode('boolean').fields.find((f) => f.key === 'tools')!
    expect(tools).toMatchObject({ widget: 'refs', min: 1, required: true })
    expect(tools.meta.refKinds).toContain('meshBody')
  })

  it('labels every enum option', () => {
    for (const kind of NODE_KINDS)
      for (const f of allFields(describeNode(kind).fields))
        for (const o of f.options ?? [])
          expect(o.label, `${kind}.${f.key}=${o.value}`).toMatch(/^\S/)
  })
})

describe('visibleFields', () => {
  const setting = describeNode('setting').fields

  it('applies `when` against the value, falling back to defaults', () => {
    const keys = (value: Record<string, unknown>, advanced?: boolean) =>
      visibleFields(setting, value, { advanced }).map((f) => f.key)
    expect(keys({})).toContain('prongCount')
    expect(keys({})).not.toContain('wall')
    expect(keys({ style: 'bezel' })).toContain('wall')
    expect(keys({ style: 'bezel' })).not.toContain('prongCount')
    expect(keys({ style: 'basket' })).toContain('rails')
  })

  it('hides advanced fields unless asked', () => {
    expect(visibleFields(setting, {}).map((f) => f.key)).not.toContain('prongSpin')
    expect(visibleFields(setting, {}, { advanced: true }).map((f) => f.key)).toContain('prongSpin')
  })
})

describe('defaultNode', () => {
  const fixtures: [string, Design][] = [
    ['empty', emptyDesign()],
    ['solitaire', solitaire()],
    ['pendant', buildDesign(TEMPLATES.find((t) => t.id === 'iced-trophy')!.spec)],
  ]

  it('either builds a node the design accepts or says what is missing', () => {
    for (const [name, design] of fixtures)
      for (const kind of NODE_KINDS) {
        const { node, missing } = defaultNode(kind, design)
        if (node) {
          expect(NodeSchema.safeParse(node).success, `${name}/${kind}`).toBe(true)
          expect(() => applyOps(design, [{ t: 'add', node }]), `${name}/${kind}`).not.toThrow()
          expect(missing).toEqual([])
        } else expect(missing.length, `${name}/${kind}`).toBeGreaterThan(0)
      }
  })

  it('cannot cover or hold what is not there', () => {
    const empty = emptyDesign('pendant')
    expect(defaultNode('pave', empty)).toMatchObject({ node: null, missing: [{ key: 'host' }] })
    expect(defaultNode('setting', empty).missing.map((m) => m.key)).toEqual(['gem'])
    expect(defaultNode('pipe', empty).missing.map((m) => m.key)).toEqual(['points'])
    const wire = defaultNode('pipe', empty, {
      values: {
        points: [
          [0, 0, 0],
          [0, 0, 5],
        ],
      },
    })
    expect(wire.node).toMatchObject({ kind: 'pipe' })
  })

  it('attaches to the selection when its kind fits', () => {
    const d = solitaire()
    const band = d.order.find((id) => d.nodes[id]!.kind === 'ringShank')!
    const gem = defaultNode('gem', d, { target: band, id: 'side' }).node!
    expect(gem).toMatchObject({ id: 'side', placement: { type: 'ringTop', shank: band } })
    const free = defaultNode('gem', emptyDesign()).node!
    expect(free).not.toHaveProperty('placement')
    expect(applyOps(d, [{ t: 'add', node: gem }]).design.nodes.side).toBeDefined()

    const pendant = designFrom('pendant', [{ id: 'body', kind: 'vectorBody' }])
    expect(defaultNode('bail', pendant).node).toMatchObject({ host: 'body' })
    const pave = defaultNode('pave', pendant, { target: 'body' }).node!
    expect(pave).toMatchObject({ host: 'body' })
    const chain = defaultNode(
      'chain',
      applyOps(pendant, [{ t: 'add', node: { id: 'b', kind: 'bail', host: 'body' } }]).design,
    ).node!
    expect(chain).toMatchObject({ through: 'b' })
  })

  it('chooses a buildable variant when a choice has no default', () => {
    expect(defaultNode('meshBody', emptyDesign()).node).toMatchObject({
      source: { type: 'builtin' },
    })
    const withAsset = defaultNode('meshBody', emptyDesign(), {
      values: { source: { type: 'asset', assetId: 'as_1' } },
    }).node!
    expect(withAsset).toMatchObject({ source: { type: 'asset', assetId: 'as_1' } })
  })
})

describe('variantPatch', () => {
  it('switches a placement: shared fields kept, old fields nulled, refs filled', () => {
    const d = designFrom('pendant', [
      { id: 'body', kind: 'vectorBody' },
      { id: 'band', kind: 'ringShank' },
      { id: 'g', kind: 'gem', placement: { type: 'ringTop', shank: 'band', spin: 30 } },
    ])
    const g = d.nodes.g!
    const { patch } = variantPatch(g, 'placement', 'surface', { design: d })
    expect(patch).toEqual({
      placement: { type: 'surface', host: 'band', shank: null, angle: null, elevation: null },
    })
    const next = applyOps(d, [{ t: 'update', id: 'g', patch: patch! }]).design.nodes.g!
    expect(next).toMatchObject({ placement: { type: 'surface', host: 'band', spin: 30 } })
    expect(next).not.toHaveProperty('placement.shank')

    const free = variantPatch(next, 'placement', 'free', { design: d }).patch!
    expect(applyOps(d, [{ t: 'update', id: 'g', patch: free }]).design.nodes.g).toMatchObject({
      placement: { type: 'free' },
    })
    expect(variantPatch(g, 'placement', 'ringTop', { design: d }).patch).toEqual({})
  })

  it('never points a reference back at a dependent, and reports what it cannot fill', () => {
    const d = designFrom('ring', [
      { id: 'g', kind: 'gem' },
      { id: 's', kind: 'setting', gem: 'g' },
    ])
    expect(variantPatch(d.nodes.g!, 'placement', 'surface', { design: d })).toEqual({
      patch: null,
      missing: [{ key: 'host', title: 'On body', refKinds: expect.any(Array) }],
    })
    const body = designFrom('pendant', [{ id: 'm', kind: 'meshBody', source: { type: 'builtin' } }])
    const asset = variantPatch(body.nodes.m!, 'source', 'asset', {
      design: body,
      values: { assetId: 'as_9' },
    }).patch!
    expect(applyOps(body, [{ t: 'update', id: 'm', patch: asset }]).design.nodes.m).toMatchObject({
      source: { type: 'asset', assetId: 'as_9' },
    })
    expect(() => variantPatch(body.nodes.m!, 'height', 'x', { design: body })).toThrow()
  })
})

describe('squashOps', () => {
  const d = solitaire()
  const band = d.order.find((id) => d.nodes[id]!.kind === 'ringShank')!
  const center = d.order.find((id) => d.nodes[id]!.kind === 'gem')!

  it('merges a scrub into one update with the same result', () => {
    const ops: Op[] = [
      { t: 'update', id: band, patch: { widthTop: 2.3 } },
      { t: 'update', id: center, patch: { width: 6.8 } },
      { t: 'update', id: band, patch: { widthTop: 2.5 } },
      { t: 'update', id: band, patch: { widthTop: 2.6, widthBottom: 2.4 } },
      { t: 'update', id: center, patch: {} },
    ]
    const squashed = squashOps(ops)
    expect(squashed).toEqual([
      { t: 'update', id: band, patch: { widthTop: 2.6, widthBottom: 2.4 } },
      { t: 'update', id: center, patch: { width: 6.8 } },
    ])
    expect(applyOps(d, squashed).design).toEqual(applyOps(d, ops).design)
  })

  it('composes nested patches and keeps what merge-patch cannot express', () => {
    const nested: Op[] = [
      { t: 'update', id: center, patch: { placement: { elevation: 1.5 } } },
      { t: 'update', id: center, patch: { placement: { spin: 10 } } },
    ]
    expect(squashOps(nested)).toEqual([
      { t: 'update', id: center, patch: { placement: { elevation: 1.5, spin: 10 } } },
    ])
    expect(applyOps(d, squashOps(nested)).design).toEqual(applyOps(d, nested).design)

    const replace: Op[] = [
      { t: 'update', id: band, patch: { transform: null } },
      { t: 'update', id: band, patch: { transform: { scale: 2 } } },
    ]
    expect(squashOps(replace)).toHaveLength(2)
  })

  it('keeps only the last of successive moves, and never reorders across other ops', () => {
    const ops: Op[] = [
      { t: 'move', id: band, index: 2 },
      { t: 'move', id: band, index: 0 },
      { t: 'remove', id: 'nothing' },
      { t: 'move', id: band, index: 1 },
    ]
    expect(squashOps(ops)).toEqual([ops[1], ops[2], ops[3]])
  })
})

describe('labels and history lines', () => {
  const d = solitaire()
  const band = d.order.find((id) => d.nodes[id]!.kind === 'ringShank')!
  const center = d.order.find((id) => d.nodes[id]!.kind === 'gem')!

  it('labels one gesture by its field, with before and after', () => {
    const widthTop = (d.nodes[band] as { widthTop: number }).widthTop
    expect(labelForOps([{ t: 'update', id: band, patch: { widthTop: 2.6 } }], d)).toBe(
      `Width at top ${widthTop} → 2.6 mm`,
    )
    expect(
      labelForOps(
        [
          { t: 'update', id: band, patch: { widthTop: 2.3 } },
          { t: 'update', id: band, patch: { widthTop: 2.6 } },
        ],
        d,
      ),
    ).toBe(`Width at top ${widthTop} → 2.6 mm`)
    expect(
      labelForOps([{ t: 'update', id: center, patch: { placement: { elevation: 2 } } }], d),
    ).toMatch(/^Culet clearance .+ → 2 mm$/)
    expect(labelForOps([{ t: 'update', id: band, patch: { profile: 'dShape' } }], d)).toMatch(
      /→ D-shape$/,
    )
  })

  it('labels adds, removals and multi-field edits by schema title', () => {
    expect(labelForOps([{ t: 'add', node: { id: 'h', kind: 'halo', around: center } }], d)).toBe(
      'Added Halo',
    )
    expect(
      labelForOps([{ t: 'update', id: band, patch: { widthTop: 3, widthBottom: 3 } }], d),
    ).toBe('Band: Width at top, Width at base')
    const many: Op[] = ['a', 'b', 'c', 'e'].map((id) => ({
      t: 'add',
      node: { id, kind: 'primitive', name: id },
    }))
    expect(labelForOps(many, d)).toBe('Added a; Added b and 2 more changes')
    expect(labelForOps([], d)).toBe('No change')
    expect(labelForOps([{ t: 'setKind', kind: 'pendant' }], d)).toBe(
      'Changed the piece type to pendant',
    )
  })

  it('describes each op of a stored change with titles and before-values', () => {
    const ops: Op[] = [
      { t: 'update', id: band, patch: { widthTop: 2.6 } },
      { t: 'add', node: { id: 'h', kind: 'halo', around: center } },
    ]
    const { design: after, inverse } = applyOps(d, ops)
    const lines = describeOps(ops, inverse, after)
    expect(lines[0]).toMatchObject({ sign: '~', nodeId: band })
    expect(lines[0]!.text).toMatch(/^Band · Width at top: [\d.]+ → 2\.6 mm$/)
    expect(lines[1]).toEqual({ sign: '+', nodeId: 'h', text: 'Halo' })

    const removal = applyOps(after, [{ t: 'remove', id: 'h' }])
    expect(describeOps([{ t: 'remove', id: 'h' }], removal.inverse)).toEqual([
      { sign: '−', nodeId: 'h', text: 'Halo' },
    ])
    expect(describeOps([{ t: 'update', id: 'x', patch: { someKey: 1 } }], [])[0]!.text).toBe(
      'x · Some key: default → 1',
    )
  })
})
