import { nodeTitle } from '@pave/schema'
import { Button, Input } from '@pave/ui'
import { useState } from 'react'
import type { ImportedMesh } from '../mesh-edit/model'
import { filterMountBodies } from './body-search'

const SEARCH_THRESHOLD = 12

export function MountBodies({
  parts,
  ids,
  disabled,
  resetToChange,
  onToggle,
}: {
  parts: readonly ImportedMesh[]
  ids: string[]
  disabled: boolean
  resetToChange: boolean
  onToggle(id: string): void
}) {
  const [search, setSearch] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const selected = new Set(ids)
  const searchable = parts.length > SEARCH_THRESHOLD
  const filtering = searchable && !selectedOnly && search.trim().length > 0
  const shown = selectedOnly
    ? parts.filter((body) => selected.has(body.id))
    : filterMountBodies(parts, search)
  const matchStatus = shown.length === 1 ? '1 matching body' : `${shown.length} matching bodies`

  return (
    <fieldset className="mb-4 min-w-0 border-b border-line pb-3">
      <legend className="text-sm font-medium">
        Mount bodies{' '}
        <span className="ml-1 text-xs font-normal text-fg-muted">{ids.length} selected</span>
      </legend>
      {searchable && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="search"
            aria-label="Search mount bodies"
            placeholder="Search name, layer or group"
            className="h-8 min-w-0 flex-1 px-2.5"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            disabled={selectedOnly}
          />
          <Button
            size="sm"
            variant="ghost"
            className={selectedOnly ? 'shrink-0 bg-select-soft text-fg' : 'shrink-0'}
            aria-pressed={selectedOnly}
            onClick={() => setSelectedOnly(!selectedOnly)}
          >
            Selected only
          </Button>
        </div>
      )}
      {searchable && (
        <p role="status" className="mt-1 text-xs text-fg-muted">
          {filtering ? (shown.length > 0 ? matchStatus : 'No matching bodies') : null}
        </p>
      )}
      <div className="mt-1 grid max-h-28 gap-1.5 overflow-auto py-1 sm:grid-cols-2">
        {shown.map((body) => (
          <label key={body.id} className="flex min-w-0 items-start gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={selected.has(body.id)}
              disabled={disabled || (ids.length === 1 && ids[0] === body.id)}
              onChange={() => onToggle(body.id)}
              className="mt-0.5 accent-select"
            />
            <span className="truncate" title={nodeTitle(body)}>
              {nodeTitle(body)}
            </span>
          </label>
        ))}
      </div>
      {resetToChange && (
        <p className="mt-1 text-xs text-fg-muted">
          Reset this draft to change which bodies share the cage.
        </p>
      )}
    </fieldset>
  )
}
