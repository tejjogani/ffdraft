/**
 * Undo as a property: for every template, random batches of ops (field edits across each
 * field's whole range, variant switches, adds, removes with and without cascade, moves, kind
 * changes) are applied and then undone with the inverse `applyOps` returned. The document must
 * come back byte for byte (ids, values, node order, key order), the inverse of the inverse must
 * redo the edit, and the squashed ops of a gesture must have the same effect as the ops.
 */
import { describe, expect, it } from 'vitest'
import { buildDesign, TEMPLATES } from '../recipes/index'
import { defaultNode, describeNode, type FieldInfo, squashOps, variantPatch } from './describe'
import { applyOps, type Design, type Op, PIECE_KINDS, validateDesign } from './design'
import { NODE_KINDS } from './nodes'

/** A small seeded generator, so a failure names a case that can be run again. */
function random(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!
  return { next, pick }
}

function valueFor(field: FieldInfo, r: ReturnType<typeof random>): unknown {
  if (field.type === 'number' || field.type === 'integer') {
    // Now and then "reset to default / auto" (a merge-patch null).
    if (r.next() < 0.1) return null
    const min = field.min ?? -10
    const max = field.max ?? 10
    const value = min + r.next() * (max - min)
    return field.type === 'integer' ? Math.round(value) : value
  }
  if (field.type === 'boolean') return r.next() < 0.5
  if (field.options) return r.pick(field.options).value
  if (field.type === 'string') return r.next() < 0.2 ? null : `text ${Math.floor(r.next() * 100)}`
  return undefined
}

function randomOps(design: Design, r: ReturnType<typeof random>): Op[] {
  const ops: Op[] = []
  const count = 1 + Math.floor(r.next() * 4)
  for (let k = 0; k < count && design.order.length > 0; k++) {
    const id = r.pick(design.order)
    const node = design.nodes[id]!
    const roll = r.next()
    if (roll < 0.55) {
      const field = r.pick(describeNode(node.kind).fields)
      if (field.key === 'id' || field.key === 'kind') continue
      if (field.variants) {
        const variant = r.pick(field.variants).value
        const switched = variantPatch(node, field.key, variant, { design })
        if (switched.patch) ops.push({ t: 'update', id, patch: switched.patch })
        // And as an assistant would send it: a plain merge patch naming only the new variant.
        if (r.next() < 0.5) ops.push({ t: 'update', id, patch: { [field.key]: { type: variant } } })
        continue
      }
      const value = valueFor(field, r)
      if (value !== undefined) ops.push({ t: 'update', id, patch: { [field.key]: value } })
    } else if (roll < 0.65)
      ops.push({ t: 'move', id, index: Math.floor(r.next() * (design.order.length + 2)) })
    else if (roll < 0.75) ops.push({ t: 'remove', id, cascade: r.next() < 0.7 })
    else if (roll < 0.9) {
      const made = defaultNode(r.pick(NODE_KINDS), design)
      if (made.node)
        ops.push({
          t: 'add',
          node: made.node,
          ...(r.next() < 0.5 ? { index: Math.floor(r.next() * (design.order.length + 2)) } : {}),
        })
    } else ops.push({ t: 'setKind', kind: r.pick(PIECE_KINDS) })
  }
  return ops
}

describe('applyOps: apply then undo is the identity', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s: 120 random edits', (templateId) => {
    const r = random(0x9e3779b9 ^ templateId.length ^ (templateId.charCodeAt(0) << 8))
    const template = buildDesign(TEMPLATES.find((t) => t.id === templateId)!.spec)
    let design = template
    let applied = 0
    for (let step = 0; step < 120; step++) {
      // A cascade remove can empty the piece; start again from the template when it has.
      if (design.order.length < 2) design = template
      const ops = randomOps(design, r)
      if (ops.length === 0) continue
      let result: ReturnType<typeof applyOps>
      try {
        result = applyOps(design, ops)
      } catch {
        // A refused edit (a dangling reference, a removal that needs cascade) changes nothing.
        continue
      }
      applied++
      const label = `${templateId} step ${step}: ${JSON.stringify(ops)}`
      const undone = applyOps(result.design, result.inverse)
      expect(JSON.stringify(undone.design), label).toBe(JSON.stringify(design))
      // Redo: the inverse of the inverse gives the edited document again.
      expect(JSON.stringify(applyOps(undone.design, undone.inverse).design), label).toBe(
        JSON.stringify(result.design),
      )
      expect(JSON.stringify(applyOps(design, squashOps(ops)).design), label).toBe(
        JSON.stringify(result.design),
      )
      expect(
        validateDesign(result.design).filter((i) => i.level === 'error'),
        label,
      ).toEqual([])
      design = result.design
    }
    // The walk really edited the piece: most batches are valid.
    expect(applied).toBeGreaterThan(40)
  })
})
