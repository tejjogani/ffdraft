/**
 * The designer's shot references beside the assistant's framing, before any render time is
 * spent: for each shot that copies a reference, the reference on the left and the clay capture
 * through the shot's own camera on the right, with the framing check's verdict. Built from a
 * finished scenes.capture call that named its references.
 */
import { cn } from '@pave/ui'
import { Check, TriangleAlert } from 'lucide-react'
import { assetUrl } from '../../lib/assets'
import type { CallItem } from './model'

interface CapturedShot {
  id: string
  title: string
  assetId: string | null
  framing: string
  ok: boolean
  problem: string | null
  referenceAssetId?: string | null
}

/** The shots of a capture that were compared with a reference. */
export function referencePairs(call: Pick<CallItem, 'name' | 'status' | 'output'>): CapturedShot[] {
  if (call.name !== 'scenes.capture' || call.status !== 'done') return []
  const shots = (call.output as { shots?: CapturedShot[] } | undefined)?.shots ?? []
  return shots.filter((s) => s.referenceAssetId && s.assetId)
}

export function ShotReferences({ call }: { call: CallItem }) {
  const pairs = referencePairs(call)
  if (!pairs.length) return null
  return (
    <section
      aria-label="Shot references beside the framing"
      className="flex flex-col gap-2 rounded-lg bg-bg-subtle p-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
    >
      {pairs.map((s) => (
        <figure key={s.id} className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="flex flex-col gap-1">
              <img
                src={assetUrl(s.referenceAssetId!, 360)}
                alt={`Your reference for ${s.title}`}
                className="aspect-square w-full rounded-md bg-bg-muted object-contain"
              />
              <span className="text-2xs text-fg-subtle">Your reference</span>
            </div>
            <div className="flex flex-col gap-1">
              <img
                src={assetUrl(s.assetId!, 360)}
                alt={`The assistant’s framing of ${s.title}`}
                className="aspect-square w-full rounded-md bg-bg-muted object-contain"
              />
              <span className="text-2xs text-fg-subtle">Its framing, before rendering</span>
            </div>
          </div>
          <figcaption className="flex items-start gap-1.5 text-xs">
            {s.ok ? (
              <Check className="mt-0.5 size-3 shrink-0 text-ok" aria-hidden />
            ) : (
              <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warn" aria-hidden />
            )}
            <span className={cn('min-w-0', !s.ok && 'text-warn')}>
              <span className="font-medium text-fg">{s.title}</span> · {s.problem ?? s.framing}
            </span>
          </figcaption>
        </figure>
      ))}
    </section>
  )
}
