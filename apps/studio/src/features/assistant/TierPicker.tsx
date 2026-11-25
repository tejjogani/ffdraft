/**
 * The composer's tier picker: Power, Standard or Light for this conversation, each with the model
 * it runs on underneath. "Default" follows the organisation's default tier.
 */
import type { AssistantTier } from '@pave/schema'
import { cn, Menu, MenuItem } from '@pave/ui'
import { Check, ChevronDown } from 'lucide-react'
import { useRpc } from '../../lib/query'

export function TierPicker({
  value,
  onChange,
}: {
  /** The tier picked; null follows the organisation's default. */
  value: AssistantTier | null
  onChange: (tier: AssistantTier) => void
}) {
  const setup = useRpc('assistant.setup.get', {})
  if (!setup.data) return null
  const effective = value ?? setup.data.defaultTier.tier
  const current = setup.data.tiers.find((t) => t.tier === effective)
  return (
    <Menu
      align="start"
      side="top"
      trigger={
        <button
          type="button"
          aria-label={`Model tier: ${current?.label ?? effective}`}
          className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-xs text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
        >
          {current?.label}
          <ChevronDown className="size-3" aria-hidden />
        </button>
      }
    >
      {setup.data.tiers.map((t) => (
        <MenuItem
          key={t.tier}
          leading={
            <Check
              aria-hidden
              className={cn('size-3.5', t.tier === effective ? 'opacity-100' : 'opacity-0')}
            />
          }
          description={`${t.modelLabel}${t.tier === setup.data.defaultTier.tier ? ' · default' : ''}`}
          onClick={() => onChange(t.tier)}
        >
          {t.label}
        </MenuItem>
      ))}
    </Menu>
  )
}
