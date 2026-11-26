import type { Piece, Reference } from '@pave/schema'
import { Button, InlineError, Input, Textarea } from '@pave/ui'
import { useId, useState } from 'react'
import { useRpcMutation } from '../../lib/query'
import { chainFromBrief, isConcept } from './intake'

const options = [
  {
    title: 'Logo outline',
    note: 'Cut the pendant to the logo silhouette and pavé the face, keeping its negative space open.',
  },
  {
    title: 'Raised logo',
    note: 'Set a pavé field inside a smooth plaque and raise the polished logo above it.',
  },
  {
    title: 'Iced border',
    note: 'Keep the logo face polished on a solid medallion and set stones in a single row around its edge.',
  },
]

const field = 'flex min-w-0 flex-col gap-1.5 text-sm'

export function ManualIntake({
  piece,
  boardId,
  references,
}: {
  piece: Piece
  boardId: string
  references: Reference[]
}) {
  const id = useId()
  const [metal, setMetal] = useState('')
  const [stones, setStones] = useState('')
  const [size, setSize] = useState('')
  const [chain, setChain] = useState('')
  const [title, setTitle] = useState('')
  const [idea, setIdea] = useState('')
  const [skipRef, setSkipRef] = useState(false)
  const saved = references.some(isConcept)
  const pendant = piece.kind === 'pendant'
  const fixedChain = chainFromBrief(piece.brief)
  const original = new Set(piece.origin?.sourceAssetIds ?? [])
  const styleRefs = references.filter(
    (r) => r.type === 'image' && r.assetId && !original.has(r.assetId),
  )
  const save = useRpcMutation('references.proposeConcepts', { meta: { silent: true } })
  if (saved) return null

  const submit = () => {
    const details = [
      pendant && (fixedChain || chain.trim() || 'Chain undecided'),
      metal.trim() ? `Metal colour: ${metal.trim()}` : 'Metal colour undecided',
      stones.trim() ? `Stone sizes: ${stones.trim()}` : 'Stone sizes undecided',
      size.trim() ? `Overall size: ${size.trim()}` : 'Overall size undecided',
      styleRefs.length
        ? `Style reference: ${styleRefs
            .map((r) => r.title)
            .join(', ')
            .slice(0, 300)}`
        : 'Continued without a style reference',
    ]
      .filter(Boolean)
      .join('. ')
    save.mutate({
      boardId,
      concepts: (pendant ? options : [{ title: title.trim(), note: idea.trim() }]).map((c) => ({
        ...c,
        note: `${c.note}\n\n${details}.`,
      })),
    })
  }

  return (
    <form
      aria-label="Manual design details"
      className="mt-6 flex flex-col gap-4 border-t border-line pt-5"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div>
        <h2 className="text-base font-medium">Design details</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Add the measurements you know. Blank fields are kept as open decisions.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {pendant &&
          (fixedChain ? (
            <p className="self-end rounded-md border border-line px-3 py-2 text-sm">
              {fixedChain} · from brief
            </p>
          ) : (
            <label className={field} htmlFor={`${id}-chain`}>
              {/\bchain\b/i.test(piece.brief) ? 'Chain style' : 'Chain preference'}
              <Input
                id={`${id}-chain`}
                value={chain}
                onChange={(e) => setChain(e.target.value)}
                maxLength={100}
                placeholder="Cuban, cable, no chain…"
              />
            </label>
          ))}
        <label className={field} htmlFor={`${id}-metal`}>
          Metal colour
          <Input
            id={`${id}-metal`}
            value={metal}
            onChange={(e) => setMetal(e.target.value)}
            maxLength={100}
            placeholder="White gold"
          />
        </label>
        <label className={field} htmlFor={`${id}-stones`}>
          Stone sizes
          <Input
            id={`${id}-stones`}
            value={stones}
            onChange={(e) => setStones(e.target.value)}
            maxLength={150}
            placeholder="1.2 mm round melee"
          />
        </label>
        <label className={field} htmlFor={`${id}-size`}>
          {pendant ? 'Pendant height' : 'Overall size'}
          <Input
            id={`${id}-size`}
            value={size}
            onChange={(e) => setSize(e.target.value)}
            maxLength={150}
            placeholder={pendant ? '32 mm' : 'Size or dimensions'}
          />
        </label>
      </div>
      {!pendant && (
        <div className="grid gap-3">
          <label className={field} htmlFor={`${id}-title`}>
            Concept name
            <Input
              id={`${id}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              required
            />
          </label>
          <label className={field} htmlFor={`${id}-idea`}>
            Concept description
            <Textarea
              id={`${id}-idea`}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              maxLength={1000}
              minRows={2}
              required
            />
          </label>
        </div>
      )}
      {styleRefs.length ? (
        <p className="text-sm text-fg-muted">Style reference saved to Design.</p>
      ) : (
        <div className="grid gap-2 text-sm">
          <p className="text-fg-muted">Add a photo below to show the look you want.</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={skipRef}
              onChange={(e) => setSkipRef(e.target.checked)}
            />
            Continue without a style reference
          </label>
        </div>
      )}
      {save.error && <InlineError message={save.error.message} />}
      <Button
        className="self-start"
        size="sm"
        type="submit"
        variant="primary"
        disabled={
          save.isPending ||
          (!skipRef && styleRefs.length === 0) ||
          (!pendant && (!title.trim() || !idea.trim()))
        }
      >
        {pendant ? 'Show manual concepts' : 'Save concept'}
      </Button>
    </form>
  )
}
