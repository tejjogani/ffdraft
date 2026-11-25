/**
 * Settings, AI → Image generation: each provider's key (with the Claude key's rules), its model
 * and price per image, the organisation's default provider and quality, and this month's image
 * spend. Generating also needs the Claude key: Claude writes the prompt and checks every image.
 */
import type { ImageProviderId, ImageQuality, KeyedImageProvider } from '@pave/schema'
import { Chip, Segmented, Select, Skeleton, toast } from '@pave/ui'
import { usd } from '../../lib/format'
import { useRpc, useRpcMutation } from '../../lib/query'
import { SettingsGroup, SettingsRow } from '../../pages/settings/SettingsLayout'
import { useIsAdmin } from '../assistant/KeyForm'
import { ImageKeyForm, Notice } from './ImageKeyForm'

const QUALITY_WORDS: Record<ImageQuality, string> = {
  draft: 'Draft',
  standard: 'Standard',
  high: 'High',
}

export const perImage = (v: number) => (v < 0.01 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`)

export function ImageSettings() {
  const admin = useIsAdmin()
  const setup = useRpc('images.setup.get', {})
  const update = useRpcMutation('images.settings.update', {
    meta: { silent: true },
    onError: (e) => toast.error('Couldn’t save that', e.message),
  })
  if (!setup.data) return <Skeleton className="h-48" />
  const s = setup.data
  const usable = s.providers.filter((p) => p.configured)

  return (
    <>
      <section className="mb-10" aria-labelledby="image-providers">
        <h2 id="image-providers" className="mb-1 text-sm font-medium">
          Image generation
        </h2>
        <p className="mb-3 text-xs text-fg-subtle">
          Concept images on the design board. Claude reads each request, writes the prompt and
          checks every image before it is kept; the provider below draws them. Prices are per image
          at the quality chosen.
        </p>
        {!s.claudeReady && (
          <div className="mb-3">
            <Notice tone="warn">
              Generating also needs the Claude API key above: Claude writes the prompt and checks
              every image.
            </Notice>
          </div>
        )}
        {s.testMode && (
          <div className="mb-3">
            <Notice tone="warn">
              Test mode: a fake provider draws test pictures (PAVE_IMAGE_GEN is set on the server).
            </Notice>
          </div>
        )}
        <div className="divide-y divide-line border-y border-line">
          {s.providers
            .filter((p) => p.id !== 'fake')
            .map((p) => (
              <div
                key={p.id}
                data-image-provider={p.id}
                className="grid grid-cols-1 gap-x-6 gap-y-3 py-4 md:grid-cols-[1fr_minmax(0,1.4fr)]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {p.label}
                    {s.defaultProvider === p.id && <Chip>Default</Chip>}
                    {p.key.source === 'env' && <Chip tone="warn">Set in .env</Chip>}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-fg-subtle">{p.keyHelp}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Select<string>
                      aria-label={`${p.label} model`}
                      className="w-full max-w-60"
                      value={p.model}
                      disabled={!admin || p.models.length < 2}
                      options={p.models.map((m) => ({ value: m.id, label: m.label }))}
                      onChange={(model) =>
                        update.mutate({ models: { [p.id as KeyedImageProvider]: model } })
                      }
                    />
                    <span className="font-mono text-xs text-fg-muted tabular">
                      {perImage(p.models.find((m) => m.id === p.model)?.perImageUsd ?? 0)} an image
                    </span>
                  </div>
                  <p className="mt-1.5 text-2xs leading-4 text-fg-subtle">{p.priceNote}</p>
                  {p.notes.map((n) => (
                    <p key={n} className="mt-1 text-2xs leading-4 text-fg-subtle">
                      {n}
                    </p>
                  ))}
                </div>
                <ImageKeyForm provider={p} />
              </div>
            ))}
        </div>
      </section>

      <SettingsGroup title="Concept images">
        <SettingsRow
          label="Default provider"
          description={
            usable.length
              ? 'What a board uses unless it picks another.'
              : 'Add a provider’s key above first.'
          }
        >
          <Select<ImageProviderId>
            aria-label="Default image provider"
            className="w-48"
            value={s.defaultProvider ?? usable[0]?.id ?? 'gemini'}
            disabled={!admin || usable.length === 0}
            options={(usable.length ? usable : s.providers.slice(0, 1)).map((p) => ({
              value: p.id,
              label: p.label,
            }))}
            onChange={(defaultProvider) => update.mutate({ defaultProvider })}
          />
        </SettingsRow>
        <SettingsRow label="Quality" description="Draft is the cheapest the provider offers.">
          <Segmented<ImageQuality>
            aria-label="Image quality"
            value={s.quality}
            disabled={!admin}
            onChange={(quality) => update.mutate({ quality })}
            options={(['draft', 'standard', 'high'] as const).map((q) => ({
              value: q,
              label: QUALITY_WORDS[q],
            }))}
          />
        </SettingsRow>
        {s.monthSpendUsd !== null && (
          <SettingsRow
            label="This month"
            description="Images generated by everyone in the organisation."
          >
            <span className="font-mono text-sm tabular">{usd(s.monthSpendUsd)}</span>
          </SettingsRow>
        )}
      </SettingsGroup>
    </>
  )
}
