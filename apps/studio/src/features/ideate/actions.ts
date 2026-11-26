/**
 * The design board's actions, shared by the piece's Design tab and the studio moodboards: adding
 * what the person brings (files, links, notes, sketches), taking a picture to CAD and opening a
 * 3D model as CAD. Each is one command or a short, ordered chain of them.
 */
import type { Board, CommandInput, Reference } from '@pave/schema'
import { toast } from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { uploadAsset } from '../../lib/assets'
import { invalidateFor, queryClient } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { useSession } from '../../lib/session'
import { useCurrentView } from '../../lib/use-current-view'
import { openAssistant, useAssistant } from '../../stores/assistant'
import { useSend } from '../assistant/actions'
import { resolveProjectThread } from '../assistant/project-thread'
import { useReferencePanel } from '../references/store'
import { classifyBoardFile, TAKE_TO_CAD_GOAL, takeToCadRefusal } from './board'

const refresh = () => {
  invalidateFor(queryClient, 'boards')
  invalidateFor(queryClient, 'references')
}

export type BoardTarget = { boardId: string } | { pieceId: string }

async function saveReferences(
  target: BoardTarget,
  items: CommandInput<'references.save'>['items'],
) {
  if (!items.length) return []
  const saved =
    'boardId' in target
      ? await rpc.call('references.save', { ...target, items })
      : await rpc.call('references.saveForPiece', { ...target, items })
  refresh()
  return saved
}

/** Files dropped, pasted or picked: pictures and sketch sheets, and 3D models. */
export async function addFiles(target: BoardTarget, files: readonly File[]): Promise<Reference[]> {
  const items: { assetId: string; title: string }[] = []
  for (const file of files) {
    const kind = classifyBoardFile(file.name || (file.type.startsWith('image/') ? 'paste.png' : ''))
    if (!kind) {
      toast.error(
        `${file.name} is not a picture or a 3D model`,
        'Add photos, scans, STL, OBJ, GLB, 3MF or PLY.',
      )
      continue
    }
    if (kind === 'step')
      toast({
        title: `${file.name} is kept on the board`,
        description: 'STEP files can’t be shown or opened as CAD yet; that is planned.',
      })
    const named = file.name ? file : new File([file], 'pasted.png', { type: file.type })
    const asset = await uploadAsset(named)
    items.push({ assetId: asset.id, title: named.name.replace(/\.[^.]+$/, '') })
  }
  return saveReferences(target, items)
}

/** Pasted or dropped web addresses: kept as view-only links (a Pinterest pin, a Google result). */
export async function addLinks(target: BoardTarget, urls: readonly string[]): Promise<Reference[]> {
  if (!urls.length) return []
  // Named after the site until someone renames it ("pinterest.com").
  const out = await saveReferences(
    target,
    urls.map((url) => ({ url, title: siteOf(url) })),
  )
  toast({
    title: urls.length === 1 ? 'Link added' : `${urls.length} links added`,
    description: 'Kept as view-only inspiration. Capture its image to show it on the board.',
  })
  return out
}

const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'A link'
  }
}

export async function addNote(target: BoardTarget, note: string): Promise<void> {
  await saveReferences(target, [{ note }])
}

export async function addSketch(target: BoardTarget, file: File, title: string): Promise<void> {
  const asset = await uploadAsset(file)
  await saveReferences(target, [
    { assetId: asset.id, title, rights: 'own', note: 'Sketched in Pavé' },
  ])
}

export async function captureLink(ref: Reference): Promise<void> {
  await rpc.call('references.capture', { id: ref.id })
  refresh()
}

export async function removeReference(ref: Reference): Promise<void> {
  await rpc.call('references.remove', { ids: [ref.id] })
  refresh()
}

/**
 * The project a board's picture goes to: the board's linked piece, else a new one linked to
 * a copy from the studio moodboard.
 */
async function projectFor(board: Board): Promise<string> {
  if (board.pieceId) return board.pieceId
  const piece = await rpc.call('pieces.create', { title: board.title.replace(/ · Design$/, '') })
  await rpc.call('boards.importMoodboard', { sourceBoardId: board.id, pieceId: piece.id })
  invalidateFor(queryClient, 'pieces')
  refresh()
  return piece.id
}

/**
 * Take to CAD: the picture is pinned beside the piece's CAD, the CAD job starts from it (it
 * asks the specs, shows an estimate and builds), and CAD opens with the assistant beside it.
 * Without a Claude key the picture is laid in the front view to model over by hand.
 */
export function useTakeToCad() {
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  const { capabilities } = useSession()
  const { send } = useSend({ stage: 'design' })
  return async (
    board: Board,
    ref: Reference,
    options?: {
      prompt: string
      originalAssets?: string[]
      requireClaude: boolean
      clientMessageId?: string
    },
  ) => {
    try {
      const refusal = takeToCadRefusal(ref)
      if (refusal) throw new Error(refusal)
      if (options?.requireClaude && !capabilities.assistant)
        throw new Error('Connect Claude to build this design.')
      const pieceId = await projectFor(board)
      const prompt = options?.prompt ?? TAKE_TO_CAD_GOAL
      if (!isCurrent()) return
      if (capabilities.assistant) openAssistant({ pieceId, draft: prompt })
      const { pin, assetId } = await rpc.call('pieces.takeToCad', { pieceId, referenceId: ref.id })
      invalidateFor(queryClient, 'references')
      if (!isCurrent()) return
      if (capabilities.assistant) {
        const threadId = await resolveProjectThread(pieceId)
        if (!isCurrent()) return
        const out = await send(prompt, {
          job: { stage: 'cad', goal: TAKE_TO_CAD_GOAL },
          threadId,
          pieceId,
          boardId: board.pieceId === pieceId ? board.id : undefined,
          bare: true,
          referenceIds: [ref.id],
          clientMessageId: options?.clientMessageId,
          attachments: [...new Set([assetId, ...(options?.originalAssets ?? [])])].slice(0, 8),
        })
        if (!isCurrent()) return
        const { draft } = useAssistant.getState()
        openAssistant({ pieceId, threadId: out.thread.id, draft: draft === prompt ? '' : draft })
      } else {
        useReferencePanel.getState().setPlaceRequest({ pieceId, refId: pin.id, view: 'front' })
        toast({
          title: 'The picture is beside CAD',
          description:
            'Model over it by hand, or add a Claude key in Settings › AI to build from it.',
        })
      }
      await navigate({ to: '/pieces/$id/design', params: { id: pieceId } })
    } catch (e) {
      if (options?.requireClaude) throw e
      toast.error('Couldn’t take it to CAD', e instanceof Error ? e.message : undefined)
    }
  }
}

/** Open as CAD: the model becomes a sculpted body in the project's CAD (a new project when the board has none). */
export function useOpenAsCad() {
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  return async (board: Board, ref: Reference) => {
    if (!ref.assetId) return
    try {
      const { piece } = await rpc.call('pieces.openAsCad', {
        assetId: ref.assetId,
        ...(board.pieceId ? { pieceId: board.pieceId } : { title: ref.title || undefined }),
      })
      if (!board.pieceId)
        await rpc.call('boards.importMoodboard', { sourceBoardId: board.id, pieceId: piece.id })
      invalidateFor(queryClient, 'pieces')
      invalidateFor(queryClient, 'design')
      refresh()
      if (isCurrent()) await navigate({ to: '/pieces/$id/design', params: { id: piece.id } })
    } catch (e) {
      toast.error('Couldn’t open it as CAD', e instanceof Error ? e.message : undefined)
    }
  }
}
