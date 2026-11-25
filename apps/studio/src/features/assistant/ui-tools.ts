/**
 * The assistant's view of the window: `ui.context` (where the designer is and what is selected,
 * to resolve "this" and "here") and `ui.navigate` (show them a piece or a board). Served by every
 * signed-in window for as long as the shell is mounted, unlike the viewport tools, which only a
 * piece's open CAD tab can serve.
 */
import type { Piece } from '@pave/schema'
import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { registerClientTool } from '../../lib/client-tools'
import { getDesignSession } from '../../lib/design-session/store'
import { queryClient, rpcKey } from '../../lib/query'
import { useWorkspace } from '../cad/state/workspace'
import { placeOf, tabPath } from './place'

export function useUiTools(): void {
  const router = useRouter()
  useEffect(() => {
    const offContext = registerClientTool('ui.context', async () => {
      const route = router.state.location.pathname
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
        sceneId: null,
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
        await router.navigate({ to: `/ideas/${encodeURIComponent(input.boardId)}` })
      return { ok: true as const }
    })
    return () => {
      offContext()
      offNavigate()
    }
  }, [router])
}
