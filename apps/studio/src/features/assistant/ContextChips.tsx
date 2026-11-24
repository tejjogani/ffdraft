/**
 * What the next message is about, as removable chips above the composer: the page's piece or
 * board, and the parts of the piece the person pointed at (Ask AI, or mod+j in the CAD stage).
 */
import { nodeTitle } from '@pave/schema'
import { Chip } from '@pave/ui'
import { Boxes, Gem, LayoutGrid, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useRpc } from '../../lib/query'
import { type AssistantContext, useAssistant } from '../../stores/assistant'

function Removable({
  icon,
  label,
  onRemove,
  children,
}: {
  icon: ReactNode
  label: string
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <Chip outline className="max-w-full pr-0.5" icon={icon}>
      <span className="max-w-44 truncate">{children}</span>
      <button
        type="button"
        aria-label={`Remove ${label} from the message`}
        onClick={onRemove}
        className="inline-flex size-4 items-center justify-center rounded-xs hover:bg-bg-hover"
      >
        <X aria-hidden />
      </button>
    </Chip>
  )
}

export function ContextChips({ page }: { page: AssistantContext }) {
  const drop = useAssistant((s) => s.dropPageContext)
  const setDrop = useAssistant((s) => s.setDropPageContext)
  const selection = useAssistant((s) => s.selection)
  const setSelection = useAssistant((s) => s.setSelection)
  const pieceId = (!drop && page.pieceId) || selection?.pieceId || null
  const piece = useRpc('pieces.get', { id: pieceId ?? '' }, { enabled: !!pieceId })
  const board = useRpc(
    'boards.get',
    { id: page.boardId ?? '' },
    { enabled: !!page.boardId && !drop },
  )

  const parts =
    selection && piece.data
      ? selection.nodeIds.map((raw) => {
          const [id, index] = raw.split(':')
          const node = piece.data.design.nodes[id!]
          const title = node ? nodeTitle(node) : id!
          return index !== undefined ? `${title} (stone ${Number(index) + 1})` : title
        })
      : []

  return (
    <>
      {!drop && page.pieceId && piece.data && (
        <Removable icon={<Gem aria-hidden />} label="the piece" onRemove={() => setDrop(true)}>
          {piece.data.title || 'Untitled piece'}
        </Removable>
      )}
      {!drop && page.boardId && board.data && (
        <Removable
          icon={<LayoutGrid aria-hidden />}
          label="the board"
          onRemove={() => setDrop(true)}
        >
          {board.data.board.title}
        </Removable>
      )}
      {selection && parts.length > 0 && (
        <Removable
          icon={<Boxes aria-hidden />}
          label="the selected parts"
          onRemove={() => setSelection(null)}
        >
          {parts.length > 2
            ? `${parts.slice(0, 2).join(', ')} +${parts.length - 2}`
            : parts.join(', ')}
        </Removable>
      )}
    </>
  )
}
