/**
 * The assistant's view of the window: `ui.context` (where the designer is and what is selected,
 * to resolve "this" and "here") and `ui.navigate` (show them a piece or a board). Served by every
 * signed-in window for as long as the shell is mounted, unlike the viewport tools, which only a
 * piece's open CAD tab can serve.
 */
import type { Piece, SavedScene } from '@pave/schema'
import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { registerClientTool } from '../../lib/client-tools'
import { getDesignSession } from '../../lib/design-session/store'
import { queryClient, rpcKey } from '../../lib/query'
import { useWorkspace } from '../cad/state/workspace'
import { placeOf, renderShotId, tabPath } from './place'

export function currentRenderShot(
  location: { pathname: string; search: Record<string, unknown> },
  pieceId: string | null | undefined,
): string | null {
  const place = placeOf(location.pathname)
  if (!pieceId || place.pieceId !== pieceId || place.tab !== 'render') return null
  const saved = queryClient.getQueryData<SavedScene[]>(rpcKey('scenes.list', { pieceId })) ?? []
  return renderShotId(place, location.search.shot, saved)
}

export function useUiTools(): void {
  const router = useRouter()
  useEffect(() => {
    const offContext = registerClientTool('ui.context', async () => {
      const location = router.state.location
      const route = location.pathname
      const { pieceId, tab, boardId } = placeOf(route)
      const ws = useWorkspace.getState()
      const version = pieceId
        ? (getDesignSession(pieceId)?.get().version ??
          queryClient.getQueryData<Piece>(rpcKey('pieces.get', { id: pieceId }))?.version ??
          null)
        : null
      return {
        route,
        pieceId,
        tab,
        boardId,
        sceneId: currentRenderShot(location, pieceId),
        selection: pieceId && ws.pieceId === pieceId ? ws.selection : [],
        version,
      }
    })
    const offNavigate = registerClientTool('ui.navigate', async (input) => {
      if (input.pieceId) {
        const ids = input.selectNodeIds ?? []
        if (ids.length) {
          // Selected before the page opens; opening the same piece keeps the selection.
          const ws = useWorkspace.getState()
          ws.open(input.pieceId)
          ws.select(ids)
        }
        const tab = input.tab ?? (ids.length ? 'design' : 'overview')
        await router.navigate({ to: `/pieces/${encodeURIComponent(input.pieceId)}${tabPath(tab)}` })
      } else if (input.boardId)
        await router.navigate({ to: `/moodboards/${encodeURIComponent(input.boardId)}` })
      return { ok: true as const }
    })
    return () => {
      offContext()
      offNavigate()
    }
  }, [router])
}
