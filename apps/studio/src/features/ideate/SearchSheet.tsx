/**
 * Search references for a board: the keyless open collections (The Met, the Art Institute of
 * Chicago, the Cleveland Museum of Art), each answering on its own. A result is saved with its
 * source, credit and rights; its picture is kept only where the museum's terms allow (the
 * server re-checks every result). Google and Pinterest search need a key and their terms, so
 * they are a disabled slot: paste their links onto the board instead.
 */
import type { SearchResult } from '@pave/schema'
import { Button, Input, Sheet, Skeleton, Switch, toast } from '@pave/ui'
import { Check, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { invalidateFor, queryClient, useRpc } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { providerLabel, RightsChip } from '../references/Provenance'

export function SearchSheet({
  open,
  onOpenChange,
  boardId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  boardId: string
}) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [openOnly, setOpenOnly] = useState(true)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const results = useRpc(
    'references.search',
    { query, openOnly, page: 1 },
    { enabled: open && query.length > 0 },
  )
  const save = async (r: SearchResult) => {
    try {
      await rpc.call('references.save', { boardId, items: [{ result: r }] })
      setSaved((s) => new Set(s).add(r.key))
      invalidateFor(queryClient, 'boards')
    } catch (e) {
      toast.error('Couldn’t save it to the board', e instanceof Error ? e.message : undefined)
    }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Search references">
      <div className="flex min-h-0 flex-col gap-3 px-4 pb-4">
        <search className="contents">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setQuery(draft.trim())
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Art deco pendant, Georgian ring, enamel…"
              aria-label="Search the museums"
              autoFocus
            />
            <Button type="submit" variant="secondary" icon={Search} disabled={!draft.trim()}>
              Search
            </Button>
          </form>
        </search>
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Switch checked={openOnly} onChange={setOpenOnly} aria-label="Open access only" />
          Open access only (pictures that may be kept and read by AI)
        </div>
        <p className="text-xs text-fg-subtle">
          The Met, the Art Institute of Chicago and the Cleveland Museum of Art. Google and
          Pinterest search need an API key and their terms: paste their links onto the board.
        </p>
        {results.isFetching && (
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-square rounded-md" />
            ))}
          </div>
        )}
        {results.data && (
          <>
            {results.data.unavailable.map((u) => (
              <p key={u.provider} className="text-xs text-fg-subtle">
                {providerLabel(u.provider)}: {u.reason}
              </p>
            ))}
            <ul aria-label="Results" className="grid grid-cols-2 gap-2">
              {results.data.results.map((r) => (
                <li
                  key={r.key}
                  className="overflow-hidden rounded-md bg-bg shadow-[0_0_0_1px_var(--line)]"
                >
                  <img
                    src={r.thumbUrl}
                    alt={r.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="aspect-square w-full bg-bg-muted object-cover"
                  />
                  <div className="flex items-start gap-1 p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs">{r.title}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-3xs text-fg-subtle">
                        {providerLabel(r.provider)} <RightsChip rights={r.rights} />
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={saved.has(r.key) ? Check : Plus}
                      disabled={saved.has(r.key)}
                      aria-label={
                        saved.has(r.key) ? `Saved ${r.title}` : `Save ${r.title} to the board`
                      }
                      onClick={() => void save(r)}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {!results.data.results.length && (
              <p className="text-sm text-fg-subtle">Nothing found.</p>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}
