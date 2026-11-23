import { Avatar, Segmented, useTheme } from '@pave/ui'
import { Laptop, Moon, Sun } from 'lucide-react'
import { activeOrg, useSession } from '../../lib/session'
import { SettingsGroup, SettingsRow, SettingsTitle } from './SettingsLayout'

export function GeneralSettings() {
  const session = useSession()
  const org = activeOrg(session)
  const { preference, setTheme } = useTheme()
  return (
    <>
      <SettingsTitle
        title="General"
        description="Your workspace and how Pavé looks on this device."
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
    </>
  )
}
