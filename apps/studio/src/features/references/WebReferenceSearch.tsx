import { Button, buttonClass, Input } from '@pave/ui'
import { ExternalLink } from 'lucide-react'
import { useId, useState } from 'react'

const providers = [
  ['Google Images', 'https://www.google.com/search?tbm=isch'],
  ['Pinterest', 'https://www.pinterest.com/search/pins/'],
] as const

export function WebReferenceSearch({
  onSave,
  saveLabel = 'Save link',
  busy = false,
}: {
  onSave?: (url: string) => Promise<void>
  saveLabel?: string
  busy?: boolean
}) {
  const queryId = useId()
  const linkId = useId()
  const [query, setQuery] = useState('')
  const [link, setLink] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const term = query.trim()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor={queryId} className="flex flex-col gap-1.5 text-sm font-medium">
          Search terms
          <Input
            id={queryId}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Oval bezel ring, engraved signet…"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {providers.map(([name, address]) => {
            if (!term)
              return (
                <Button key={name} size="sm" disabled>
                  {name}
                </Button>
              )
            const url = new URL(address)
            url.searchParams.set('q', term)
            return (
              <a
                key={name}
                className={buttonClass({ size: 'sm' })}
                href={url.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-description="Opens in a new tab"
              >
                {name}
                <ExternalLink aria-hidden />
              </a>
            )
          })}
        </div>
      </div>
      {onSave && (
        <form
          className="flex flex-col gap-2 border-t border-line pt-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (saving || busy) return
            setError('')
            const address = link.trim()
            if (!/^https?:\/\//i.test(address)) {
              setError('Enter a web address that starts with https:// or http://.')
              return
            }
            setSaving(true)
            try {
              await onSave(address)
              setLink('')
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Couldn’t save the link.')
            } finally {
              setSaving(false)
            }
          }}
        >
          <label htmlFor={linkId} className="flex flex-col gap-1.5 text-sm font-medium">
            Reference link
            <Input
              id={linkId}
              type="url"
              value={link}
              onChange={(e) => {
                setLink(e.target.value)
                setError('')
              }}
              placeholder="Paste the link you chose"
            />
          </label>
          <p className="text-xs text-fg-muted">
            Search opens in a new tab. Paste a result here to keep it as a view-only reference.
          </p>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <Button
            size="sm"
            type="submit"
            className="self-start"
            disabled={!link.trim() || saving || busy}
          >
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </form>
      )}
    </div>
  )
}
