import { queryClient, rpcQuery } from '../../lib/query'
import { RpcError, rpc } from '../../lib/rpc'
import { useAssistant } from '../../stores/assistant'

export const latestProjectThread = (pieceId: string) => ({ pieceId, limit: 1 })

/** Select a server-verified thread without opening the dock or moving its draft. */
export function selectProjectThread(pieceId: string, threadId: string) {
  useAssistant.setState({ activeThreadId: threadId, threadPieceId: pieceId })
}

/** An explicit same-project selection comes first. Reloads resolve to the server's latest. */
export async function resolveProjectThread(pieceId: string): Promise<string | null> {
  const { activeThreadId, threadPieceId } = useAssistant.getState()
  if (activeThreadId && threadPieceId === pieceId) {
    try {
      const { thread } = await queryClient.fetchQuery(
        rpcQuery('threads.get', { id: activeThreadId }),
      )
      if (thread.context.pieceId === pieceId) return thread.id
    } catch (error) {
      if (!(error instanceof RpcError) || error.status !== 404) throw error
    }
  }
  const [thread] = await rpc.call('threads.list', latestProjectThread(pieceId))
  return thread?.context.pieceId === pieceId ? thread.id : null
}
