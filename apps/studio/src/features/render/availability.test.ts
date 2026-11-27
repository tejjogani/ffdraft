import type { Part, StoneInstance } from '@pave/kernel'
import { designFrom } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { renderAvailability, sourceMaterialSummary } from './availability'

const imported = {
  id: 'source',
  kind: 'meshBody',
  source: { type: 'asset', assetId: 'rhino-mesh', rhinoLayer: 'Imported::Metal' },
  keepSourcePlacement: true,
} as const
const sourcePart = { nodeId: 'source' } as Part
const stone = { nodeId: 'gem' } as StoneInstance
const empty = { parts: [], stones: [] }

const available = (design = designFrom('other', [])) => ({
  status: 'ready' as const,
  stale: false,
  design,
  evaluation: empty,
})

describe('render availability from production geometry', () => {
  it('offers role review when an included evaluated source is still unassigned', () => {
    const design = designFrom('other', [{ ...imported, importRole: 'unassigned' }])
    expect(
      renderAvailability({
        ...available(design),
        evaluation: { ...empty, referenceParts: [sourcePart] },
      }),
    ).toBe('review-roles')
  })

  it('recognizes older Rhino bodies with provenance and no saved role', () => {
    const design = designFrom('other', [imported])
    expect(
      renderAvailability({
        ...available(design),
        evaluation: { ...empty, referenceParts: [sourcePart] },
      }),
    ).toBe('review-roles')
  })

  it('keeps intentionally reference-only or excluded imports out of the role-review prompt', () => {
    for (const source of [
      { ...imported, importRole: 'reference' as const },
      { ...imported, importRole: 'unassigned' as const, visible: false },
    ]) {
      const design = designFrom('other', [source])
      expect(
        renderAvailability({
          ...available(design),
          evaluation: { ...empty, referenceParts: [sourcePart] },
        }),
      ).toBe('references')
    }
  })

  it('identifies an uncapped modeling surface so the designer can thicken it', () => {
    expect(
      renderAvailability({
        ...available(),
        evaluation: { ...empty, referenceParts: [{ ...sourcePart, modelingSheet: true }] },
      }),
    ).toBe('sheets')
  })

  it('accepts either production metal or stones alongside imported references', () => {
    const design = designFrom('other', [{ ...imported, importRole: 'unassigned' }])
    for (const evaluation of [
      { ...empty, parts: [sourcePart] },
      { ...empty, stones: [stone] },
    ]) {
      expect(
        renderAvailability({
          ...available(design),
          evaluation: { ...evaluation, referenceParts: [sourcePart] },
        }),
      ).toBe('ready')
    }
  })

  it('does not request import roles for a curve-only design', () => {
    const design = designFrom('other', [
      {
        id: 'rail',
        kind: 'curve',
        plane: 'front',
        points: [
          { id: 'a', u: 0, v: 0 },
          { id: 'b', u: 1, v: 0 },
        ],
      },
    ])
    expect(renderAvailability(available(design))).toBe('empty')
  })

  it('does not queue against a stale or unfinished evaluation', () => {
    expect(
      renderAvailability({
        ...available(),
        status: 'evaluating',
        stale: true,
        evaluation: { ...empty, parts: [sourcePart] },
      }),
    ).toBe('pending')
    expect(renderAvailability({ ...available(), status: 'loading', evaluation: null })).toBe(
      'pending',
    )
    expect(renderAvailability({ ...available(), status: 'error', evaluation: null })).toBe('failed')
  })
})

it('counts source display labels on distinct visible unassigned bodies in the render evaluation', () => {
  const outer = { id: 'outer', definitionId: 'outer-def', material: 'Emerald' }
  const inner = { id: 'inner', definitionId: 'inner-def' }
  const body = (id: string, material?: string) => ({
    ...imported,
    id,
    source: {
      ...imported.source,
      rhinoContext: {
        groups: [],
        placements: [],
        material,
      },
    },
  })
  const inherited = (id: string, fromParent: boolean) => ({
    ...imported,
    id,
    source: {
      ...imported.source,
      rhinoContext: {
        groups: [],
        materialFromParent: true as const,
        placements: [outer, { ...inner, ...(fromParent && { materialFromParent: true as const }) }],
      },
    },
  })
  const design = designFrom('other', [
    body('metal', '/White Gold-b46dab22-34ed-4666-af9c-908cd8a75324'),
    body('other-metal', '/White Gold-b46dab22-34ed-4666-af9c-908cd8a75324'),
    inherited('gem', true),
    inherited('empty', false),
    body('excluded', 'Ruby'),
    { ...body('reference', 'Sapphire'), importRole: 'reference' },
    { ...body('hidden', 'Topaz'), visible: false },
    body('literal', '/Library/Stone-2024'),
  ])
  const referenceParts = [
    'metal',
    'metal',
    'other-metal',
    'gem',
    'empty',
    'reference',
    'hidden',
    'literal',
  ].map((nodeId) => ({ nodeId }) as Part)
  expect(sourceMaterialSummary(design, referenceParts)).toBe(
    'White Gold (2), Emerald (1), /Library/Stone-2024 (1)',
  )
})
