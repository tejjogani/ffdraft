/** The two linked-measure widgets: stone size (mm ↔ ct) and ring size (system ↔ value). */
import {
  formatRingSize,
  type GemCutId,
  type GemMaterialId,
  measuredUsable,
  RING_SIZE_SYSTEMS,
  type RingSize,
  type RingSizeSystem,
  ringInnerDiameter,
  stoneDims,
} from '@pave/schema'
import { NumberField, Segmented, Select } from '@pave/ui'
import { useState } from 'react'
import { mm as fmtMm } from '../../../../lib/format'
import { useWorkspace } from '../../state/workspace'
import { useFieldEdit } from '../edit'
import {
  caratOf,
  inSystem,
  type StoneSpec,
  sizeOptions,
  snapWidth,
  widthForCarat,
} from '../measures'
import type { InspectorRow } from '../model'
import type { WidgetProps } from './basic'

const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * Editing a single stone's carat weight writes its girdle width. A melee row snaps to stock
 * widths when released and shows the estimated weight per stone.
 */
export function StoneSizeWidget({ row, label }: WidgetProps) {
  const edit = useFieldEdit()
  const node = edit.node as unknown as { cut?: GemCutId; stone?: GemMaterialId; lw?: number }
  const gem = edit.node.kind === 'gem' ? edit.node : undefined
  const spec: StoneSpec = {
    cut: node.cut ?? 'round',
    stone: node.stone ?? 'diamond',
    lw: node.lw,
    sourcing: gem?.sourcing,
  }
  const measured = gem && measuredUsable(gem.sourcing?.measured) ? stoneDims(gem) : null
  const { field } = row
  const width = measured?.width ?? (typeof row.value === 'number' ? row.value : 1)
  const min = field.min ?? 0.5
  const max = field.max ?? 40
  const melee = field.meta.snap === 'melee'
  const carat = caratOf(spec, width)
  const disabled = edit.readOnly || measured !== null
  const perStoneWeight = melee && (
    <p
      className="flex h-7 items-center justify-end gap-1 pr-1 font-mono text-xs whitespace-nowrap text-fg-muted tabular"
      title="Weight of one stone"
    >
      {carat < 0.1 ? carat.toFixed(3) : carat.toFixed(2)}
      <span className="text-2xs text-fg-subtle">ct ea.</span>
    </p>
  )
  return (
    <>
      <NumberField
        size="sm"
        rowLabel={label}
        trailing={perStoneWeight}
        className="gap-1"
        value={width}
        min={min}
        max={max}
        step={melee ? 0.05 : 0.01}
        unit="mm"
        disabled={disabled}
        aria-label={`${field.title} in millimetres`}
        onChange={(v) => v !== null && edit.preview(row.path, v)}
        onCommit={(v) => v !== null && edit.commit(row.path, snapWidth(v, field.meta.snap))}
      />
      {!melee && (
        <NumberField
          size="sm"
          rowLabel={<span className="text-sm leading-4 text-fg-muted">Carat weight</span>}
          value={round2(carat)}
          min={0.01}
          step={0.01}
          unit="ct"
          disabled={disabled}
          aria-label="Carat weight in carats"
          onChange={(ct) => ct && edit.preview(row.path, widthForCarat(spec, ct, min, max))}
          onCommit={(ct) => ct && edit.commit(row.path, widthForCarat(spec, ct, min, max))}
        />
      )}
      {measured && (
        <p className="col-span-2 text-xs text-fg-muted">
          Width and carat weight are fixed by the fitted stone’s measurements.
        </p>
      )}
    </>
  )
}

const SYSTEM_LABEL: Record<RingSizeSystem, string> = {
  us: 'US',
  uk: 'UK',
  eu: 'EU',
  jp: 'JP',
  mm: 'mm',
}

/**
 * A finger size read in the designer's preferred system. Switching the system only changes how
 * sizes are shown and picked; the band keeps its size until a value is chosen, and a converted
 * size shows how far the finger diameter would move (charts disagree by up to half a size).
 */
export function RingSizeWidget({ row }: { row: InspectorRow }) {
  const edit = useFieldEdit()
  const preferred = useWorkspace((s) => s.ringSystem)
  const setPreferred = useWorkspace((s) => s.setRingSystem)
  const size = (row.value as RingSize | undefined) ?? { system: 'us', value: 6 }
  const system = preferred ?? size.system
  const shown = inSystem(size, system)
  const [typed, setTyped] = useState<number | null>(null)
  const pick = (value: number) => edit.commit(row.path, { system, value })
  const diameter = ringInnerDiameter(size)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        {system === 'mm' ? (
          <NumberField
            size="sm"
            value={typed ?? round2(shown.size.value)}
            min={10}
            max={30}
            step={0.05}
            unit="mm"
            disabled={edit.readOnly}
            aria-label="Inner diameter"
            onChange={setTyped}
            onCommit={(v) => {
              setTyped(null)
              if (v !== null) pick(v)
            }}
            className="flex-1"
          />
        ) : (
          <Select
            value={String(shown.size.value)}
            options={sizeOptions(system).map((s) => ({
              value: String(s.value),
              label: formatRingSize(s),
            }))}
            disabled={edit.readOnly}
            aria-label={`Ring size (${SYSTEM_LABEL[system]})`}
            onChange={(v) => pick(Number(v))}
            className="h-7 flex-1"
          />
        )}
        <Segmented
          value={system}
          options={RING_SIZE_SYSTEMS.map((s) => ({ value: s, label: SYSTEM_LABEL[s] }))}
          aria-label="Size system"
          onChange={(s) => setPreferred(s)}
        />
      </div>
      <p className="text-xs text-fg-subtle tabular">
        {shown.approx ? (
          <>
            Saved as {formatRingSize(size)} · {SYSTEM_LABEL[system]}{' '}
            {formatRingSize(shown.size).replace(/^\S+ /, '')} is {shown.deltaMm >= 0 ? '+' : '−'}
            {Math.abs(shown.deltaMm).toFixed(2)} mm
          </>
        ) : (
          <>Inner ⌀ {fmtMm(diameter)}</>
        )}
      </p>
    </div>
  )
}
