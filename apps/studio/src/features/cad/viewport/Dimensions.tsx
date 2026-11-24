/**
 * Dimension chips on the model: the selected feature's key measure — a band's ring size, a
 * stone's mm · ct, a body's height — pinned to the geometry it measures. A chip opens the very
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
  /** Which side of that point it sits on, so it never covers what it measures. */
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

  useEffect(() => {
    if (!viewer || !at) return
    const point = at.split(',').map(Number) as Vec3
    const place = () => {
      const p = viewer.project(point)
      const node = el.current
      if (!node) return
      setVisible(p.visible)
      const offset =
        side === 'above' ? 'translate(-50%, calc(-100% - 10px))' : 'translate(-50%, 8px)'
      node.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) ${offset}`
    }
    place()
    return viewer.onRender(place)
  }, [viewer, at, side])

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
            className="glass flex h-6 items-center rounded-md px-2 font-mono text-2xs text-fg tabular shadow-sm hover:bg-bg"
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
