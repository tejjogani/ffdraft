/**
 * Drawing views in third-angle projection (ISO 128 method E), the convention of US and Asian
 * casting houses. Space follows the kernel: Z up, a ring's finger along Y with the head at +Z,
 * flat pieces in the XZ plane facing −Y — so "front" looks along +Y for both.
 */
import { type V3, dot } from '../geometry/vec'

export type ViewId = 'front' | 'top' | 'side' | 'section' | 'iso'

export interface ViewDef {
  id: ViewId
  title: string
  /** Orthonormal screen basis: right × up = toward (the viewer). */
  right: V3
  up: V3
  toward: V3
  /** Keep only geometry at or behind this depth (section views cut at the plane depth = 0). */
  clipDepth?: number
}

const S3 = 1 / Math.sqrt(3)
const S6 = 1 / Math.sqrt(6)
const S2 = 1 / Math.SQRT2

export const VIEWS: Record<ViewId, ViewDef> = {
  front: { id: 'front', title: 'Front', right: [1, 0, 0], up: [0, 0, 1], toward: [0, -1, 0] },
  // Right-hand side view, placed to the right of the front view.
  side: { id: 'side', title: 'Right side', right: [0, 1, 0], up: [0, 0, 1], toward: [1, 0, 0] },
  // Plan view, placed above the front view: its lower edge is the front of the piece.
  top: { id: 'top', title: 'Top', right: [1, 0, 0], up: [0, 1, 0], toward: [0, 0, 1] },
  // Section A–A on the YZ plane, looking toward −X (same orientation as the side view).
  section: {
    id: 'section',
    title: 'Section A–A',
    right: [0, 1, 0],
    up: [0, 0, 1],
    toward: [1, 0, 0],
    clipDepth: 0,
  },
  iso: {
    id: 'iso',
    title: 'Isometric',
    right: [S2, S2, 0],
    up: [-S6, S6, 2 * S6],
    toward: [S3, -S3, S3],
  },
}

export const project = (v: ViewDef, p: V3): V3 => [dot(p, v.right), dot(p, v.up), dot(p, v.toward)]
