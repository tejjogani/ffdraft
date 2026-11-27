import { applyOps, designFrom, type NodeInput } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { inspectorModel } from '../inspector/model'
import { addNode, saveSectionFeature } from '../ops'
import { addMenu } from '../outliner/suggestions'
import {
  initialSectionDraft,
  SECTION_TOOLS,
  sectionDraftProblem,
  sectionToolFor,
} from './section-model'

const rail = (id: string, x: number): NodeInput => ({
  id,
  kind: 'nurbsCurve',
  degree: 1,
  knots: [0, 1],
  controlPoints: [
    [x, 0, 0, 1],
    [x, 0, 4, 1],
  ],
})
const section = (id: string, z: number): NodeInput => ({
  id,
  kind: 'nurbsCurve',
  degree: 1,
  knots: [0, 1],
  controlPoints: [
    [0, 0, z, 1],
    [3, 0, z, 1],
  ],
})
const drawing = designFrom('other', [
  rail('left', 0),
  rail('right', 3),
  section('bottom', 0),
  section('top', 4),
  { id: 'ball', kind: 'primitive', shape: 'sphere' },
])

describe('linked section features', () => {
  it('exposes each supported tool with its own source requirements', () => {
    const limited = designFrom('other', [rail('left', 0), section('bottom', 0)])
    const options = addMenu(limited, ['loft', 'railSweep'])
      .flatMap((group) => group.options)
      .map(({ title, sectionTool, disabled }) => ({
        title,
        sectionTool: sectionTool?.id,
        disabled,
      }))
    expect(options).toMatchObject([
      { title: 'Loft', sectionTool: 'loft', disabled: null },
      { title: 'Sweep 1 rail', sectionTool: 'sweep1', disabled: null },
      { title: 'Sweep 2 rails', sectionTool: 'sweep2', disabled: 'Needs at least 3 curves' },
    ])
    expect(
      addMenu(drawing, ['loft']).flatMap((group) => group.options.map((o) => o.title)),
    ).toEqual(['Loft'])
  })

  it('starts with ordered selected curves and leaves rail assignments explicit', () => {
    expect(initialSectionDraft(drawing, SECTION_TOOLS[0], ['top', 'ball', 'bottom'])).toMatchObject(
      {
        sections: ['top', 'bottom'],
        rails: [],
        capped: true,
      },
    )
    expect(initialSectionDraft(drawing, SECTION_TOOLS[2], ['top', 'bottom'])).toMatchObject({
      sections: [''],
      rails: ['', ''],
    })
  })

  it('requires source choices and distinct section and rail roles', () => {
    const draft = { sections: ['bottom'], rails: ['left', 'right'], capped: false, ruled: false }
    expect(sectionDraftProblem(drawing, SECTION_TOOLS[2], draft)).toBeUndefined()
    expect(
      sectionDraftProblem(drawing, SECTION_TOOLS[2], { ...draft, rails: ['left', ''] }),
    ).toMatch(/Rail 2/)
    expect(
      sectionDraftProblem(drawing, SECTION_TOOLS[2], { ...draft, rails: ['left', 'left'] }),
    ).toMatch(/different/)
    expect(
      sectionDraftProblem(drawing, SECTION_TOOLS[2], { ...draft, rails: ['left', 'bottom'] }),
    ).toMatch(/different/)
    expect(
      sectionDraftProblem(drawing, SECTION_TOOLS[2], { ...draft, sections: ['ball'] }),
    ).toMatch(/Section 1/)
  })

  it('creates and updates linked sweep inputs in one operation without replacing the feature', () => {
    const draft = {
      sections: ['bottom', 'top'],
      rails: ['left', 'right'],
      capped: false,
      ruled: false,
    }
    const created = saveSectionFeature(drawing, SECTION_TOOLS[2], draft)
    const model = applyOps(drawing, created.ops).design
    const sweep = model.nodes[created.id]
    if (sweep?.kind !== 'railSweep') throw new Error('Sweep missing')
    expect(sectionToolFor(sweep).id).toBe('sweep2')
    expect(initialSectionDraft(model, SECTION_TOOLS[2], [], sweep)).toEqual(draft)

    const updated = saveSectionFeature(
      model,
      SECTION_TOOLS[2],
      { ...draft, sections: ['top', 'bottom'] },
      sweep,
    )
    expect(updated).toEqual({
      id: sweep.id,
      ops: [
        {
          t: 'update',
          id: sweep.id,
          patch: { sections: ['top', 'bottom'], rails: ['left', 'right'], capped: false },
        },
      ],
    })
    expect(applyOps(model, updated.ops).design.nodes[sweep.id]).toMatchObject({
      sections: ['top', 'bottom'],
      rails: ['left', 'right'],
    })
    expect(saveSectionFeature(model, SECTION_TOOLS[2], draft, sweep).ops).toEqual([])
    const reordered = applyOps(model, updated.ops).design
    expect(() => saveSectionFeature(reordered, SECTION_TOOLS[2], draft, sweep)).toThrow(
      /changed while/,
    )
  })

  it('preserves loft order and ruled/capped choices', () => {
    const draft = { sections: ['top', 'bottom'], rails: [], capped: false, ruled: true }
    const result = saveSectionFeature(drawing, SECTION_TOOLS[0], draft)
    const loft = applyOps(drawing, result.ops).design.nodes[result.id]
    expect(loft).toMatchObject({
      kind: 'loft',
      sections: ['top', 'bottom'],
      capped: false,
      ruled: true,
    })
  })
})

describe('thicken surface tools', () => {
  it('offers the tool only with an eligible sheet', () => {
    expect(addMenu(drawing, ['thickenSurface'])[0]?.options[0]).toMatchObject({
      title: 'Thicken surface',
      disabled: expect.stringMatching(/uncapped loft or rail sweep/i),
    })
    const model = applyOps(drawing, [
      { t: 'add', node: { id: 'sheet', kind: 'loft', sections: ['bottom', 'top'], capped: false } },
    ]).design
    expect(addMenu(model, ['thickenSurface'], 'ball')[0]).toMatchObject({
      label: 'Bodies',
      options: [{ disabled: null }],
    })
    const thickened = addNode(model, 'thickenSurface', { target: 'ball' })
    const node = applyOps(model, thickened.ops).design.nodes[thickened.id!]!
    expect(node).toMatchObject({
      kind: 'thickenSurface',
      surface: 'sheet',
      thickness: 1,
      reverse: false,
    })
    expect(
      inspectorModel(node, { advanced: false }).sections.flatMap((group) =>
        group.rows.map((row) => row.field.title),
      ),
    ).toEqual(expect.arrayContaining(['Source surface', 'Thickness', 'Reverse direction']))
  })
})
