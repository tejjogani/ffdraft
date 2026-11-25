/**
 * Settings, AI: the Claude API key (entered here, kept on the server), the three tiers with the
 * model each runs on and what it costs, the tier a new conversation starts on, and this month's
 * AI spend. Values set in apps/server/.env win over these and are shown as such.
 */
import type { AssistantModelId, AssistantTier } from '@pave/schema'
import { Chip, Segmented, Select, Skeleton, toast } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { KeyForm, useIsAdmin } from '../../features/assistant/KeyForm'
import { ImageSettings } from '../../features/images/ImageSettings'
import { usd } from '../../lib/format'
import { useRpc, useRpcMutation } from '../../lib/query'
import { SettingsGroup, SettingsRow, SettingsTitle } from './SettingsLayout'

const perMillion = (v: number) => `$${v < 1 ? v.toFixed(2) : v.toFixed(v % 1 ? 2 : 0)}`

export function AiSettings() {
  const admin = useIsAdmin()
  const setup = useRpc('assistant.setup.get', {})
  const update = useRpcMutation('org.settings.update', {
    meta: { silent: true },
    onError: (e) => toast.error('Couldn’t save that', e.message),
  })

  return (
    <>
      <SettingsTitle
        title="AI"
        description="The assistant runs on Claude with your organisation’s API key. Pick how much model each kind of work gets."
      />
      <SettingsGroup title="Claude API key">
        <div className="py-4">
          <KeyForm />
        </div>
      </SettingsGroup>

      {!setup.data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <section className="mb-10">
            <h2 className="mb-1 text-sm font-medium">Tiers</h2>
            <p className="mb-3 text-xs text-fg-subtle">
              The composer lets each conversation pick a tier. Prices are per million tokens (input
              / output); a typical design run is a rough guide, not a quote.
            </p>
            <div className="divide-y divide-line border-y border-line">
              {setup.data.tiers.map((t) => {
                const fromEnv = t.source === 'env'
                return (
                  <div
                    key={t.tier}
                    className="grid grid-cols-1 gap-x-6 gap-y-2 py-3.5 sm:grid-cols-[1fr_220px_150px]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        {t.label}
                        {setup.data.defaultTier.tier === t.tier && <Chip>Default</Chip>}
                        {fromEnv && <Chip tone="warn">Set in .env</Chip>}
                      </div>
                      <div className="mt-0.5 text-xs text-fg-subtle">{t.blurb}</div>
                    </div>
                    <div>
                      <Select<AssistantModelId>
                        aria-label={`${t.label} model`}
                        className="w-full"
                        value={t.model}
                        disabled={!admin || fromEnv}
                        options={setup.data.models.map((m) => ({
                          value: m.id,
                          label: m.label,
                        }))}
                        onChange={(model) =>
                          update.mutate({ assistantModels: { [t.tier]: model } })
                        }
                      />
                      {setup.data.models.find((m) => m.id === t.model)?.needsRetention && (
                        <p className="mt-1 text-2xs leading-4 text-fg-subtle">
                          Needs 30-day data retention on your Anthropic organisation.
                        </p>
                      )}
                    </div>
                    <div className="text-xs leading-5 text-fg-muted sm:text-right">
                      <div className="font-mono tabular">
                        {perMillion(t.price.input)} / {perMillion(t.price.output)}
                        {t.model === 'claude-haiku-5-5' && (
                          <span className="font-sans text-fg-subtle"> to 100K</span>
                        )}
                      </div>
                      <div>about {usd(t.typicalRunUsd)} a run</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <SettingsGroup title="New conversations">
            <SettingsRow
              label="Default tier"
              description={
                setup.data.defaultTier.source === 'env'
                  ? 'Set by PAVE_ASSISTANT_TIER in apps/server/.env.'
                  : 'What the composer picks until someone chooses another.'
              }
            >
              <Segmented<AssistantTier>
                aria-label="Default tier"
                value={setup.data.defaultTier.tier}
                disabled={!admin || setup.data.defaultTier.source === 'env'}
                onChange={(tier) => update.mutate({ assistantTier: tier })}
                options={setup.data.tiers.map((t) => ({ value: t.tier, label: t.label }))}
              />
            </SettingsRow>
          </SettingsGroup>

          {setup.data.monthSpendUsd !== null && (
            <SettingsGroup title="Spend">
              <SettingsRow
                label="This month"
                description="Claude usage by everyone in the organisation, this calendar month."
              >
                <span className="font-mono text-sm tabular">{usd(setup.data.monthSpendUsd)}</span>
                <Link to="/settings/usage" className="text-xs text-fg-muted hover:underline">
                  Usage
                </Link>
              </SettingsRow>
            </SettingsGroup>
          )}

          <ImageSettings />

          {(setup.data.envOverrides.length > 0 || setup.data.warnings.length > 0) && (
            <SettingsGroup title="From apps/server/.env">
              <div className="flex flex-col gap-2 py-3.5 text-sm">
                {setup.data.envOverrides.length > 0 && (
                  <p className="text-fg-muted">
                    These are set in the server’s .env file and win over the settings above:{' '}
                    {setup.data.envOverrides.map((name, i) => (
                      <span key={name}>
                        {i > 0 && ', '}
                        <code className="font-mono text-xs">{name}</code>
                      </span>
                    ))}
                    .
                  </p>
                )}
                {setup.data.warnings.map((w) => (
                  <p key={w} className="text-warn">
                    {w}
                  </p>
                ))}
              </div>
            </SettingsGroup>
          )}
        </>
      )}
    </>
  )
}
