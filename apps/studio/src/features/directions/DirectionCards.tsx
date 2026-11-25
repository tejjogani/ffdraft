/**
 * Design directions as cards, side by side: an identical clay preview, the letter and name, the
 * one-line idea, the facts that separate them (metal, carats, stones, a rough cost), the honest
 * trade-off and the canon's notes. Choose makes one the piece's design and opens CAD; Mix
 * builds a new direction from parts of two; the others stay as alternatives.
 *
 * One component for the piece's Design tab (`page`: a grid that stacks on a phone) and the
 * assistant dock (`inline`: a strip that scrolls sideways, so a round still reads side by side
 * in a narrow column).
 */
import { type Direction, MIX_PARTS, type MixPart, type Piece } from '@pave/schema'
import {
  AiChip,
  Button,
  Checkbox,
  Chip,
  cn,
  Dialog,
  IconButton,
  Menu,
  MenuItem,
  Select,
  toast,
} from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { Check, Gem, MoreHorizontal, Shuffle, Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { assetUrl } from '../../lib/assets'
import { metalLabel } from '../../lib/domain'
import { carats, grams, plural } from '../../lib/format'
import { useRpcMutation } from '../../lib/query'

const roughUsd = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const PART_LABEL: Record<MixPart, string> = {
  head: 'Head and hero stones',
  band: 'Band and its stones',
  metal: 'Metal',
  style: 'Style',
}

export function DirectionCards({
  piece,
  directions = piece.directions,
  variant = 'page',
}: {
  piece: Piece
  /** Defaults to all of the piece's; the dock shows those one call proposed. */
  directions?: Direction[]
  variant?: 'page' | 'inline'
}) {
  const navigate = useNavigate()
  const [mixing, setMixing] = useState<Direction | null>(null)
  const choose = useRpcMutation('pieces.chooseDirection', {
    onSuccess: ({ direction }) => {
      toast.success(
        `Direction ${direction.letter} is the design`,
        'Opened in CAD; Undo is in History.',
      )
      void navigate({ to: '/pieces/$id/design', params: { id: piece.id } })
    },
  })
  const remove = useRpcMutation('pieces.removeDirection')
  if (!directions.length) return null
  const inline = variant === 'inline'
  return (
    <>
      <ul
        aria-label="Directions"
        className={cn(
          inline
            ? '-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1'
            : // A phone swipes through them with the next one peeking; wider screens see a grid.
              '-mx-6 flex snap-x scroll-px-6 gap-3 overflow-x-auto px-6 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3',
        )}
      >
        {directions.map((d) => (
          <li
            key={d.id}
            className={cn('shrink-0 snap-start', inline ? 'w-52' : 'w-[80%] sm:w-auto')}
          >
            <DirectionCard
              direction={d}
              chosen={d.id === piece.chosenDirectionId}
              compact={inline}
              busy={choose.isPending}
              canMix={piece.directions.length > 1}
              onChoose={() => choose.mutate({ pieceId: piece.id, directionId: d.id })}
              onMix={() => setMixing(d)}
              onRemove={
                inline || d.id === piece.chosenDirectionId
                  ? undefined
                  : () => remove.mutate({ pieceId: piece.id, directionId: d.id })
              }
            />
          </li>
        ))}
      </ul>
      {mixing && <MixDialog piece={piece} base={mixing} onClose={() => setMixing(null)} />}
    </>
  )
}

function DirectionCard({
  direction: d,
  chosen,
  compact,
  busy,
  canMix,
  onChoose,
  onMix,
  onRemove,
}: {
  direction: Direction
  chosen: boolean
  compact: boolean
  busy: boolean
  canMix: boolean
  onChoose: () => void
  onMix: () => void
  onRemove: (() => void) | undefined
}) {
  const [allNotes, setAllNotes] = useState(false)
  const notes = allNotes ? d.notes : d.notes.slice(0, compact ? 1 : 2)
  const f = d.facts
  const preview = d.previewAssetIds[0]
  return (
    <article
      aria-label={`Direction ${d.letter}: ${d.name}`}
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-lg bg-bg shadow-[0_0_0_1px_var(--line)]',
        chosen && 'shadow-[0_0_0_1.5px_var(--fg)]',
      )}
    >
      {/* The server draws previews on a light ground. In dark mode they sit on the card as a
          mounted print (inset, rounded, a touch dimmer) instead of a glaring full-bleed panel. */}
      <div
        className={cn(
          'stage relative w-full dark:p-1.5',
          compact ? 'aspect-[3/2]' : 'aspect-[4/3]',
        )}
      >
        {preview ? (
          <img
            src={assetUrl(preview, compact ? 320 : 640)}
            alt={`Clay preview of direction ${d.letter}`}
            loading="lazy"
            className="reveal size-full object-contain dark:rounded-md dark:object-cover dark:brightness-[0.88]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-fg-faint">
            <Gem className="size-6" aria-hidden />
          </div>
        )}
        <span className="absolute top-2 left-2 inline-flex size-6 items-center justify-center rounded-md bg-bg text-xs font-semibold shadow-[0_0_0_1px_var(--line)]">
          {d.letter}
        </span>
        {chosen && (
          <Chip
            tone="ok"
            icon={<Check className="size-3" aria-hidden />}
            className="absolute top-2 right-2"
          >
            Chosen
          </Chip>
        )}
      </div>
      <div className={cn('flex flex-1 flex-col gap-2', compact ? 'p-2.5' : 'p-3.5')}>
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-sm leading-5 font-medium">{d.name}</h3>
          {d.origin === 'assistant' ? (
            <AiChip />
          ) : (
            <Chip>
              {d.origin === 'mix' ? 'Mix' : d.origin === 'template' ? 'Template' : 'Yours'}
            </Chip>
          )}
        </div>
        {d.idea && (
          <p className={cn('text-fg-muted', compact ? 'text-xs leading-4' : 'text-sm leading-5')}>
            {d.idea}
          </p>
        )}
        {f ? (
          <dl className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-fg tabular">
            <Fact label="Metal">{grams(f.metalMassG)}</Fact>
            {f.stoneCount > 0 && <Fact label="Stones">{carats(f.caratTotal)}</Fact>}
            {f.stoneCount > 0 && <Fact label="Count">{f.stoneCount}</Fact>}
            {f.costUsd !== null && <Fact label="≈">{roughUsd.format(f.costUsd)}</Fact>}
          </dl>
        ) : (
          <p className="text-xs text-fg-subtle">Facts appear once the CAD engine has run.</p>
        )}
        {!compact && f && (
          <p className="text-2xs text-fg-subtle">
            {metalLabel(f.metal)}
            {f.errors + f.warnings > 0
              ? ` · ${plural(f.errors + f.warnings, 'check')} to fix`
              : ' · checks pass'}
          </p>
        )}
        {d.tradeOff && (
          <p className="text-xs leading-4 text-fg-muted">
            <span className="font-medium text-fg">Trade-off: </span>
            {d.tradeOff}
          </p>
        )}
        {d.basis && <p className="text-2xs text-fg-subtle">Mixed: {d.basis}</p>}
        {notes.length > 0 && (
          <ul className="flex flex-col gap-1 text-2xs leading-4 text-fg-subtle">
            {notes.map((n) => (
              <li key={n} className="line-clamp-3">
                {n}
              </li>
            ))}
            {d.notes.length > notes.length && (
              <li>
                <button
                  type="button"
                  onClick={() => setAllNotes(true)}
                  className="text-fg-muted underline-offset-2 hover:underline"
                >
                  {plural(d.notes.length - notes.length, 'more note')}
                </button>
              </li>
            )}
          </ul>
        )}
        <div className="mt-auto flex items-center gap-1.5 pt-1">
          <Button
            size="sm"
            variant={chosen ? 'secondary' : 'primary'}
            disabled={busy}
            onClick={onChoose}
          >
            {chosen ? 'Choose again' : 'Choose'}
          </Button>
          {canMix && (
            <Button size="sm" variant="ghost" icon={Shuffle} onClick={onMix}>
              Mix…
            </Button>
          )}
          {onRemove && (
            <Menu
              trigger={
                <IconButton
                  icon={MoreHorizontal}
                  label={`More for direction ${d.letter}`}
                  className="ml-auto"
                />
              }
              align="end"
            >
              <MenuItem icon={Trash2} danger onClick={onRemove}>
                Remove direction
              </MenuItem>
            </Menu>
          )}
        </div>
      </div>
    </article>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="font-sans text-fg-subtle">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** "The band of B with the head of A": start from one direction, take parts of another. */
function MixDialog({
  piece,
  base,
  onClose,
}: {
  piece: Piece
  base: Direction
  onClose: () => void
}) {
  const others = piece.directions.filter((d) => d.id !== base.id)
  const [from, setFrom] = useState<string>(others[0]?.id ?? '')
  const [parts, setParts] = useState<MixPart[]>(['band'])
  const mix = useRpcMutation('pieces.proposeDirections', {
    onSuccess: ({ directions }) => {
      const made = directions[0]
      if (made) toast.success(`Mixed into direction ${made.letter}`)
      onClose()
    },
  })
  const donor = others.find((d) => d.id === from)
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Mix with ${base.letter}: ${base.name}`}
      description={`Start from ${base.letter} and take parts of another direction. The ring size stays ${base.letter}’s.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!donor || parts.length === 0 || mix.isPending}
            onClick={() =>
              mix.mutate({
                pieceId: piece.id,
                directions: [{ mix: { base: base.id, take: [{ from, parts }] } }],
              })
            }
          >
            {mix.isPending ? 'Building…' : 'Build the mix'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-muted" aria-hidden>
            Take from
          </span>
          <Select
            value={from}
            onChange={setFrom}
            aria-label="Direction to take parts from"
            options={others.map((d) => ({ value: d.id, label: `${d.letter}: ${d.name}` }))}
          />
        </div>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1.5 text-fg-muted">Its parts</legend>
          {MIX_PARTS.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <Checkbox
                id={`mix-part-${p}`}
                checked={parts.includes(p)}
                onChange={(on) => setParts((xs) => (on ? [...xs, p] : xs.filter((x) => x !== p)))}
              />
              <label htmlFor={`mix-part-${p}`}>{PART_LABEL[p]}</label>
            </div>
          ))}
        </fieldset>
      </div>
    </Dialog>
  )
}
