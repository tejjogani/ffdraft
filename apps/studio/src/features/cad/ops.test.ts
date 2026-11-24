import { buildDesign, type Design, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { addNode, contextValues } from './ops'

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
})
