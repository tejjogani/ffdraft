import type { Capabilities } from '@pave/schema'
import { Chip, InlineError } from '@pave/ui'
import { Blend, Box, Gem, ImagePlus, type LucideIcon, Search, Sparkles } from 'lucide-react'
import { useSession } from '../../lib/session'
import { SettingsTitle } from './SettingsLayout'

interface Integration {
  key: keyof Capabilities
  title: string
  description: string
  icon: LucideIcon
}

const INTEGRATIONS: Integration[] = [
  {
    key: 'assistant',
    title: 'Assistant',
    description: 'Plans pieces, edits CAD and runs tools on your behalf.',
    icon: Sparkles,
  },
  {
    key: 'imageGeneration',
    title: 'Image generation',
    description: 'Concept images conditioned on your moodboards.',
    icon: ImagePlus,
  },
  {
    key: 'mesh3d',
    title: '3D generation',
    description: 'Sculpted bodies from images or prompts for iced pieces.',
    icon: Box,
  },
  {
    key: 'blender',
    title: 'Blender',
    description: 'Photoreal renders through a local or cloud Blender worker.',
    icon: Blend,
  },
  {
    key: 'sourcing',
    title: 'Diaex sourcing',
    description: 'Live stone inventory matched to your designs’ lots.',
    icon: Gem,
  },
]

/** Which optional capabilities this deployment has credentials for. */
export function IntegrationsSettings() {
  const { capabilities } = useSession()
  return (
    <>
      <SettingsTitle
        title="Integrations"
        description="Optional services this deployment can use. Keys are configured on the server."
      />
      {!capabilities ? (
        <InlineError message="Capabilities unavailable." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {INTEGRATIONS.map(({ key, title, description, icon: Icon }) => {
            const value = capabilities[key]
            const providers = Array.isArray(value) ? value : []
            const connected = Array.isArray(value) ? value.length > 0 : value
            return (
              <article
                key={key}
                className="flex flex-col rounded-lg p-4 shadow-[0_0_0_1px_var(--line)]"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-md bg-bg-muted">
                    <Icon className="size-4 text-fg-muted" aria-hidden />
                  </span>
                  <h3 className="flex-1 text-sm font-medium">{title}</h3>
                  {connected ? <Chip tone="ok">Connected</Chip> : <Chip outline>Not set up</Chip>}
                </div>
                <p className="mt-2.5 flex-1 text-xs leading-5 text-fg-muted">{description}</p>
                <div className="mt-3 text-xs text-fg-subtle">
                  {connected ? (
                    providers.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {providers.map((p) => (
                          <Chip key={p} outline>
                            {p}
                          </Chip>
                        ))}
                      </span>
                    ) : (
                      'Ready'
                    )
                  ) : (
                    'Add its API key to the server’s environment to enable it.'
                  )}
                </div>
              </article>
            )
          })}
          <WebSearchSlot />
        </div>
      )}
    </>
  )
}

function WebSearchSlot() {
  return (
    <article className="flex flex-col rounded-lg p-4 shadow-[0_0_0_1px_var(--line)]">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-md bg-bg-muted">
          <Search className="size-4 text-fg-muted" aria-hidden />
        </span>
        <h3 className="flex-1 text-sm font-medium">Web image search</h3>
      </div>
      <p className="mt-2.5 text-xs leading-5 text-fg-muted">
        Google Images and Pinterest open in a new tab from the design board and reference panel.
        Save a link you choose as a view-only reference.
      </p>
    </article>
  )
}
