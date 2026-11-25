/**
 * The quick intents as palette commands on the selection ("Replace stone…", "Make it bigger"),
 * so every menu row is also reachable from ⌘K. Titles are fixed and the edit is worked out when
 * the command runs, so a slider scrub does not re-plan stones on every frame.
 */
import type { Evaluation } from '@pave/kernel'
import type { Design } from '@pave/schema'
import { Gem, Maximize2, Minimize2 } from 'lucide-react'
import { type Command, useRegisterCommands } from '../../lib/commands'
import { applyEdit, useQuickIntent } from '../assistant/quick-intent-store'
import { type QuickIntentId, quickIntents, subjectFor } from '../assistant/quick-intents'
import { useWorkspace } from './state/workspace'

const COMMANDS: { id: QuickIntentId; title: string; icon: typeof Gem }[] = [
  { id: 'replaceStone', title: 'Replace selected stone…', icon: Gem },
  { id: 'bigger', title: 'Make the selection one size bigger', icon: Maximize2 },
  { id: 'smaller', title: 'Make the selection one size smaller', icon: Minimize2 },
]

export function useQuickIntentCommands(
  pieceId: string,
  design: Design,
  evaluation: Evaluation | null,
  readOnly: boolean,
): void {
  const ws = useWorkspace.getState
  const intentsNow = () => {
    const { selection, stone } = ws()
    if (selection.length !== 1 || !design.nodes[selection[0]!]) return null
    const pick = { nodeId: selection[0]!, ...(stone ? { stoneId: stone } : {}) }
    const subject = subjectFor(pieceId, design, pick, evaluation)
    return { subject, intents: quickIntents(subject, design, { readOnly }) }
  }
  const commands: Command[] = COMMANDS.map(({ id, title, icon }) => ({
    id: `design.quick.${id}`,
    title,
    group: 'Design',
    icon,
    keywords: ['stone', 'size', 'cut', 'carat'],
    // Cheap enough per palette open: a selection of one stone or part, and the intent allowed.
    when: () => {
      const now = intentsNow()
      const intent = now?.intents.find((i) => i.id === id)
      return !!intent && !intent.disabled
    },
    run: () => {
      const now = intentsNow()
      const intent = now?.intents.find((i) => i.id === id)
      if (!now || !intent || intent.disabled) return
      if (id === 'replaceStone' && now.subject.type === 'stone')
        useQuickIntent.getState().replaceStone(now.subject)
      else if (intent.edit) void applyEdit(pieceId, intent.edit.ops, intent.edit.label)
    },
  }))
  useRegisterCommands(commands)
}
