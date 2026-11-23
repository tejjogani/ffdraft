import { GEM_MATERIALS, type GemMaterialId } from '@pave/schema'
import { Swatch } from '@pave/ui'
import { DataTable, Td } from './table'

export function StonesSection() {
  const ids = Object.keys(GEM_MATERIALS) as GemMaterialId[]
  return (
    <DataTable
      head={[
        { label: 'Stone' },
        { label: 'Refractive index', numeric: true },
        { label: 'Specific gravity', numeric: true },
        { label: 'Dispersion', numeric: true },
        { label: 'Mohs', numeric: true },
        { label: 'Optics' },
      ]}
    >
      {ids.map((id) => {
        const g = GEM_MATERIALS[id]
        return (
          <tr key={id}>
            <Td>
              <span className="flex items-center gap-2.5 font-medium">
                <Swatch color={g.color} kind="gem" size="md" />
                {g.label}
              </span>
            </Td>
            <Td numeric>{g.ri.toFixed(3)}</Td>
            <Td numeric>{g.sg.toFixed(2)}</Td>
            <Td numeric>{g.dispersion ? g.dispersion.toFixed(3) : '—'}</Td>
            <Td numeric>{g.mohs}</Td>
            <Td muted>{'opaque' in g && g.opaque ? 'Opaque' : 'Transparent'}</Td>
          </tr>
        )
      })}
    </DataTable>
  )
}
