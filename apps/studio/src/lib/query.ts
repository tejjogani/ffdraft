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
  collections: ['collections.list', 'pieces.list', 'projects.summary'],
  pieces: [
    'pieces.list',
    'pieces.get',
    'collections.list',
    'design.history',
    'design.evaluate',
    'pieces.estimate',
    'projects.summary',
  ],
  // A design change makes earlier takes stale (computed by the server).
  design: [
    'pieces.get',
    'pieces.list',
    'design.history',
    'design.evaluate',
    'renders.list',
    'shots.list',
    'shots.estimate',
  ],
  boards: ['boards.list', 'boards.get', 'pieces.get', 'references.pins', 'projects.summary'],
  references: [
    'boards.get',
    'boards.list',
    'references.pins',
    'references.briefs',
    'projects.summary',
    'usage.summary',
  ],
  projects: ['projects.summary'],
  renders: [
    'renders.list',
    'renders.get',
    'pieces.list',
    'scenes.list',
    'scenes.history',
    'renders.estimate',
    'shots.estimate',
    'plan.get',
    'projects.summary',
  ],
  scenes: ['scenes.list', 'scenes.history', 'renders.estimate'],
  models: ['models.list', 'models.estimatePortraits', 'shots.list', 'usage.summary'],
  shots: ['shots.list', 'shots.get', 'usage.summary'],
  production: ['production.list', 'plan.get', 'projects.summary'],
  plan: ['plan.get', 'projects.summary'],
  threads: ['threads.list', 'threads.get'],
  runs: ['threads.list', 'threads.get', 'traces.runs', 'traces.run', 'projects.summary'],
  assistant: ['assistant.setup.get', 'session.get', 'images.setup.get'],
  images: [
    'images.setup.get',
    'session.get',
    'references.estimate',
    'models.estimatePortraits',
    'shots.estimate',
  ],
  traces: ['traces.runs', 'traces.run'],
  usage: ['usage.summary', 'projects.summary'],
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
