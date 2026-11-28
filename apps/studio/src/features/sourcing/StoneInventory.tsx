import type {
  CommandInput,
  CommandOutput,
  DiaexCutId,
  GemDims,
  NodeOf,
  SourcedDiamond,
  StoneChange,
} from '@pave/schema'
import { SourcingCadTargetSchema, stoneDims } from '@pave/schema'
import {
  Button,
  buttonClass,
  Chip,
  controlClass,
  Field,
  InlineError,
  Input,
  Skeleton,
  toast,
} from '@pave/ui'
import { ArrowUpRight } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { carats, num } from '../../lib/format'
import { useRpc, useRpcMutation } from '../../lib/query'
import { RpcError, rpc } from '../../lib/rpc'
import { factRows } from '../assistant/replace-stone'
import { diaexBrowseLink } from './links'

const COLORS = [...'DEFGHIJKLMNOPQRSTUVWXYZ']
const HUES = [
  'Yellow',
  'Pink',
  'Blue',
  'Green',
  'Orange',
  'Brown',
  'Purple',
  'Red',
  'Gray',
  'Violet',
]
const DIAEX_BROWSE = 'https://thediaex.com/browse'

export const dimensions = ({ length, width, depth }: GemDims) =>
  `${num(length)} × ${num(width)} × ${num(depth)} mm`

function changeFor(stone: SourcedDiamond): StoneChange | null {
  const hue = stone.fancyHue
  const color = hue ?? stone.color
  if (hue && hue !== 'Yellow' && hue !== 'Pink') return null
  if (!hue && color && !COLORS.includes(color)) return null
  return {
    fit: {
      provider: 'diaex',
      sku: stone.sku,
      url: stone.url,
      measured: stone.measured,
      listedCarat: stone.carat,
      ...(stone.certificate ? { certificate: stone.certificate } : {}),
    },
    stone:
      hue === 'Yellow'
        ? 'diamond-yellow'
        : hue === 'Pink'
          ? 'diamond-pink'
          : stone.origin === 'lab'
            ? 'diamond-lab'
            : 'diamond',
    quality: {
      origin: stone.origin,
      colors: color ? [color] : [],
      clarities: stone.clarity && stone.clarity.length <= 6 ? [stone.clarity] : [],
      certified: Boolean(stone.certificate),
    },
  }
}

interface FitPreview {
  stone: SourcedDiamond
  change: StoneChange
  result: CommandOutput<'design.replaceStone'>
  changeId: string
}

function changeId() {
  return `chg_${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')}`
}

function changedListing(a: SourcedDiamond, b: SourcedDiamond): boolean {
  return (
    a.sku !== b.sku ||
    a.url !== b.url ||
    a.origin !== b.origin ||
    a.color !== b.color ||
    a.fancyHue !== b.fancyHue ||
    a.clarity !== b.clarity ||
    a.certificate !== b.certificate ||
    a.carat !== b.carat ||
    a.measured.length !== b.measured.length ||
    a.measured.width !== b.measured.width ||
    a.measured.depth !== b.measured.depth
  )
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Try again.'

export function StoneInventory({
  pieceId,
  version,
  diamond,
  canFit,
  searchCut,
  onFit,
}: {
  pieceId: string
  version: number
  diamond: NodeOf<'gem' | 'meshBody'>
  searchCut?: DiaexCutId
  canFit: boolean
  onFit?(): void
}) {
  const nodeId = diamond.id
  const [submitted, setSubmitted] = useState<
    Pick<CommandInput<'sourcing.search'>, 'color' | 'sku' | 'publicBrowse'>
  >({ publicBrowse: !searchCut })
  const [color, setColor] = useState('')
  const [entry, setEntry] = useState('')
  const [activeSku, setActiveSku] = useState<string | null>(null)
  const [preview, setPreview] = useState<FitPreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [actionError, setActionError] = useState('')
  const [reviewNotice, setReviewNotice] = useState('')

  const search = useRpc(
    'sourcing.search',
    { pieceId, nodeId, ...(searchCut && { searchCut }), ...submitted },
    {
      retry: false,
      staleTime: 0,
      refetchOnMount: 'always',
    },
  )
  const apply = useRpcMutation('design.replaceStone', { meta: { silent: true } })
  const revert = useRpcMutation('design.revert')
  const browse =
    diaexBrowseLink(search.error?.details.searchUrl ?? search.data?.searchUrl)?.href ?? DIAEX_BROWSE
  const cadTarget =
    search.data?.cadTarget ??
    SourcingCadTargetSchema.safeParse(search.error?.details.cadTarget).data
  const locked = Boolean(busy || search.isFetching)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setActiveSku(null)
    setPreview(null)
    setReviewNotice('')
    setActionError('')
    const text = entry.trim()
    const fromLink = /^https?:/i.test(text)
    const sku = fromLink ? diaexBrowseLink(text)?.searchParams.get('stone') : text
    if (fromLink && !sku) {
      setActionError('Paste a Diaex stone link or its public ID.')
      return
    }
    const next = sku ? { sku } : color ? { color } : {}
    if (submitted.publicBrowse && next.sku === submitted.sku && next.color === submitted.color)
      void search.refetch()
    else setSubmitted({ ...next, publicBrowse: true })
  }

  async function previewStone(stone: SourcedDiamond) {
    const change = changeFor(stone)
    if (!change)
      throw new Error(
        'Pavé can fit white, yellow and pink diamonds. Open this listing in Diaex to view it.',
      )
    const result = await rpc.call('design.replaceStone', {
      pieceId,
      target: { nodeId },
      change,
      dryRun: true,
    })
    setPreview({ stone, change, result, changeId: changeId() })
  }

  async function inspect(stone: SourcedDiamond) {
    setActiveSku(stone.sku)
    setBusy('preview')
    setPreview(null)
    setActionError('')
    setReviewNotice('')
    try {
      await previewStone(stone)
    } catch (error) {
      setActionError(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  async function fit() {
    if (!preview) return
    setBusy('apply')
    setActionError('')
    setReviewNotice('')
    try {
      const current = await rpc.call('sourcing.stone', {
        pieceId,
        nodeId,
        sku: preview.stone.sku,
        publicBrowse: true,
      })
      if (changedListing(preview.stone, current)) {
        setPreview(null)
        await previewStone(current)
        setReviewNotice('Diaex updated this listing. Review the new fit before applying it.')
        return
      }
      const result = await apply.mutateAsync({
        pieceId,
        target: { nodeId },
        change: preview.change,
        baseVersion: preview.result.version,
        changeId: preview.changeId,
      })
      if (result.change) {
        const seq = result.change.seq
        const notice = toast({
          title: 'Diamond fitted',
          description: preview.stone.sku,
          type: 'success',
          action: {
            label: 'Undo',
            onClick: () => {
              toast.dismiss(notice)
              revert.mutate({ pieceId, seq })
            },
          },
        })
      }
      onFit?.()
    } catch (error) {
      if (error instanceof RpcError && typeof error.details.currentVersion === 'number') {
        setPreview(null)
        setActionError('The design changed. Preview the fit again.')
      } else setActionError(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const candidates = search.isSuccess ? search.data.candidates : []
  return (
    <div
      className={
        searchCut
          ? 'mt-4 border-t border-line pt-4'
          : 'mt-4 rounded-lg border border-line bg-bg-subtle px-3 py-4 sm:px-4'
      }
    >
      {cadTarget && (
        <p className="mb-3 text-sm text-fg">
          CAD measurements <span className="font-medium tabular">{dimensions(cadTarget)}</span>
          <span className="ml-2 text-xs text-fg-muted">Length × width × depth</span>
        </p>
      )}
      <form
        onSubmit={submit}
        className="grid items-end gap-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(10rem,2fr)_auto]"
      >
        <Field label="Color grade">
          {(id) => (
            <select
              id={id}
              value={color}
              onChange={(e) => setColor(e.target.value)}
              disabled={locked}
              className={controlClass}
            >
              <option value="">{searchCut ? 'Any color' : 'Use design color'}</option>
              <optgroup label="White diamond">
                {COLORS.map((grade) => (
                  <option key={grade}>{grade}</option>
                ))}
              </optgroup>
              <optgroup label="Fancy color">
                {HUES.map((hue) => (
                  <option key={hue}>{hue}</option>
                ))}
              </optgroup>
            </select>
          )}
        </Field>
        <Field label="Diaex public ID or link">
          {(id) => (
            <Input
              id={id}
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder="Paste a stone ID or link"
              maxLength={512}
              disabled={locked}
            />
          )}
        </Field>
        <Button type="submit" disabled={locked}>
          Search inventory
        </Button>
      </form>
      {(!searchCut || (cadTarget && !search.isFetching)) && (
        <a
          href={browse}
          target="_blank"
          rel="noreferrer"
          className={
            searchCut
              ? `${buttonClass({ size: 'sm', variant: 'secondary' })} mt-3`
              : 'mt-3 inline-flex items-center gap-1 text-sm text-fg-muted underline decoration-line-strong underline-offset-2 hover:text-fg'
          }
        >
          Browse Diaex
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
      )}
      {search.isError && <InlineError message={search.error.message} />}
      {search.isFetching && (
        <Skeleton
          aria-label={submitted.publicBrowse ? 'Searching Diaex' : 'Measuring stone'}
          className="mt-4 h-10 w-full"
        />
      )}
      {search.isSuccess && !search.isFetching && candidates.length === 0 && (
        <p role="status" className="mt-4 text-sm text-fg-muted">
          {submitted.publicBrowse
            ? 'No available diamonds match this search.'
            : 'Choose Search inventory to compare available diamonds at these dimensions.'}
        </p>
      )}
      {candidates.length > 0 && (
        <ol
          aria-label="Diamond candidates"
          className="mt-4 divide-y divide-line border-y border-line"
        >
          {candidates.map((stone, index) => {
            const listing = diaexBrowseLink(stone.url)
            return (
              <li key={stone.sku} className="px-1 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {listing ? (
                        <a
                          href={listing.href}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all text-sm font-medium text-fg underline decoration-line-strong underline-offset-2"
                        >
                          {stone.sku}
                        </a>
                      ) : (
                        <span className="break-all text-sm font-medium text-fg">{stone.sku}</span>
                      )}
                      {index === 0 && <Chip tone="select">Recommended</Chip>}
                    </div>
                    <p className="mt-1 text-xs text-fg-muted tabular">
                      {[
                        dimensions(stone.measured),
                        carats(stone.carat),
                        stone.color,
                        stone.clarity,
                        stone.origin === 'lab'
                          ? 'Lab-grown'
                          : stone.origin === 'natural'
                            ? 'Natural'
                            : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {canFit && (
                    <Button
                      size="sm"
                      disabled={locked}
                      aria-expanded={activeSku === stone.sku}
                      onClick={() => void inspect(stone)}
                    >
                      Preview {stone.sku}
                    </Button>
                  )}
                </div>
                {activeSku === stone.sku && (
                  <>
                    {busy === 'preview' && (
                      <p role="status" className="mt-3 text-sm text-fg-muted">
                        Calculating the new seat…
                      </p>
                    )}
                    {reviewNotice && (
                      <p role="status" className="mt-3 text-sm text-fg-muted">
                        {reviewNotice}
                      </p>
                    )}
                    {canFit && diamond.kind === 'gem' && preview && (
                      <Preview
                        plan={preview}
                        original={stoneDims(diamond)}
                        stale={busy !== 'apply' && preview.result.version !== version}
                        busy={busy === 'apply'}
                        onFit={() => void fit()}
                      />
                    )}
                    {actionError && <InlineError message={actionError} />}
                  </>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {!activeSku && actionError && <InlineError message={actionError} />}
    </div>
  )
}

function Preview({
  plan,
  original,
  stale,
  busy,
  onFit,
}: {
  plan: FitPreview
  original: GemDims
  stale: boolean
  busy: boolean
  onFit(): void
}) {
  const { result, stone } = plan
  const facts = result.before && result.after ? factRows(result.before, result.after) : []
  const notes = [
    ...result.notes.filter((note) => !note.startsWith('Fitted to ')),
    ...result.warnings.map((warning) => warning.message),
    ...result.diagnostics.added.map((diagnostic) => diagnostic.message),
    ...result.diagnostics.resolved.map((diagnostic) => `Resolved: ${diagnostic.message}`),
  ]
  return (
    <section aria-label="Fit preview" className="mt-4 border-t border-line pt-4">
      <h4 className="text-sm font-medium text-fg">Seat preview · {stone.sku}</h4>
      <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">Current stone</dt>
          <dd className="mt-1 text-fg tabular">{dimensions(original)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Diaex measurements</dt>
          <dd className="mt-1 text-fg tabular">{dimensions(stone.measured)}</dd>
        </div>
      </dl>
      {facts.length > 0 && (
        <ul className="mt-3 text-xs text-fg-muted tabular">
          {facts.map((row) => (
            <li key={row.label}>
              {row.label} {row.before} → {row.after}
              {row.delta && ` (${row.delta})`}
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-fg-muted">
          {[...new Set(notes)].map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {stale && <InlineError message="The design changed. Preview the fit again." />}
      {result.ops.length ? (
        <Button variant="primary" className="mt-4" disabled={busy || stale} onClick={onFit}>
          {busy ? 'Checking availability…' : 'Fit this stone'}
        </Button>
      ) : (
        <p role="status" className="mt-4 text-sm text-fg-muted">
          This diamond is already fitted.
        </p>
      )}
    </section>
  )
}
