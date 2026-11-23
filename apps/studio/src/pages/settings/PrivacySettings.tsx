import { InlineError, Select, Skeleton, Switch } from '@pave/ui'
import { useRpc, useRpcMutation } from '../../lib/query'
import { activeOrg, useSession } from '../../lib/session'
import { SettingsGroup, SettingsRow, SettingsTitle } from './SettingsLayout'

const RETENTION = [
  { value: '0', label: 'Don’t keep traces' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: '3650', label: '10 years' },
]

export function PrivacySettings() {
  const session = useSession()
  const role = activeOrg(session)?.role
  const canEdit = role === 'owner' || role === 'admin'
  const settings = useRpc('org.settings.get', {})
  const update = useRpcMutation('org.settings.update')
  return (
    <>
      <SettingsTitle
        title="Data & privacy"
        description="How long assistant traces are kept and what they may be used for."
      />
      {settings.isError ? (
        <InlineError message={settings.error.message} onRetry={() => void settings.refetch()} />
      ) : settings.isPending ? (
        <Skeleton className="h-32" />
      ) : (
        <SettingsGroup>
          <SettingsRow
            label="Trace retention"
            description="Runs, steps and messages older than this are deleted. Edit history is kept."
          >
            <Select
              aria-label="Trace retention"
              disabled={!canEdit}
              value={String(settings.data.traceRetentionDays)}
              options={
                RETENTION.some((r) => r.value === String(settings.data.traceRetentionDays))
                  ? RETENTION
                  : [
                      ...RETENTION,
                      {
                        value: String(settings.data.traceRetentionDays),
                        label: `${settings.data.traceRetentionDays} days`,
                      },
                    ]
              }
              onChange={(v) => update.mutate({ traceRetentionDays: Number(v) })}
              className="w-44"
            />
          </SettingsRow>
          <SettingsRow
            label="Help improve Pavé"
            description="Allow anonymised traces to be used for evaluating and improving the assistant. Off by default."
          >
            <Switch
              aria-label="Allow evaluation use"
              disabled={!canEdit}
              checked={settings.data.allowEvalUse}
              onChange={(allowEvalUse) => update.mutate({ allowEvalUse })}
            />
          </SettingsRow>
        </SettingsGroup>
      )}
    </>
  )
}
