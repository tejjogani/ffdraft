/**
 * Where a reference comes from, in words: the source, the credit line, the licence (linked),
 * when its picture was kept, and what its rights tier allows as one sentence. Shown for search
 * results before anything is saved, and for pins.
 */
import { RIGHTS_SENTENCE, type Rights } from '@pave/schema'
import { Chip, IconButton, Popover, Tooltip } from '@pave/ui'
import { ExternalLink, Info } from 'lucide-react'

export const PROVIDER_LABEL: Record<string, string> = {
  met: 'The Met',
  aic: 'Art Institute of Chicago',
  cleveland: 'Cleveland Museum of Art',
  web: 'The web',
  upload: 'Uploaded',
}

export const providerLabel = (id: string | null | undefined) =>
  id ? (PROVIDER_LABEL[id] ?? id) : 'Unknown source'

export const RIGHTS_LABEL: Record<Rights, string> = {
  open: 'Open access',
  licensed: 'Licensed',
  own: 'Yours',
  viewOnly: 'View only',
}

/** The rights tier at a glance; hovering gives the sentence (also in the provenance popover). */
export function RightsChip({ rights }: { rights: Rights }) {
  return (
    <Tooltip content={RIGHTS_SENTENCE[rights]}>
      <Chip tone={rights === 'viewOnly' ? 'warn' : rights === 'open' ? 'ok' : 'neutral'}>
        {RIGHTS_LABEL[rights]}
      </Chip>
    </Tooltip>
  )
}

export interface ProvenanceFacts {
  title: string
  provider: string | null
  url: string | null
  credit: string | null
  license: string | null
  licenseUrl?: string | null
  capturedAt?: string | null
  rights: Rights
}

/** Only web addresses become links: a provider's answer is not trusted to be one. */
const safeHref = (url: string | null | undefined) =>
  url && /^https?:\/\//i.test(url) ? url : undefined

export function ProvenanceFacts({ facts }: { facts: ProvenanceFacts }) {
  const page = safeHref(facts.url)
  const licence = safeHref(facts.licenseUrl)
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      <dt className="text-fg-subtle">Source</dt>
      <dd className="min-w-0">
        {page ? (
          <a
            href={page}
            target="_blank"
            rel="noreferrer noopener"
            referrerPolicy="no-referrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            {providerLabel(facts.provider)} <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : (
          providerLabel(facts.provider)
        )}
      </dd>
      {facts.credit && (
        <>
          <dt className="text-fg-subtle">Credit</dt>
          <dd className="min-w-0 break-words">{facts.credit}</dd>
        </>
      )}
      <dt className="text-fg-subtle">Licence</dt>
      <dd className="min-w-0 break-words">
        {licence ? (
          <a
            href={licence}
            target="_blank"
            rel="noreferrer noopener"
            className="underline-offset-2 hover:underline"
          >
            {facts.license ?? 'Terms'}
          </a>
        ) : (
          (facts.license ?? 'Not stated')
        )}
      </dd>
      {facts.capturedAt && (
        <>
          <dt className="text-fg-subtle">Kept</dt>
          <dd>{new Date(facts.capturedAt).toLocaleDateString()}</dd>
        </>
      )}
      <dt className="text-fg-subtle">Rights</dt>
      <dd className="min-w-0" data-rights={facts.rights}>
        {RIGHTS_SENTENCE[facts.rights]}
      </dd>
    </dl>
  )
}

/** The (i) button that opens a reference's provenance. */
export function ProvenanceButton({ facts }: { facts: ProvenanceFacts }) {
  return (
    <Popover
      title={`Where “${facts.title}” comes from`}
      side="left"
      align="start"
      className="w-72 bg-bg! backdrop-blur-none!"
      trigger={
        <IconButton
          icon={Info}
          label={`Where “${facts.title || 'this'}” comes from`}
          size="sm"
          className="size-6"
        />
      }
    >
      <p className="mb-2 text-sm font-medium">{facts.title || 'Untitled'}</p>
      <ProvenanceFacts facts={facts} />
    </Popover>
  )
}
