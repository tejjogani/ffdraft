/** Piece mutations with optimistic updates, shared by every page that edits pieces. */
import type { CommandInput, Piece, PieceSummary } from '@pave/schema'
import { toast } from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { queryClient, rpcKey, useRpcMutation } from './query'
import { useCurrentView } from './use-current-view'

type Update = CommandInput<'pieces.update'>
type Snapshot = Array<[readonly unknown[], unknown]>

const patchOf = (u: Update): Partial<PieceSummary> => {
  const { id: _id, ...rest } = u
  return Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as Partial<PieceSummary>
}

/** Title, stage, collection and brief edits show instantly and roll back on failure. */
export function useUpdatePiece() {
  return useRpcMutation<'pieces.update', Snapshot>('pieces.update', {
    onMutate: async (u) => {
      const patch = patchOf(u)
      await queryClient.cancelQueries({ queryKey: rpcKey('pieces.get') })
      await queryClient.cancelQueries({ queryKey: rpcKey('pieces.list') })
      const snapshot: Snapshot = [
        ...queryClient.getQueriesData({ queryKey: rpcKey('pieces.get') }),
        ...queryClient.getQueriesData({ queryKey: rpcKey('pieces.list') }),
      ]
      queryClient.setQueriesData<Piece>(
        { queryKey: rpcKey('pieces.get', { id: u.id }) },
        (p) => p && { ...p, ...patch },
      )
      queryClient.setQueriesData<PieceSummary[]>({ queryKey: rpcKey('pieces.list') }, (list) =>
        list?.map((p) => (p.id === u.id ? { ...p, ...patch } : p)),
      )
      return snapshot
    },
    onError: (_e, _u, snapshot) => {
      for (const [key, data] of snapshot ?? []) queryClient.setQueryData(key, data)
    },
  })
}

/** Create a piece and open it. */
export function useCreatePiece() {
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  return useRpcMutation('pieces.create', {
    onMutate: () => isCurrent,
    onSuccess: (piece, _input, stillHere) =>
      stillHere?.() && void navigate({ to: '/pieces/$id', params: { id: piece.id } }),
  })
}

export function useDeletePiece(leaveProject: boolean) {
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  return useRpcMutation('pieces.delete', {
    onMutate: () => isCurrent,
    onSuccess: (_out, _input, stillHere) => {
      toast({ title: 'Project deleted' })
      if (leaveProject && stillHere?.()) void navigate({ to: '/pieces' })
    },
  })
}
