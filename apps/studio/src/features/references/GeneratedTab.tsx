/**
 * The reference window's Generated tab, shown only when an image model is configured: concept
 * images made from a prompt (and the pinned references), kept on the piece's pinned board with
 * their lineage. Generating is paid, so the price comes first and the person confirms it.
 */
import type { Piece } from '@pave/schema'
import { Button, EmptyState, Spinner, Textarea, toast } from '@pave/ui'
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { assetUrl } from '../../lib/assets'
import { invalidateFor, queryClient, useRpc } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { RightsChip } from './Provenance'

export function GeneratedTab({ piece }: { piece: Piece }) {
  const pins = useRpc('references.pins', { pieceId: piece.id })
  const [prompt, setPrompt] = useState('')
  const [quote, setQuote] = useState<{ usd: number; seconds: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const generated = (pins.data?.references ?? []).filter((r) => r.type === 'generated')
  const boardId = pins.data?.boardId ?? null
  // Pinned pictures that may be sent (never a view-only one) condition the images.
  const referenceIds = (pins.data?.references ?? [])
    .filter((r) => r.assetId && r.rights !== 'viewOnly' && r.type !== 'generated')
    .slice(0, 8)
    .map((r) => r.id)

  const price = async () => {
    setBusy(true)
    try {
      const q = await rpc.call('references.estimate', { prompt, referenceIds, count: 2 })
      setQuote({ usd: q.usd, seconds: q.seconds })
    } catch (e) {
      toast.error('Couldn’t price that', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const generate = async () => {
    if (!boardId) return
    setBusy(true)
    try {
      await rpc.call('references.generate', { prompt, referenceIds, count: 2, boardId })
      invalidateFor(queryClient, 'references')
      setQuote(null)
      setPrompt('')
    } catch (e) {
      toast.error('Couldn’t generate images', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-3 pb-3">
      {boardId ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (prompt.trim().length >= 3) void (quote ? generate() : price())
          }}
        >
          <Textarea
            minRows={2}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              setQuote(null)
            }}
            aria-label="Describe the concept images"
            placeholder="A vintage-inspired oval halo, milgrain edges, on a soft grey backdrop"
          />
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              variant={quote ? 'primary' : 'secondary'}
              disabled={busy || prompt.trim().length < 3}
            >
              {busy ? <Spinner className="size-3.5" label="" /> : <Sparkles className="size-3.5" />}
              {quote ? `Generate 2 for $${quote.usd.toFixed(2)}` : 'Price 2 images'}
            </Button>
            {quote && (
              <span className="text-xs text-fg-subtle">about {Math.round(quote.seconds)} s</span>
            )}
          </div>
        </form>
      ) : (
        <p className="text-xs text-fg-subtle">
          Pin a reference first: generated images are kept with the piece’s pins.
        </p>
      )}
      {generated.length ? (
        <ul aria-label="Generated images" className="grid grid-cols-2 gap-2">
          {generated.map((r) => (
            <li key={r.id} className="overflow-hidden rounded-lg shadow-[0_0_0_1px_var(--line)]">
              {r.assetId && (
                <img
                  src={assetUrl(r.assetId, 320)}
                  alt={r.title}
                  className="aspect-square w-full object-cover"
                />
              )}
              <div className="flex items-center justify-between gap-1 p-1.5">
                <span className="truncate text-xs">{r.title || 'Generated'}</span>
                <RightsChip rights={r.rights} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No generated images yet"
          description="Images you generate here are pinned to the piece and can be laid in a view like any picture."
        />
      )}
    </div>
  )
}
