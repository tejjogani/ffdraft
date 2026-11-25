import { applyOps, buildDesign, type Design, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { addNode, contextValues, remove } from './ops'

const template = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
const idOf = (d: Design, kind: string) => d.order.find((id) => d.nodes[id]!.kind === kind)!

describe('defaults from context', () => {
  it('gives a new metal feature the piece’s metal, not the schema default', () => {
    const d = template('solitaire')
    const { ops } = addNode(d, 'halo', { target: idOf(d, 'gem') })
    const band = d.nodes[idOf(d, 'ringShank')] as { material: string }
    expect(ops[0]).toMatchObject({ node: { kind: 'halo', material: band.material } })
  })

  it('leaves room for the centre stone when a stone row is added to its band', () => {
    // The oval template's own row skips 44° for its 6.57 mm stone on a US 6 band.
    const d = template('oval-pave')
    const values = contextValues(d, 'gemRow', idOf(d, 'ringShank'))
    expect(values.skipCenter).toBeGreaterThanOrEqual(42)
    expect(values.skipCenter).toBeLessThanOrEqual(48)
    // A plain band has no head to avoid.
    expect(contextValues(template('wedding-band'), 'gemRow', 'band').skipCenter).toBeUndefined()
  })

  it('sizes a chain added through a bail to pass its opening', () => {
    const d = template('name-pendant')
    const bail = d.nodes[idOf(d, 'bail')] as { opening: number }
    const values = contextValues(d, 'chain', idOf(d, 'bail'))
    expect(values.linkWidth).toBeLessThan(bail.opening / 2)
    expect(values.wire).toBeLessThan(values.linkWidth as number)
  })

  it('writes chain sizes that are exact steps, whatever the bail opening', () => {
    const d = template('name-pendant')
    const bail = idOf(d, 'bail')
    for (const opening of [3, 3.2, 4, 5, 5.5, 7, 8.4]) {
      const sized = applyOps(d, [{ t: 'update', id: bail, patch: { opening } }]).design
      const { linkWidth, wire } = contextValues(sized, 'chain', bail) as Record<string, number>
      // 1.4, not 1.4000000000000001: the values are stored in the design.
      expect(Number(linkWidth!.toFixed(1))).toBe(linkWidth)
      expect(Number(wire!.toFixed(2))).toBe(wire)
    }
  })
})

describe('deleting a selection', () => {
  it('deletes a feature together with something attached to it when both are selected', () => {
    // Shift-click the band and its stone, press Delete: the band's removal already takes the
    // stone with it, so a second removal of the stone must not be sent.
    const d = template('halo')
    const band = idOf(d, 'ringShank')
    const gem = idOf(d, 'gem')
    for (const ids of [
      [band, gem],
      [gem, band],
    ]) {
      const after = applyOps(d, remove(d, ids)).design
      expect(after.nodes[band]).toBeUndefined()
      expect(after.nodes[gem]).toBeUndefined()
    }
  })

  it('skips a selected feature that no longer exists (undone, or deleted by someone else)', () => {
    const d = template('halo')
    const halo = idOf(d, 'halo')
    const after = applyOps(d, remove(d, ['gone_x1', halo])).design
    expect(after.nodes[halo]).toBeUndefined()
    expect(after.order).toHaveLength(d.order.length - 1)
    expect(remove(d, ['gone_x1'])).toEqual([])
  })

  it('removes each feature once when it is listed twice', () => {
    const d = template('halo')
    const halo = idOf(d, 'halo')
    expect(remove(d, [halo, halo])).toHaveLength(1)
  })
})
