import { cn } from '@pave/ui'
import type { ReactNode } from 'react'

/** Shared hairline table for reference data. Numeric columns align right in tabular mono. */
export function DataTable({
  head,
  children,
}: {
  head: { label: string; numeric?: boolean }[]
  children: ReactNode
}) {
  return (
    <div className="-mx-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th
                key={h.label}
                className={cn(
                  'h-8 px-3 text-xs font-normal whitespace-nowrap text-fg-subtle',
                  h.numeric ? 'text-right' : 'text-left',
                )}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Td({
  children,
  numeric,
  muted,
  className,
}: {
  children: ReactNode
  numeric?: boolean
  muted?: boolean
  className?: string
}) {
  return (
    <td
      className={cn(
        'h-10 border-b border-line px-3 whitespace-nowrap',
        numeric && 'text-right font-mono text-xs tabular',
        muted && 'text-fg-muted',
        className,
      )}
    >
      {children}
    </td>
  )
}
