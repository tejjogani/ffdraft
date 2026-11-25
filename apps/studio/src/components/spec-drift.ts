/**
 * Whether a piece's CAD has moved on from the spec it was built from: a fit to a photo, an edit
 * by hand or by the assistant. The spec card then says so, rather than presenting the old plan
 * (its centre stone, its band) as a summary of what is in the CAD now.
 *
 * Compared with what the spec builds today, value by value; key order is ignored because the
 * database hands designs back with their keys reordered.
 */
import { buildDesign, type Design, type PieceSpec } from '@pave/schema'

const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.entries(v)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
          .join(',')}}`
      : JSON.stringify(v)

const shape = (d: Design) => stable({ kind: d.kind, nodes: d.nodes, order: d.order })

export function cadMovedOn(spec: PieceSpec | null, design: Design): boolean {
  if (!spec || design.order.length === 0) return false
  try {
    return shape(buildDesign(spec)) !== shape(design)
  } catch {
    // A spec no recipe can build never made this CAD; there is no plan to fall behind.
    return false
  }
}
