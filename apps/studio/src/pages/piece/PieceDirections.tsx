/**
 * The Design stage: the piece's design board, an image-based space of pictures, sketches,
 * notes and models (no 3D). The person, or the Design job, collects ideas here; then a picture
 * goes to CAD ("Take to CAD": the CAD job asks the specs, estimates and builds from it), or CAD
 * starts blank or from a template. The board is the moodboard linked to the piece: it can be
 * unlinked (it lives on in Ideas) or another board linked at any time. The brief and spec the
 * CAD stage reads are below.
 *
 * (The file keeps its name and route, /directions, so links from earlier builds still work.
 * Built parametric variants moved to the CAD stage as "Try variants".)
 */
import type { Board, Piece } from '@pave/schema'
import { TEMPLATES } from '@pave/schema'
import {
  Button,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuSub,
  Segmented,
  Skeleton,
  toast,
} from '@pave/ui'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Grid2x2, Hammer, LayoutTemplate, Link2, Unlink } from 'lucide-react'
import { SectionTitle } from '../../components/Page'
import { SpecCard } from '../../components/SpecCard'
import { DesignBoard } from '../../features/ideate'
import { invalidateFor, queryClient, useRpc, useRpcMutation } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { useCurrentView } from '../../lib/use-current-view'
import { Brief } from './PieceOverview'

/** The piece's boards, the design board first (the oldest linked, as the server picks it). */
const ordered = (boards: Board[]) =>
  boards.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))

export function PieceDirections({ pieceId }: { pieceId: string }) {
  const piece = useRpc('pieces.get', { id: pieceId })
  const linked = useRpc('boards.list', { pieceId })
  const { board: pick } = useSearch({ from: '/pieces/$id' })
  const navigate = useNavigate()
  if (!piece.data || !linked.data)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    )
  const p = piece.data
  const boards = ordered(linked.data)
  const board = boards.find((b) => b.id === pick) ?? boards[0] ?? null
  return (
    <div className="flex flex-col gap-10">
      <SpecCard piece={p} />
      <section aria-label="Design">
        <SectionTitle actions={<StageActions piece={p} board={board} />}>Design board</SectionTitle>
        {boards.length > 1 && (
          <Segmented<string>
            size="sm"
            aria-label="Linked boards"
            className="mb-3"
            value={board!.id}
            onChange={(board) =>
              void navigate({
                to: '/pieces/$id/directions',
                params: { id: pieceId },
                search: { board },
              })
            }
            options={boards.map((b) => ({ value: b.id, label: b.title }))}
          />
        )}
        {board ? <LinkedBoard key={board.id} board={board} /> : <NoBoard piece={p} />}
      </section>
      <section>
        <SectionTitle>Brief</SectionTitle>
        <Brief piece={p} />
      </section>
    </div>
  )
}

function LinkedBoard({ board }: { board: Board }) {
  const data = useRpc('boards.get', { id: board.id })
  if (!data.data) return <Skeleton className="h-80 rounded-lg" />
  return <DesignBoard board={data.data.board} references={data.data.references} />
}

/** No board yet: starting one is the person's choice (opening the tab writes nothing). */
function NoBoard({ piece }: { piece: Piece }) {
  const start = useRpcMutation('boards.forPiece')
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg px-6 py-14 text-center shadow-[inset_0_0_0_1px_var(--line)]">
      <Grid2x2 className="size-6 text-fg-faint" aria-hidden />
      <p className="font-serif text-heading">The design board</p>
      <p className="max-w-md text-sm text-fg-subtle">
        Collect what the piece should be: a picture of the thing to put on it, pieces you like, a
        sketch sheet, a 3D model. Then take one to CAD. Or go straight to CAD, blank or from a
        template.
      </p>
      <Button
        size="sm"
        variant="primary"
        icon={Grid2x2}
        disabled={start.isPending}
        onClick={() => start.mutate({ pieceId: piece.id })}
      >
        Start the design board
      </Button>
    </div>
  )
}

/** Start CAD (blank or from a template) and the board's link to this project. */
function StageActions({ piece, board }: { piece: Piece; board: Board | null }) {
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  const others = useRpc('boards.list', {})
  const unlinked = (others.data ?? []).filter((b) => !b.pieceId)
  const toCad = () => void navigate({ to: '/pieces/$id/design', params: { id: piece.id } })
  const link = async (boardId: string, pieceId: string | null) => {
    await rpc.call('boards.update', { id: boardId, pieceId })
    invalidateFor(queryClient, 'boards')
  }
  const fromTemplate = async (templateId: string) => {
    const t = TEMPLATES.find((x) => x.id === templateId)!
    try {
      await rpc.call('pieces.setSpec', { id: piece.id, spec: t.spec })
      await rpc.call('pieces.buildFromSpec', { id: piece.id })
      invalidateFor(queryClient, 'design')
      if (isCurrent()) toCad()
    } catch (e) {
      toast.error('Couldn’t start from that template', e instanceof Error ? e.message : undefined)
    }
  }
  const hasCad = piece.design.order.length > 0
  return (
    <div className="flex flex-wrap items-center gap-1">
      {board && (
        <Button size="sm" variant="ghost" icon={Unlink} onClick={() => void link(board.id, null)}>
          Unlink board
        </Button>
      )}
      {unlinked.length > 0 && (
        <Menu
          align="end"
          trigger={
            <Button size="sm" variant="ghost" icon={Link2}>
              Link a board
            </Button>
          }
        >
          {unlinked.slice(0, 20).map((b) => (
            <MenuItem key={b.id} onClick={() => void link(b.id, piece.id)}>
              {b.title}
            </MenuItem>
          ))}
        </Menu>
      )}
      <Menu
        align="end"
        trigger={
          <Button size="sm" variant="secondary" icon={Hammer}>
            {hasCad ? 'Open CAD' : 'Start CAD'}
          </Button>
        }
      >
        <MenuItem
          icon={Hammer}
          onClick={toCad}
          description={hasCad ? 'The design as it is' : 'An empty workspace'}
        >
          {hasCad ? 'Open the CAD' : 'Blank CAD'}
        </MenuItem>
        <MenuSeparator />
        <MenuSub
          label={hasCad ? 'Replace with a template' : 'From a template'}
          icon={LayoutTemplate}
        >
          {TEMPLATES.filter((t) => t.spec.kind === piece.kind || hasCad === false).map((t) => (
            <MenuItem key={t.id} onClick={() => void fromTemplate(t.id)}>
              {t.spec.title}
            </MenuItem>
          ))}
        </MenuSub>
      </Menu>
    </div>
  )
}
