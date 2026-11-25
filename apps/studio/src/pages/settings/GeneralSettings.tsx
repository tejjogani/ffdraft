import { Avatar, Segmented, useTheme } from '@pave/ui'
import { Laptop, Moon, Sun } from 'lucide-react'
import { PerformanceControl } from '../../components/stage/QualityIndicator'
import { activeOrg, useSession } from '../../lib/session'
import { PERFORMANCE_WORDS, usePerformance } from '../../stores/performance'
import { SettingsGroup, SettingsRow, SettingsTitle } from './SettingsLayout'

export function GeneralSettings() {
  const session = useSession()
  const org = activeOrg(session)
  const { preference, setTheme } = useTheme()
  const performance = usePerformance((s) => s.mode)
  return (
    <>
      <SettingsTitle
        title="General"
        description="Your workspace, and how Pavé looks and performs on this device."
      />
      <SettingsGroup title="Workspace">
        <SettingsRow label="Name" description="Shown in the sidebar and on production packages.">
          <span className="flex items-center gap-2 text-sm">
            <Avatar name={org?.name ?? ''} src={org?.logo} size="sm" shape="square" />
            {org?.name}
          </span>
        </SettingsRow>
        <SettingsRow label="URL slug">
          <span className="font-mono text-xs text-fg-muted">{org?.slug}</span>
        </SettingsRow>
        <SettingsRow label="Your role">
          <span className="text-sm capitalize text-fg-muted">{org?.role}</span>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Appearance">
        <SettingsRow label="Theme" description="Follows your system unless you choose otherwise.">
          <Segmented
            aria-label="Theme"
            size="md"
            value={preference}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'System', icon: Laptop },
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon },
            ]}
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Performance">
        <SettingsRow
          label="3D views"
          description={`${PERFORMANCE_WORDS[performance].blurb} Applies to the CAD view and the Render tab’s live preview on this device. Renders are not affected.`}
        >
          <PerformanceControl />
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}
