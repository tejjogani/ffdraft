import {
  GEM_CUT_IDS,
  GEM_CUTS,
  GEM_MATERIAL_IDS,
  GEM_MATERIALS,
  type GemCutId,
  type GemMaterialId,
  gemCarat,
  gemDims,
  gemDimsFromCarat,
} from '@pave/schema'
import { NumberField, Select, Swatch } from '@pave/ui'
import { useState } from 'react'
import { SectionTitle } from '../../components/Page'
import { DataTable, Td } from './table'

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

export function CutsSection() {
  return (
    <div className="flex flex-col gap-10">
      <CaratCalculator />
      <section>
        <SectionTitle>Proportions</SectionTitle>
        <DataTable
          head={[
            { label: 'Cut' },
            { label: 'Facets' },
            { label: 'L:W', numeric: true },
            { label: 'Depth', numeric: true },
            { label: 'Table', numeric: true },
            { label: 'Crown', numeric: true },
            { label: 'Pavilion', numeric: true },
            { label: '1 ct diamond', numeric: true },
          ]}
        >
          {GEM_CUT_IDS.map((id) => {
            const c = GEM_CUTS[id]
            const d = gemDimsFromCarat(id, 1)
            return (
              <tr key={id}>
                <Td className="font-medium">{c.label}</Td>
                <Td muted className="capitalize">
                  {c.style}
                </Td>
                <Td numeric>
                  {c.lw.min === c.lw.max ? c.lw.default.toFixed(2) : `${c.lw.min}–${c.lw.max}`}
                </Td>
                <Td numeric>{pct(c.depthPct)}</Td>
                <Td numeric>{c.tablePct ? pct(c.tablePct) : '—'}</Td>
                <Td numeric>{pct(c.crownPct)}</Td>
                <Td numeric>{c.pavilionPct ? pct(c.pavilionPct) : '—'}</Td>
                <Td numeric muted>
                  {d.length === d.width
                    ? `⌀ ${d.width.toFixed(2)}`
                    : `${d.length.toFixed(2)} × ${d.width.toFixed(2)}`}{' '}
                  mm
                </Td>
              </tr>
            )
          })}
        </DataTable>
      </section>
    </div>
  )
}

/** Carat ↔ millimetres, both directions, using the same estimation formulas as the kernel. */
function CaratCalculator() {
  const [cut, setCut] = useState<GemCutId>('round')
  const [material, setMaterial] = useState<GemMaterialId>('diamond')
  const [width, setWidth] = useState(() => gemDimsFromCarat('round', 1).width)
  const dims = gemDims(cut, width)
  const carat = gemCarat(cut, dims, material)
  const c = GEM_CUTS[cut]
  return (
    <section className="rounded-lg p-5 shadow-[0_0_0_1px_var(--line)]">
      <SectionTitle>Carat ↔ millimetres</SectionTitle>
      <div className="flex flex-wrap items-end gap-3">
        <Select
          aria-label="Cut"
          value={cut}
          onChange={(v) => {
            setWidth(gemDimsFromCarat(v, carat, material).width)
            setCut(v)
          }}
          options={GEM_CUT_IDS.map((id) => ({ value: id, label: GEM_CUTS[id].label }))}
          className="w-44"
        />
        <Select
          aria-label="Material"
          value={material}
          onChange={setMaterial}
          options={GEM_MATERIAL_IDS.map((id) => ({
            value: id,
            label: GEM_MATERIALS[id].label,
            icon: <Swatch color={GEM_MATERIALS[id].color} kind="gem" size="sm" />,
          }))}
          className="w-52"
        />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumberField
          label="Weight"
          unit="ct"
          value={Number(carat.toFixed(3))}
          min={0.005}
          max={100}
          step={0.01}
          onCommit={(v) => v && setWidth(gemDimsFromCarat(cut, v, material).width)}
        />
        <NumberField
          label="Width"
          unit="mm"
          value={Number(width.toFixed(2))}
          min={0.5}
          max={40}
          step={0.05}
          onChange={(v) => v && setWidth(v)}
        />
        <NumberField
          label="Length"
          unit="mm"
          value={Number(dims.length.toFixed(2))}
          step={0.05}
          disabled={c.lw.min === c.lw.max}
          onChange={(v) => v && setWidth(v / (dims.length / dims.width))}
        />
        <NumberField
          label="Depth"
          unit="mm"
          value={Number(dims.depth.toFixed(2))}
          step={0.05}
          onChange={(v) => v && setWidth(v / c.depthPct)}
        />
      </div>
      <p className="mt-3 text-xs text-fg-subtle">
        Estimates from standard weight formulas, scaled by specific gravity. Drag a label to scrub;
        ⇧ for ×10, ⌥ for fine steps.
      </p>
    </section>
  )
}
