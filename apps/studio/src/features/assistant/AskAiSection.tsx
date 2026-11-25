/**
 * The last section of every context menu: the deterministic quick edits for what was clicked
 * (Replace stone…, Change metal, Make it bigger / smaller), then "Ask AI about this…". It takes
 * the subject and nothing else, so any menu in the app can end with it: the design comes from
 * the piece's live session when one is open, else from the piece itself.
 *
 * The quick edits never need the assistant: they are the schema's pure intents applied as one
 * undoable change. "Ask AI" opens the assistant on the piece with what was clicked as the
 * selection (openAssistant), on the piece's own page so the message is about that piece; without
 * a Claude key the assistant opens on the form that connects one, and the row says so.
 */
import { type Design, METAL_IDS, METALS, type MetalId } from '@pave/schema'
import {
  AiMark,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  Swatch,
} from '@pave/ui'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Gem, Maximize2, Minimize2, Palette } from 'lucide-react'
import { useLiveSession, useSessionState } from '../../lib/design-session/store'
import { useRpc } from '../../lib/query'
import { activeOrg, useSession } from '../../lib/session'
import { openAssistant } from '../../stores/assistant'
import { applyEdit, useQuickIntent } from './quick-intent-store'
import {
  askAi,
  askAiRequest,
  metalOps,
  type QuickIntent,
  quickIntents,
  type Subject,
} from './quick-intents'

/** The piece's design as this window shows it. */
export function usePieceDesign(pieceId: string): Design | null {
  const session = useLiveSession(pieceId)
  const live = useSessionState(session, (s) => s.view)
  const piece = useRpc('pieces.get', { id: pieceId }, { enabled: !session })
  return live ?? piece.data?.design ?? null
}

export function useReadOnly(): boolean {
  const role = activeOrg(useSession())?.role ?? 'viewer'
  return role === 'viewer' || role === 'guest'
}

const ICON = { replaceStone: Gem, bigger: Maximize2, smaller: Minimize2, changeMetal: Palette }

export function AskAiSection({ subject }: { subject: Subject }) {
  const auth = useSession()
  const readOnly = useReadOnly()
  const design = usePieceDesign(subject.pieceId)
  const intents = design ? quickIntents(subject, design, { readOnly }) : []
  const ask = askAi(subject, auth.capabilities)
  const navigate = useNavigate()
  const path = useRouterState({ select: (s) => s.location.pathname })

  const run = (intent: QuickIntent) => {
    if (intent.id === 'replaceStone' && subject.type === 'stone')
      useQuickIntent.getState().replaceStone(subject)
    else if (intent.edit) void applyEdit(subject.pieceId, intent.edit.ops, intent.edit.label)
  }

  return (
    <>
      <MenuSeparator />
      {intents.map((intent) =>
        intent.id === 'changeMetal' && intent.metal && !intent.disabled && design ? (
          <MetalMenu
            key={intent.id}
            label={intent.label}
            {...(intent.hint ? { hint: intent.hint } : {})}
            current={intent.metal.current}
            onPick={(metal) => {
              const ops = metalOps(design, intent.metal!.nodeIds, metal)
              void applyEdit(subject.pieceId, ops, `Metal: ${METALS[metal].label}`)
            }}
          />
        ) : (
          <MenuItem
            key={intent.id}
            icon={ICON[intent.id]}
            disabled={!!intent.disabled}
            description={intent.disabled ?? intent.hint}
            onClick={() => run(intent)}
          >
            {intent.label}
          </MenuItem>
        ),
      )}
      <MenuItem
        leading={<AiMark className="size-4" />}
        description={ask.hint}
        onClick={() => {
          // A message goes about the page's piece: from another page (a sidebar row), open the
          // piece first, staying on its stage tab when already there.
          const piecePath = `/pieces/${subject.pieceId}`
          if (path !== piecePath && !path.startsWith(`${piecePath}/`))
            void navigate({ to: '/pieces/$id', params: { id: subject.pieceId } })
          openAssistant(askAiRequest(subject))
        }}
      >
        {ask.label}
      </MenuItem>
    </>
  )
}

function MetalMenu({
  label,
  hint,
  current,
  onPick,
}: {
  label: string
  /** The metal it is in now, as the second line. */
  hint?: string
  current: MetalId | null
  onPick(metal: MetalId): void
}) {
  return (
    <MenuSub label={label} icon={Palette} {...(hint ? { description: hint } : {})}>
      <MenuRadioGroup value={current ?? ''} onChange={(v) => onPick(v as MetalId)}>
        {METAL_IDS.map((id) => (
          <MenuRadioItem
            key={id}
            value={id}
            closeOnClick
            leading={<Swatch color={METALS[id].swatch} kind="metal" size="sm" />}
          >
            {METALS[id].label}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </MenuSub>
  )
}
