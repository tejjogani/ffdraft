import { FINISHES, GEM_CUTS, GEM_MATERIALS, METALS, type Piece, type Reference } from '@pave/schema'
import { Button, buttonClass, InlineError } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Hammer } from 'lucide-react'
import { useRef, useState } from 'react'
import { useRpc } from '../../lib/query'
import { activeOrg, useSession } from '../../lib/session'
import { newMessageId } from '../assistant/actions'
import { useTakeToCad } from './actions'
import { takeToCadRefusal } from './board'
import { selectedDesignFor, useSelectedDesign } from './selected-design'

function buildPrompt(piece: Piece, reference: Reference) {
  const spec = piece.spec
  const intake = piece.intake?.details
  const confirmed = intake
    ? [
        intake.metal && METALS[intake.metal].label,
        !intake.metal && intake.metalDescription,
        intake.heightMm && `overall height ${intake.heightMm} mm`,
        intake.thicknessMm && `thickness ${intake.thicknessMm} mm`,
        intake.stoneMm && `stone width ${intake.stoneMm} mm`,
        intake.chain,
      ]
        .filter(Boolean)
        .join(', ')
    : ''
  const instructions = [
    `Build the selected design for “${piece.title}” in CAD.`,
    `Use the attached “${reference.title || 'selected image'}” (reference ${reference.id}) for its shape and proportions.`,
    ...(piece.brief.trim() ? [`Client brief: ${piece.brief.trim().slice(0, 2400)}`] : []),
    ...(spec
      ? [
          `Saved specification: ${spec.title}. ${spec.summary}`,
          `Use ${METALS[spec.metal.alloy].label} with ${FINISHES[spec.metal.finish].label.toLowerCase()}.`,
          ...(spec.ring
            ? [`Ring size ${spec.ring.size.system.toUpperCase()} ${spec.ring.size.value}.`]
            : []),
          ...(spec.body ? [`Overall height: ${spec.body.heightMm} mm.`] : []),
          ...spec.stones.map((stone) =>
            [
              stone.count && `${stone.count} ×`,
              stone.carat && `${stone.carat} ct`,
              stone.widthMm && `${stone.widthMm} mm`,
              GEM_CUTS[stone.cut].label,
              GEM_MATERIALS[stone.stone].label,
              stone.setting && `in a ${stone.setting} setting`,
            ]
              .filter(Boolean)
              .join(' '),
          ),
          ...(spec.openQuestions.length ? [`Open decisions: ${spec.openQuestions.join(' ')}`] : []),
        ]
      : []),
    ...(confirmed ? [`Confirmed intake details: ${confirmed}.`] : []),
    ...(spec
      ? [
          'Read the full saved spec for materials, measurements, and constraints. Use confirmed intake details for decisions the spec leaves open.',
        ]
      : []),
    'Ask about missing measurements before building.',
  ]
  return instructions.join('\n\n')
}

export function BuildCadWithClaude({ pieceId }: { pieceId: string }) {
  const session = useSession()
  const role = activeOrg(session)?.role
  const allowed = role !== undefined && role !== 'viewer' && role !== 'guest'
  const assistant = session.capabilities.assistant
  const piece = useRpc('pieces.get', { id: pieceId })
  const choice = useSelectedDesign((state) => state.projects[pieceId])
  const selection = selectedDesignFor(piece.data, choice)
  const board = useRpc(
    'boards.get',
    { id: selection?.boardId ?? '' },
    { enabled: Boolean(selection) },
  )
  const takeToCad = useTakeToCad()
  const retry = useRef<{ prompt: string; id: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [error, setError] = useState('')
  const ownBoard = board.data?.board.pieceId === pieceId ? board.data : undefined
  const reference = ownBoard?.references.find(
    (item) =>
      item.id === selection?.referenceId &&
      (!selection.assetId || item.assetId === selection.assetId),
  )
  const ready = Boolean(piece.data && ownBoard && reference && !takeToCadRefusal(reference))

  if (!allowed) return null
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      {!assistant || ready ? (
        <Button
          variant="primary"
          icon={Hammer}
          disabled={pending}
          onClick={() => {
            if (!assistant) {
              setShowSetup(true)
              return
            }
            if (!piece.data || !ownBoard || !reference || !ready || pending) return
            const prompt = buildPrompt(piece.data, reference)
            if (retry.current?.prompt !== prompt) retry.current = { prompt, id: newMessageId() }
            setError('')
            setPending(true)
            void takeToCad(ownBoard.board, reference, {
              prompt,
              clientMessageId: retry.current.id,
              originalAssets: piece.data.origin?.sourceAssetIds,
              requireClaude: true,
            })
              .then(() => {
                retry.current = null
              })
              .catch((error: unknown) => {
                setError(error instanceof Error ? error.message : 'Try building the design again.')
              })
              .finally(() => setPending(false))
          }}
        >
          {pending ? 'Starting CAD…' : 'Build CAD with Claude'}
        </Button>
      ) : (
        <Link
          to="/pieces/$id/directions"
          params={{ id: pieceId }}
          hash="design-board"
          className={buttonClass({ variant: 'primary' })}
        >
          <Hammer aria-hidden />
          Build CAD with Claude
        </Link>
      )}
      {assistant && !ready && (
        <p className="text-xs text-fg-muted">
          Choose a design image or sketch on the board to build from it.
        </p>
      )}
      {showSetup && !assistant && (
        <p className="text-sm text-fg-muted">
          <Link to="/settings/ai" className="underline underline-offset-2">
            Connect Claude
          </Link>
          {' to build from the selected design. '}
          <Link
            to="/pieces/$id/design"
            params={{ id: pieceId }}
            className="underline underline-offset-2"
          >
            Open manual CAD
          </Link>
        </p>
      )}
      {error && <InlineError message={error} />}
    </div>
  )
}
