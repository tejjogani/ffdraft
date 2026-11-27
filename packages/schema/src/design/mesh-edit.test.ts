import { describe, expect, it } from 'vitest'
import { applyOps, designFrom, MeshBody, parseDesignDocument } from '../index'

const source = { type: 'asset', assetId: 'mount-stl' } as const
const body = { id: 'mount', kind: 'meshBody', source, keepSourcePlacement: true } as const
const meshEdits = { assetId: source.assetId, vertices: { 0: [2, 3, 4] } }

describe('mesh edit records', () => {
  it('persists absolute coordinates in the measured source frame', () => {
    const design = designFrom('other', [body])
    expect(design.nodes.mount).not.toHaveProperty('meshEdits')
    const { design: changed, inverse } = applyOps(design, [
      { t: 'update', id: body.id, patch: { meshEdits } },
    ])
    expect(parseDesignDocument(JSON.parse(JSON.stringify(changed))).nodes.mount).toMatchObject({
      source,
      meshEdits,
    })
    expect(applyOps(changed, inverse).design).toEqual(design)
  })

  it('preserves older positions when a later sparse edit is undone', () => {
    const design = designFrom('other', [body])
    const first = applyOps(design, [{ t: 'update', id: body.id, patch: { meshEdits } }]).design
    const next = applyOps(first, [
      {
        t: 'update',
        id: body.id,
        patch: { meshEdits: { vertices: { 0: [4, 5, 6], 1: [3, 4, 5] } } },
      },
    ])
    expect(next.design.nodes.mount).toMatchObject({
      meshEdits: { assetId: source.assetId, vertices: { 0: [4, 5, 6], 1: [3, 4, 5] } },
    })
    expect(applyOps(next.design, next.inverse).design).toEqual(first)
  })

  it('rejects source changes until old positions are removed', () => {
    const design = applyOps(designFrom('other', [body]), [
      { t: 'update', id: body.id, patch: { meshEdits } },
    ]).design
    const replacement = { assetId: 'new-stl' }
    expect(() =>
      applyOps(design, [{ t: 'update', id: body.id, patch: { source: replacement } }]),
    ).toThrow(/source asset/i)
    const changed = applyOps(design, [
      { t: 'update', id: body.id, patch: { source: replacement, meshEdits: null } },
    ])
    expect(changed.design.nodes.mount).not.toHaveProperty('meshEdits')
    expect(applyOps(changed.design, changed.inverse).design).toEqual(design)
  })

  it.each([
    { source: { type: 'builtin', name: 'dice' } },
    { keepSourcePlacement: false },
    { meshEdits: { ...meshEdits, assetId: 'another-stl' } },
    { meshEdits: { ...meshEdits, extra: 'unexpected' } },
  ])('rejects invalid source binding or edit shape (%j)', (patch) => {
    expect(MeshBody.safeParse({ ...body, meshEdits, ...patch }).success).toBe(false)
  })

  it.each(['01', '-1', '1.5', '1e2', '3\n', '4294967296', '__proto__'])(
    'rejects noncanonical and oversized vertex IDs (%j)',
    (id) => {
      expect(
        MeshBody.safeParse({
          ...body,
          meshEdits: { ...meshEdits, vertices: { [id]: [2, 3, 4] } },
        }).success,
      ).toBe(false)
    },
  )

  it.each([[[2, 3]], [[2, 3, Infinity]], [[2, 3, -1_000_001]]])(
    'rejects malformed or out-of-range positions (%j)',
    (position) => {
      expect(
        MeshBody.safeParse({ ...body, meshEdits: { ...meshEdits, vertices: { 0: position } } })
          .success,
      ).toBe(false)
    },
  )

  it('rejects invalid map keys through the merge patch entry point', () => {
    const design = designFrom('other', [body])
    const vertices = { ['__proto__']: [2, 3, 4] }
    expect(() =>
      applyOps(design, [
        { t: 'update', id: body.id, patch: { meshEdits: { ...meshEdits, vertices } } },
      ]),
    ).toThrow(/vertex id/i)
  })

  it('bounds the size of the sparse edit map', () => {
    const vertices = Object.fromEntries(Array.from({ length: 10_001 }, (_, id) => [id, [2, 3, 4]]))
    expect(MeshBody.safeParse({ ...body, meshEdits: { ...meshEdits, vertices } }).success).toBe(
      false,
    )
  })
})
