import { PRONG_NUMBERS, type ProngNumber, prongLayout } from '@pave/schema'
import { IconButton, Select } from '@pave/ui'
import { LocateFixed } from 'lucide-react'
import { useState } from 'react'
import { useFieldEdit } from '../edit'
import type { InspectorRow } from '../model'
import { NumberWidget } from './basic'

export function ProngTipsWidget({ row }: { row: InspectorRow }) {
  const { node, design } = useFieldEdit()
  const layout = node.kind === 'setting' ? prongLayout(node, design.nodes[node.gem]) : null
  if (!layout) return null
  return <ProngTipFields key={JSON.stringify(layout)} row={row} count={layout.count} />
}

function ProngTipFields({ row, count }: { row: InspectorRow; count: number }) {
  const { locateProng } = useFieldEdit()
  const [selected, select] = useState<ProngNumber>('1')
  const options = PRONG_NUMBERS.slice(0, count).map((value) => ({ value, label: `Prong ${value}` }))
  const offset = row.children.find((child) => child.field.key === selected)
  if (!offset) return null
  return (
    <>
      <div className="grid min-h-8 grid-cols-[minmax(0,44%)_minmax(0,1fr)] items-center gap-3">
        <span className="text-sm text-fg-muted">Prong</span>
        <div className="flex min-w-0 items-center gap-1.5">
          <Select
            value={selected}
            options={options}
            aria-label="Prong number"
            className="h-7 min-w-0 flex-1"
            onChange={(next) => {
              const number = PRONG_NUMBERS.find((number) => number === next)
              if (number) select(number)
            }}
          />
          {locateProng && (
            <IconButton
              icon={LocateFixed}
              label={`Locate prong ${selected}`}
              onClick={() => locateProng(selected)}
              className="size-7 shrink-0"
            />
          )}
        </div>
      </div>
      <div className="grid min-h-8 grid-cols-[minmax(0,44%)_minmax(0,1fr)] items-center gap-3">
        <NumberWidget
          key={selected}
          row={{ ...offset, value: offset.value ?? 0 }}
          label={<span className="text-sm text-fg-muted">Tip offset</span>}
        />
      </div>
      <p className="text-xs text-fg-muted">Positive moves outward, negative moves inward.</p>
    </>
  )
}
