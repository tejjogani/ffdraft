import { AiMark, CommandPalette, type PaletteItem } from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { Folder } from 'lucide-react'
import { useMemo } from 'react'
import { StageIcon } from '../components/StageChip'
import { assistantUnavailable } from '../features/assistant/quick-intents'
import { type CommandGroup, isAvailable, useCommands } from '../lib/commands'
import { STAGE_LABEL } from '../lib/domain'
import { useRpc } from '../lib/query'
import { useSession } from '../lib/session'
import { assistant } from '../stores/assistant'
import { useUI } from '../stores/ui'

const ORDER: (CommandGroup | 'Pieces' | 'Collections')[] = [
  'Pieces',
  'Create',
  'Navigate',
  'Collections',
  'Design',
  'Assistant',
  'View',
  'Preferences',
]

/** ⌘K: registry commands plus jump-to items for recent pieces and collections. */
export function Palette() {
  const open = useUI((s) => s.paletteOpen)
  const setOpen = useUI((s) => s.setPaletteOpen)
  const navigate = useNavigate()
  const auth = useSession()
  const commands = useCommands()
  const pieces = useRpc('pieces.list', { limit: 30 }, { enabled: open })
  const collections = useRpc('collections.list', {}, { enabled: open })

  // Read each command's `when` while rendering, so availability is current whenever the palette opens.
  const available = open ? commands.filter((c) => !c.hidden && isAvailable(c)) : []
  const availableKey = available.map((c) => c.id).join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `availableKey` stands for `available`
  const items = useMemo<PaletteItem[]>(
    () => [
      ...available.map((c) => ({
        id: c.id,
        title: c.title,
        group: c.group,
        icon: c.icon,
        shortcut: c.shortcut,
        keywords: c.keywords,
        onSelect: c.run,
      })),
      ...[...(pieces.data ?? [])]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8)
        .map((p) => ({
          id: `piece:${p.id}`,
          title: p.title || 'Untitled',
          group: 'Pieces',
          icon: <StageIcon stage={p.stage} />,
          hint: STAGE_LABEL[p.stage],
          keywords: [p.kind],
          onSelect: () => void navigate({ to: '/pieces/$id', params: { id: p.id } }),
        })),
      ...(collections.data ?? []).map((c) => ({
        id: `collection:${c.id}`,
        title: c.name,
        group: 'Collections',
        icon: c.icon ? (
          <span className="w-4 text-center text-sm leading-none">{c.icon}</span>
        ) : (
          Folder
        ),
        onSelect: () => void navigate({ to: '/collections/$id', params: { id: c.id } }),
      })),
    ],
    [availableKey, pieces.data, collections.data, navigate],
  )

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      items={items}
      groupOrder={ORDER}
      placeholder="Search pieces, run a command, or ask…"
      fallback={(q) => {
        // The same reason the menus' "Ask AI about this…" row gives while the assistant cannot answer.
        const disabled = assistantUnavailable(auth.capabilities)
        return {
          title: `Ask the assistant: “${q}”`,
          icon: <AiMark className="size-3.5" />,
          onSelect: () => assistant.open({ prompt: q }),
          ...(disabled ? { disabled } : {}),
        }
      }}
    />
  )
}
