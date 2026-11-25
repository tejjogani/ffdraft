import {
  applyOps,
  buildDesign,
  type Design,
  emptyDesign,
  type Op,
  PieceSpecSchema,
  TEMPLATES,
} from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { cadMovedOn } from './spec-drift'

const halo = TEMPLATES.find((t) => t.id === 'halo')!
const spec = PieceSpecSchema.parse(halo.spec)

/** What the database hands back: the same values, keys in another order (Postgres JSONB). */
const reordered = (d: Design): Design => {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .toReversed()
              .map(([k, x]) => [k, sort(x)]),
          )
        : v
  return sort(d) as Design
}

describe('whether the CAD has moved on from its spec', () => {
  it('is false for every example just built from its spec, however the keys come back', () => {
    for (const t of TEMPLATES) {
      const parsed = PieceSpecSchema.parse(t.spec)
      // pieces.create builds from the template and stores the parsed spec.
      expect(cadMovedOn(parsed, reordered(buildDesign(t.spec))), t.id).toBe(false)
    }
  })

  it('is false right after pieces.buildFromSpec replaced an empty piece’s CAD', () => {
    for (const t of TEMPLATES) {
      const parsed = PieceSpecSchema.parse(t.spec)
      const built = buildDesign(parsed)
      // The ops the server commits for a build (replaceDesignOps) onto an empty ring.
      const ops: Op[] = [
        ...(built.kind !== 'ring' ? [{ t: 'setKind', kind: built.kind } satisfies Op] : []),
        ...built.order.map((id): Op => ({ t: 'add', node: built.nodes[id]! })),
      ]
      const { design } = applyOps(emptyDesign('ring'), ops)
      expect(cadMovedOn(parsed, reordered(design)), t.id).toBe(false)
    }
  })

  it('is true once the CAD is changed by hand or by fitting it to a photo', () => {
    const built = buildDesign(spec)
    // match.fit's ops: the centre stone grown to the photo's.
    const { design: fitted } = applyOps(built, [
      { t: 'update', id: 'center', patch: { width: 7.4 } },
    ])
    expect(cadMovedOn(spec, fitted)).toBe(true)
  })

  it('is false while there is no CAD yet, or no spec', () => {
    expect(cadMovedOn(spec, { ...buildDesign(spec), order: [], nodes: {} })).toBe(false)
    expect(cadMovedOn(null, buildDesign(spec))).toBe(false)
  })
})
