import {
  formatRingSize,
  RING_SIZE_SYSTEMS,
  type RingSizeSystem,
  ringInnerDiameter,
  ringSizeFromDiameter,
} from '@pave/schema'
import { NumberField, Select } from '@pave/ui'
import { useState } from 'react'
import { SectionTitle } from '../../components/Page'
import { Stat, StatGrid } from '../../components/Stats'
import { DataTable, Td } from './table'

const SYSTEM_LABEL: Record<RingSizeSystem, string> = {
  us: 'US / Canada',
  uk: 'UK / Australia',
  eu: 'EU (ISO)',
  jp: 'Japan',
  mm: 'Inner ⌀ mm',
}
const US_SIZES = Array.from({ length: 21 }, (_, i) => 3 + i * 0.5)

/** UK sizes are letters; the converter edits them by index (A = 0, halves as .5). */
const ukLetter = (v: number) => formatRingSize({ system: 'uk', value: v }).replace('UK ', '')

export function RingSizesSection() {
  const [system, setSystem] = useState<RingSizeSystem>('us')
  const [value, setValue] = useState(6.5)
  const d = ringInnerDiameter({ system, value })
  return (
    <div className="flex flex-col gap-10">
      <section className="rounded-lg p-5 shadow-[0_0_0_1px_var(--line)]">
        <SectionTitle>Converter</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            aria-label="Size system"
            value={system}
            onChange={(s) => {
              setValue(ringSizeFromDiameter(d, s).value)
              setSystem(s)
            }}
            options={RING_SIZE_SYSTEMS.map((s) => ({ value: s, label: SYSTEM_LABEL[s] }))}
            className="w-44"
          />
          <NumberField
            aria-label="Size"
            className="w-32"
            value={value}
            step={system === 'us' ? 0.25 : system === 'mm' ? 0.05 : 0.5}
            precision={system === 'mm' ? 2 : system === 'us' ? 2 : 1}
            onChange={(v) => v !== null && setValue(v)}
          />
          {system === 'uk' && <span className="text-sm text-fg-muted">= {ukLetter(value)}</span>}
        </div>
        <StatGrid className="mt-5 sm:grid-cols-6">
          <Stat label="Inner ⌀" value={`${d.toFixed(2)} mm`} />
          <Stat label="Circumference" value={`${(d * Math.PI).toFixed(1)} mm`} />
          {(['us', 'uk', 'eu', 'jp'] as const).map((s) => (
            <Stat
              key={s}
              label={SYSTEM_LABEL[s]}
              value={formatRingSize(ringSizeFromDiameter(d, s)).replace(/^[A-Z]{2} /, '')}
            />
          ))}
        </StatGrid>
      </section>
      <section>
        <SectionTitle>Size chart</SectionTitle>
        <DataTable
          head={[
            { label: 'US', numeric: true },
            { label: 'UK', numeric: true },
            { label: 'EU', numeric: true },
            { label: 'JP', numeric: true },
            { label: 'Inner ⌀ mm', numeric: true },
            { label: 'Circumference mm', numeric: true },
          ]}
        >
          {US_SIZES.map((us) => {
            const dia = ringInnerDiameter({ system: 'us', value: us })
            return (
              <tr key={us}>
                <Td numeric className="text-fg">
                  {us}
                </Td>
                <Td numeric muted>
                  {ukLetter(ringSizeFromDiameter(dia, 'uk').value)}
                </Td>
                <Td numeric muted>
                  {ringSizeFromDiameter(dia, 'eu').value}
                </Td>
                <Td numeric muted>
                  {ringSizeFromDiameter(dia, 'jp').value}
                </Td>
                <Td numeric>{dia.toFixed(2)}</Td>
                <Td numeric muted>
                  {(dia * Math.PI).toFixed(1)}
                </Td>
              </tr>
            )
          })}
        </DataTable>
      </section>
    </div>
  )
}
