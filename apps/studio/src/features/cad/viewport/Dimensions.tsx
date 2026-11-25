/**
 * Dimension chips on the model: the selected feature's key measure — a band's ring size, a
 * stone's mm · ct, a body's height — beside the geometry it measures. A chip sits just outside
 * the feature's outline on screen (so it never covers what it measures), stays inside the view
 * and clear of the toolbars, and hides when what it measures is off-screen. It opens the very
 * same field control the inspector shows, so there is one way to edit each value.
 */
import type { Evaluation } from '@pave/kernel'
import { formatRingSize, type RingSize } from '@pave/schema'
import { Popover } from '@pave/ui'
import { useEffect, useRef, useState } from 'react'
import type { Viewer } from '../../../components/stage/viewer'
import { carats, mm } from '../../../lib/format'
import { type FieldEdit, FieldEditContext } from '../inspector/edit'
import { FieldControl } from '../inspector/FieldControl'
import { type InspectorRow, inspectorModel } from '../inspector/model'

type Vec3 = [number, number, number]

interface Chip {
  row: InspectorRow
  text: string
  /** Where on the model (Z-up mm) the chip is pinned. */
  at: Vec3
  /** Which side of the feature it prefers; it flips when there is no room there. */
  side: 'above' | 'below'
}

/** The measure worth pinning for a node, read from its fields' widgets. */
function chipFor(edit: FieldEdit, evaluation: Evaluation): Chip | null {
  const rows = inspectorModel(edit.node).sections.flatMap((s) => s.rows)
  const parts = evaluation.parts.filter((p) => p.nodeId === edit.node.id)
  const stones = evaluation.stones.filter((s) => s.nodeId === edit.node.id)
  const ring = rows.find((r) => r.field.widget === 'ringSize')
  if (ring && evaluation.report.ringInnerDiameter) {
    const d = evaluation.report.ringInnerDiameter
    return {
      row: ring,
      text: `${formatRingSize(ring.value as RingSize)} · ⌀ ${mm(d)}`,
      at: [0, 0, -d / 2],
      side: 'below',
    }
  }
  const stone = rows.find((r) => r.field.widget === 'stoneSize')
  // The middle stone of a row stands for the row: the first may be hidden behind the band.
  const sample = stones[Math.floor(stones.length / 2)]
  if (stone && sample) {
    const m = sample.matrix
    const top: Vec3 = [m[12]! + m[8]! * 0.2, m[13]! + m[9]! * 0.2, m[14]! + m[10]! * 0.2]
    const text =
      stones.length === 1
        ? `${mm(sample.dims.width)} · ${carats(sample.carat)}`
        : `${stones.length} × ${mm(sample.dims.width)}`
    return { row: stone, text, at: top, side: 'above' }
  }
  const height = rows.find((r) => r.field.key === 'height' && r.field.meta.unit === 'mm')
  if (height && parts.length) {
    const max = parts.reduce((z, p) => Math.max(z, p.bounds.max[2]), -Infinity)
    const x = parts.reduce((v, p) => Math.max(v, p.bounds.max[0]), -Infinity)
    const y = parts.reduce((v, p) => Math.min(v, p.bounds.min[1]), Infinity)
    return { row: height, text: `↕ ${mm(height.value as number)}`, at: [x, y, max], side: 'above' }
  }
  return null
}

/** Room left for the floating toolbars and the facts strip, and the gap to the view's edge. */
const HUD_BAND_PX = 56
const EDGE_PX = 12
const GAP_PX = 8

export function Dimensions({
  viewer,
  evaluation,
  edit,
}: {
  viewer: Viewer | null
  evaluation: Evaluation | null
  edit: FieldEdit | null
}) {
  const chip = edit && evaluation ? chipFor(edit, evaluation) : null
  const el = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const at = chip?.at.join(',')
  const side = chip?.side
  const nodeId = edit?.node.id

  useEffect(() => {
    if (!viewer || !at || !nodeId) return
    const point = at.split(',').map(Number) as Vec3
    const place = () => {
      const node = el.current
      const parent = node?.parentElement
      if (!node || !parent) return
      const p = viewer.project(point)
      const box = viewer.screenBounds([nodeId])
      setVisible(p.visible)
      if (!p.visible) return
      const w = node.offsetWidth
      const h = node.offsetHeight
      const { clientWidth: vw, clientHeight: vh } = parent
      const top = (box?.y0 ?? p.y) - GAP_PX - h
      const bottom = (box?.y1 ?? p.y) + GAP_PX
      const roomAbove = top >= HUD_BAND_PX
      const roomBelow = bottom + h <= vh - HUD_BAND_PX
      const y =
        side === 'above'
          ? roomAbove || !roomBelow
            ? top
            : bottom
          : roomBelow || !roomAbove
            ? bottom
            : top
      const x = Math.min(vw - EDGE_PX - w, Math.max(EDGE_PX, p.x - w / 2))
      const clampedY = Math.min(vh - HUD_BAND_PX - h, Math.max(HUD_BAND_PX, y))
      node.style.transform = `translate(${Math.round(x)}px, ${Math.round(clampedY)}px)`
    }
    place()
    return viewer.onRender(place)
  }, [viewer, at, side, nodeId])

  if (!chip || !edit) return null
  return (
    <div
      ref={el}
      className="pointer-events-auto absolute top-0 left-0 z-10 will-change-transform"
      style={{ visibility: visible ? 'visible' : 'hidden' }}
    >
      <Popover
        side="bottom"
        align="center"
        title={chip.row.field.title}
        className="w-[300px]"
        trigger={
          <button
            type="button"
            className="flex h-6 items-center rounded-md bg-bg px-2 font-mono text-2xs text-fg tabular shadow-[0_0_0_1px_var(--line),var(--shadow-sm)] hover:bg-bg-subtle"
            aria-label={`${chip.row.field.title}: ${chip.text}. Edit`}
          >
            {chip.text}
          </button>
        }
      >
        <FieldEditContext value={edit}>
          <FieldControl row={chip.row} />
        </FieldEditContext>
      </Popover>
    </div>
  )
}
