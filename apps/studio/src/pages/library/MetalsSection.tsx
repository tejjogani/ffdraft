import { METALS, type MetalFamily, type MetalId } from '@pave/schema'
import { Swatch } from '@pave/ui'
import { DataTable, Td } from './table'

const FAMILY: Record<MetalFamily, string> = {
  gold: 'Gold',
  platinum: 'Platinum',
  palladium: 'Palladium',
  silver: 'Silver',
  titanium: 'Titanium',
  base: 'Base metal',
}

export function MetalsSection() {
  const ids = Object.keys(METALS) as MetalId[]
  return (
    <DataTable
      head={[
        { label: 'Alloy' },
        { label: 'Family' },
        { label: 'Hallmark' },
        { label: 'Fineness', numeric: true },
        { label: 'Density g/cm³', numeric: true },
        { label: 'Shrinkage', numeric: true },
      ]}
    >
      {ids.map((id) => {
        const m = METALS[id]
        return (
          <tr key={id}>
            <Td>
              <span className="flex items-center gap-2.5 font-medium">
                <Swatch color={m.swatch} kind="metal" size="md" />
                {m.label}
              </span>
            </Td>
            <Td muted>{FAMILY[m.family]}</Td>
            <Td>
              {m.hallmark ? (
                <span className="rounded-xs px-1 py-0.5 font-mono text-2xs text-fg-muted shadow-[inset_0_0_0_1px_var(--line-strong)]">
                  {m.hallmark}
                </span>
              ) : (
                <span className="text-fg-faint">—</span>
              )}
            </Td>
            <Td numeric>{m.fineness ? `${m.fineness}‰` : '—'}</Td>
            <Td numeric>{m.density.toFixed(2)}</Td>
            <Td numeric muted>
              {m.shrinkagePct ? `${m.shrinkagePct}%` : '—'}
            </Td>
          </tr>
        )
      })}
    </DataTable>
  )
}
