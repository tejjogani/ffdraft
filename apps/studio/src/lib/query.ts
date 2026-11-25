/**
 * TanStack Query on top of the RPC client.
 *
 * Keys are always `['rpc', <command>, <input>]`, so invalidating `['rpc', name]` refreshes every
 * input of that query. Mutations (and server events) invalidate by domain — the command's
 * prefix — through one table, so no call site has to remember what to refresh.
 */
import type { CommandInput, CommandName, CommandOutput } from '@pave/schema'
import { toast } from '@pave/ui'
import {
  MutationCache,
  QueryClient,
  queryOptions,
  type UseMutationOptions,
  type UseQueryOptions,
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { reportPlanLimit } from '../features/plans/plan-limit'
import { type MutationName, type QueryName, RpcError, rpc } from './rpc'

export const rpcKey = <N extends QueryName>(name: N, input?: CommandInput<N>) =>
  input === undefined ? (['rpc', name] as const) : (['rpc', name, input] as const)

export const rpcQuery = <N extends QueryName>(name: N, input: CommandInput<N>) =>
  queryOptions({
    queryKey: rpcKey(name, input),
    queryFn: () => rpc.call(name, input),
  })

const DOMAIN_QUERIES: Record<string, QueryName[]> = {
  session: ['session.get'],
  org: ['session.get', 'org.members', 'org.settings.get', 'assistant.setup.get'],
  collections: ['collections.list', 'pieces.list'],
  pieces: ['pieces.list', 'pieces.get', 'collections.list', 'design.history', 'design.evaluate'],
  // A design change makes earlier takes stale (computed by the server).
  design: ['pieces.get', 'pieces.list', 'design.history', 'design.evaluate', 'renders.list'],
  boards: ['boards.list', 'boards.get', 'pieces.get'],
  references: ['boards.get', 'boards.list'],
  renders: [
    'renders.list',
    'renders.get',
    'pieces.list',
    'scenes.list',
    'renders.estimate',
    'plan.get',
  ],
  scenes: ['scenes.list', 'renders.estimate'],
  models: ['models.list'],
  shots: ['shots.list'],
  production: ['production.list', 'plan.get'],
  plan: ['plan.get'],
  threads: ['threads.list', 'threads.get'],
  runs: ['threads.list', 'threads.get', 'traces.runs', 'traces.run'],
  assistant: ['assistant.setup.get', 'session.get'],
  traces: ['traces.runs', 'traces.run'],
  usage: ['usage.summary'],
}

/** Refresh everything a command (or a server event named like one) may have changed. */
export function invalidateFor(client: QueryClient, commandOrDomain: string): void {
  const domain = commandOrDomain.split('.')[0]!
  for (const q of DOMAIN_QUERIES[domain] ?? [])
    void client.invalidateQueries({ queryKey: rpcKey(q) })
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Client errors (auth, validation, not found) won't fix themselves on retry.
      retry: (count, e) =>
        !(e instanceof RpcError && e.status >= 400 && e.status < 500) && count < 2,
    },
  },
  mutationCache: new MutationCache({
    onError: (e, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return
      // A plan limit is not a failure to report: the upgrade card says it calmly.
      if (reportPlanLimit(e)) return
      toast.error('Couldn’t save that change', e.message)
    },
  }),
})

declare module '@tanstack/react-query' {
  interface Register {
    defaultError: RpcError
    mutationMeta: { silent?: boolean }
  }
}

export function useRpc<N extends QueryName, TData = CommandOutput<N>>(
  name: N,
  input: CommandInput<N>,
  options?: Omit<UseQueryOptions<CommandOutput<N>, RpcError, TData>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({ ...rpcQuery(name, input), ...options } as UseQueryOptions<
    CommandOutput<N>,
    RpcError,
    TData
  >)
}

export function useRpcMutation<N extends MutationName, TContext = unknown>(
  name: N,
  options?: Omit<
    UseMutationOptions<CommandOutput<N>, RpcError, CommandInput<N>, TContext>,
    'mutationFn'
  >,
) {
  const mutationKey = ['rpc', name]
  return useMutation({
    ...options,
    mutationKey,
    mutationFn: (input: CommandInput<N>) => rpc.call(name, input),
    onSettled: (...args) => {
      // With several edits in flight, refetching after the first would overwrite the later
      // optimistic values with stale server state; refresh once, after the last one.
      if (queryClient.isMutating({ mutationKey }) === 1)
        invalidateFor(queryClient, name as CommandName)
      return options?.onSettled?.(...args)
    },
  })
}
